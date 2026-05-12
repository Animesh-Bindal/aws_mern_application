"""
translate_json.py
─────────────────────────────────────────────────────────────────────────────
Multilingual JSON Translator  |  mul-en + ko-en (MarianMT)
Supports : Korean · Japanese · Chinese · Arabic · French · Spanish · German
           + mixed English content

Architecture
────────────
  • multiprocessing.Pool  →  true parallelism across 10 physical cores
    (bypasses Python GIL; each worker loads its own model copy)
  • Batch inference inside every worker  →  groups sentences by model/prefix
    before calling model.generate(), so the transformer runs one padded
    forward-pass per batch instead of one per sentence
  • Sentence-level parallelism  →  all sentences across all nodes are
    flattened, batched, translated in parallel, then stitched back

Language detection (regex, Unicode ranges)
──────────────────────────────────────────
  Korean   [\uac00-\ud7a3]                 → ko-en model  (no prefix)
  Japanese [\u3040-\u30ff\u31f0-\u31ff]   → mul-en  >>jpn<<
  Chinese  [\u4e00-\u9fff\u3400-\u4dbf]   → mul-en  >>zho<<
  Arabic   [\u0600-\u06ff\u0750-\u077f]   → mul-en  >>ara<<
  French   accented chars + French words  → mul-en  >>fra<<
  Spanish  accented chars + Spanish words → mul-en  >>spa<<
  German   ß/umlauts + German words       → mul-en  >>deu<<
  Other / English                         → mul-en  (no prefix)

Output cleaning
───────────────
  Strips leftover MarianMT artefacts: <unk>, ▁, stray >>, duplicate spaces,
  leading/trailing punctuation noise, and zero-width characters.
"""

from __future__ import annotations

import copy
import json
import multiprocessing as mp
import re
import sys
import time
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG  (edit these)
# ─────────────────────────────────────────────────────────────────────────────
MUL_MODEL_PATH = "./models/mul-en"
KO_MODEL_PATH  = "./models/ko-en"

INPUT_JSON  = "input.json"
OUTPUT_JSON = "output.json"

NUM_WORKERS   = 10      # physical cores on your machine
BATCH_SIZE    = 32      # sentences per model.generate() call  (tune: 16–64)
MAX_NEW_TOKENS = 256
NUM_BEAMS      = 3      # lower → faster  (set 1 for greedy, fastest)
DEVICE         = "cpu"

# ─────────────────────────────────────────────────────────────────────────────
# LANGUAGE DETECTION
# ─────────────────────────────────────────────────────────────────────────────
_RE_KO = re.compile(r'[\uac00-\ud7a3]')
_RE_JA = re.compile(r'[\u3040-\u30ff\u31f0-\u31ff\uff65-\uff9f]')
_RE_ZH = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf]')
_RE_AR = re.compile(r'[\u0600-\u06ff\u0750-\u077f]')

# French: accented vowels that appear in French + high-frequency French words
_RE_FR_CHARS = re.compile(r'[àâçéèêëîïôùûüœæ]', re.IGNORECASE)
_FR_WORDS = re.compile(
    r'\b(je|tu|il|elle|nous|vous|ils|elles|le|la|les|un|une|des|du|de|et|est'
    r'|que|qui|dans|pour|avec|sur|pas|plus|par|au|aux|en|ou|mais|donc|car'
    r'|bonjour|merci|oui|non|bien|très|aussi)\b',
    re.IGNORECASE,
)

# Spanish: accented chars + high-frequency Spanish words
_RE_ES_CHARS = re.compile(r'[áéíóúüñ¿¡]', re.IGNORECASE)
_ES_WORDS = re.compile(
    r'\b(el|la|los|las|un|una|unos|unas|y|es|en|de|que|se|no|lo|le|su'
    r'|por|con|para|una|como|más|pero|sus|ya|fue|esto|ser|hay|hola|gracias)\b',
    re.IGNORECASE,
)

# German: ß + umlauts + high-frequency German words
_RE_DE_CHARS = re.compile(r'[äöüß]', re.IGNORECASE)
_DE_WORDS = re.compile(
    r'\b(ich|du|er|sie|es|wir|ihr|der|die|das|ein|eine|und|ist|in|zu|den'
    r'|von|mit|auf|für|an|im|dem|nicht|auch|nach|bei|war|sind|werden|haben'
    r'|hallo|danke|bitte|ja|nein|gut|sehr|mehr|aber|oder)\b',
    re.IGNORECASE,
)


def _score_french(text: str) -> int:
    return len(_RE_FR_CHARS.findall(text)) * 2 + len(_FR_WORDS.findall(text))

def _score_spanish(text: str) -> int:
    return len(_RE_ES_CHARS.findall(text)) * 2 + len(_ES_WORDS.findall(text))

def _score_german(text: str) -> int:
    return len(_RE_DE_CHARS.findall(text)) * 2 + len(_DE_WORDS.findall(text))


def detect_language(text: str) -> tuple[str, str]:
    """
    Returns (model_key, prefix_string).
    model_key : 'ko' | 'mul'
    prefix    : '' | '>>jpn<< ' | '>>zho<< ' | '>>ara<< ' |
                '>>fra<< ' | '>>spa<< ' | '>>deu<< '
    """
    # Unicode-range checks first (unambiguous)
    if _RE_KO.search(text):
        return "ko", ""
    if _RE_JA.search(text):
        return "mul", ">>jpn<< "
    if _RE_ZH.search(text):
        return "mul", ">>zho<< "
    if _RE_AR.search(text):
        return "mul", ">>ara<< "

    # Score Latin-script languages
    fr = _score_french(text)
    es = _score_spanish(text)
    de = _score_german(text)

    if max(fr, es, de) >= 2:           # at least two signal hits
        best = max(fr, es, de)
        if best == fr:
            return "mul", ">>fra<< "
        if best == es:
            return "mul", ">>spa<< "
        return "mul", ">>deu<< "

    return "mul", ""                   # English or unknown → no prefix


# ─────────────────────────────────────────────────────────────────────────────
# SENTENCE SPLITTING
# ─────────────────────────────────────────────────────────────────────────────
_RE_SENT_SPLIT = re.compile(
    r'(?<=[.!?。！？…])\s+'          # western + CJK + ellipsis terminators
    r'|(?<=[다요까])\s+'             # Korean sentence-final endings
)

_RE_NUMBER_ONLY  = re.compile(r'^\s*\d[\d,. ]*\s*$')
_RE_LEADING_NUM  = re.compile(r'^(\d+)\s+(.*)', re.DOTALL)


def split_sentences(text: str) -> list[str]:
    parts = _RE_SENT_SPLIT.split(text)
    return [p.strip() for p in parts if p.strip()]


# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT CLEANING
# ─────────────────────────────────────────────────────────────────────────────
# Patterns to strip from decoded output
_CLEAN_PATTERNS = [
    re.compile(r'<[^>]+>'),              # any leftover XML/HTML tags incl. <unk>
    re.compile(r'▁'),                    # SentencePiece underscore artefact
    re.compile(r'>>[a-z]{2,3}<<\s*'),   # stray language-prefix tokens
    re.compile(r'\u200b|\u200c|\u200d|\ufeff|\u00ad'),  # zero-width / soft-hyphen
]


def clean_output(text: str) -> str:
    for pat in _CLEAN_PATTERNS:
        text = pat.sub('', text)
    text = re.sub(r'  +', ' ', text)   # collapse multiple spaces
    return text.strip()


# ─────────────────────────────────────────────────────────────────────────────
# WORKER INITIALIZER  (runs once per process)
# ─────────────────────────────────────────────────────────────────────────────
_worker_models: dict = {}   # populated in each subprocess


def _init_worker():
    """Load both models into this subprocess. Called once by Pool."""
    import torch
    from transformers import MarianMTModel, MarianTokenizer

    global _worker_models

    # Silence HF progress bars in child processes
    import transformers
    transformers.logging.set_verbosity_error()

    _worker_models["mul_tok"] = MarianTokenizer.from_pretrained(MUL_MODEL_PATH)
    _worker_models["mul_mdl"] = MarianMTModel.from_pretrained(MUL_MODEL_PATH).to(DEVICE)
    _worker_models["ko_tok"]  = MarianTokenizer.from_pretrained(KO_MODEL_PATH)
    _worker_models["ko_mdl"]  = MarianMTModel.from_pretrained(KO_MODEL_PATH).to(DEVICE)

    # Set number of intra-op threads per worker so they don't fight each other
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)


# ─────────────────────────────────────────────────────────────────────────────
# BATCH TRANSLATION (runs inside each worker)
# ─────────────────────────────────────────────────────────────────────────────
def _translate_batch_worker(sentences: list[str]) -> list[str]:
    """
    Translate a list of sentences using batch inference.
    Groups sentences by (model_key, prefix) to form homogeneous batches,
    runs model.generate() once per group, reassembles in original order.
    """
    if not sentences:
        return []

    # Group by routing key, preserving original indices
    groups: dict[tuple[str, str], list[int]] = {}
    routes: list[tuple[str, str]] = []
    for i, sent in enumerate(sentences):
        model_key, prefix = detect_language(sent)
        key = (model_key, prefix)
        routes.append(key)
        groups.setdefault(key, []).append(i)

    results = [""] * len(sentences)

    for (model_key, prefix), indices in groups.items():
        if model_key == "ko":
            tokenizer = _worker_models["ko_tok"]
            model     = _worker_models["ko_mdl"]
        else:
            tokenizer = _worker_models["mul_tok"]
            model     = _worker_models["mul_mdl"]

        # Build prefixed texts for this group
        texts = [prefix + sentences[i] for i in indices]

        # Tokenize with padding so the whole group fits one matrix
        inputs = tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512,
        ).to(DEVICE)

        translated = model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            num_beams=NUM_BEAMS,
            early_stopping=True,
            no_repeat_ngram_size=2,
        )

        for local_i, global_i in enumerate(indices):
            raw = tokenizer.decode(translated[local_i], skip_special_tokens=True)
            results[global_i] = clean_output(raw)

    return results


# ─────────────────────────────────────────────────────────────────────────────
# TEXT PREPROCESSING  (line/sentence decomposition)
# ─────────────────────────────────────────────────────────────────────────────
# A "segment" is the atom we translate.
# We represent structured text as a list of (tag, payload) pairs:
#   ('blank',  '')        → empty line, keep as-is
#   ('num',    '274')     → number-only line, keep as-is
#   ('numled', ('25', 'text…'))  → number-prefixed line
#   ('sent',   'sentence text') → normal translatable sentence

Segment = tuple[str, Any]


def decompose_text(text: str) -> list[Segment]:
    """Break a multi-line text into a flat ordered list of Segments."""
    segments: list[Segment] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            segments.append(("blank", ""))
            continue
        if _RE_NUMBER_ONLY.match(stripped):
            segments.append(("num", stripped))
            continue
        m = _RE_LEADING_NUM.match(stripped)
        if m:
            num_part, text_part = m.group(1), m.group(2).strip()
            if text_part:
                for sent in split_sentences(text_part) or [text_part]:
                    segments.append(("numled", (num_part, sent)))
            else:
                segments.append(("num", num_part))
            continue
        for sent in split_sentences(stripped) or [stripped]:
            segments.append(("sent", sent))
    return segments


def recompose_text(segments: list[Segment], translations: dict[int, str]) -> str:
    """
    Rebuild the translated text from segments.
    `translations` maps segment-index → translated string (for translatable segs).
    """
    lines: list[str] = []
    current_line_parts: list[str] = []
    current_num_prefix: str | None = None

    def flush():
        nonlocal current_num_prefix
        if current_line_parts:
            joined = " ".join(current_line_parts)
            if current_num_prefix is not None:
                lines.append(f"{current_num_prefix} {joined}")
                current_num_prefix = None
            else:
                lines.append(joined)
            current_line_parts.clear()

    for idx, (tag, payload) in enumerate(segments):
        if tag == "blank":
            flush()
            lines.append("")
        elif tag == "num":
            flush()
            lines.append(str(payload))
        elif tag == "numled":
            num_part, _ = payload
            translated = translations.get(idx, "")
            # Group consecutive numled segments with the same prefix
            if current_num_prefix is not None and current_num_prefix != num_part:
                flush()
            current_num_prefix = num_part
            current_line_parts.append(translated)
        elif tag == "sent":
            if current_num_prefix is not None:
                flush()
            current_line_parts.append(translations.get(idx, ""))

    flush()
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# JSON TREE UTILITIES
# ─────────────────────────────────────────────────────────────────────────────
def collect_nodes(node: dict, out: list[dict]) -> None:
    out.append(node)
    for child in node.get("children", []):
        collect_nodes(child, out)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────────────────────
def translate_json_file(input_path: str, output_path: str) -> None:
    t0 = time.perf_counter()

    # ── 1. Load JSON ──────────────────────────────────────────────────────
    print(f"[1/5] Reading {input_path} …")
    with open(input_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    is_dict = isinstance(raw, dict)
    roots   = copy.deepcopy([raw] if is_dict else raw)

    # ── 2. Collect all nodes ──────────────────────────────────────────────
    print("[2/5] Collecting nodes …")
    all_nodes: list[dict] = []
    for root in roots:
        collect_nodes(root, all_nodes)
    print(f"      {len(all_nodes)} nodes found.")

    # ── 3. Decompose every title/content into segments ────────────────────
    print("[3/5] Decomposing text into segments …")

    node_meta: list[dict] = []
    all_seg_records = []

    for ni, node in enumerate(all_nodes):
        meta: dict = {}
        for field in ("title", "content"):
            val = node.get(field, "") or ""
            segs = decompose_text(val) if val.strip() else []
            meta[field] = segs
            for si, (tag, payload) in enumerate(segs):
                all_seg_records.append((ni, field, si, tag, payload))
        node_meta.append(meta)

    # Extract only the translatable sentences
    translatable_indices = [
        i for i, (_, _, _, tag, _) in enumerate(all_seg_records)
        if tag in ("sent", "numled")
    ]
    translatable_texts = []
    for i in translatable_indices:
        _, _, _, tag, payload = all_seg_records[i]
        translatable_texts.append(payload if tag == "sent" else payload[1])

    total_sentences = len(translatable_texts)
    print(f"      {total_sentences} translatable sentences across all nodes.")

    # ── 4. Translate in parallel batches ──────────────────────────────────
    print(f"[4/5] Translating with {NUM_WORKERS} workers, batch size {BATCH_SIZE} …")

    # Split translatable_texts into chunks of BATCH_SIZE for the pool
    chunks: list[list[str]] = []
    chunk_start_indices: list[int] = []
    for start in range(0, total_sentences, BATCH_SIZE):
        chunks.append(translatable_texts[start : start + BATCH_SIZE])
        chunk_start_indices.append(start)

    translated_flat: list[str] = [""] * total_sentences

    # Use spawn context on Windows for clean subprocesses
    ctx = mp.get_context("spawn")
    with ctx.Pool(
        processes=NUM_WORKERS,
        initializer=_init_worker,
        maxtasksperchild=50,    # recycle workers occasionally to free memory
    ) as pool:
        futures = pool.map_async(_translate_batch_worker, chunks)

        # Progress reporting while waiting
        while not futures.ready():
            time.sleep(2)

        chunk_results = futures.get()

    for chunk_i, (start_idx, result_batch) in enumerate(
        zip(chunk_start_indices, chunk_results)
    ):
        for j, translated in enumerate(result_batch):
            translated_flat[start_idx + j] = translated

    elapsed = time.perf_counter() - t0
    print(f"      Translation done in {elapsed:.1f}s")

    # ── 5. Stitch translations back into nodes ────────────────────────────
    print("[5/5] Recomposing translated JSON …")

    # Map translatable record index → translated string
    trans_map: dict[int, str] = {}
    for pos, rec_i in enumerate(translatable_indices):
        trans_map[rec_i] = translated_flat[pos]

    # Build a lookup: (ni, field, local_si) → global rec_i
    rec_lookup: dict[tuple[int, str, int], int] = {}
    for rec_i, (ni, field, si, tag, _) in enumerate(all_seg_records):
        rec_lookup[(ni, field, si)] = rec_i

    for ni, node in enumerate(all_nodes):
        meta = node_meta[ni]
        for field in ("title", "content"):
            segs = meta[field]
            if not segs:
                continue
            local_trans: dict[int, str] = {}
            for si in range(len(segs)):
                rec_i = rec_lookup[(ni, field, si)]
                if rec_i in trans_map:
                    local_trans[si] = trans_map[rec_i]
            node[field] = recompose_text(segs, local_trans)

    # ── Save ──────────────────────────────────────────────────────────────
    output = roots[0] if is_dict else roots
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total_time = time.perf_counter() - t0
    print(f"\n✓ Saved → {output_path}  (total: {total_time:.1f}s)")


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Required on Windows for multiprocessing spawn
    mp.freeze_support()

    in_path  = sys.argv[1] if len(sys.argv) > 1 else INPUT_JSON
    out_path = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_JSON

    translate_json_file(in_path, out_path)
