import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg: "#080E1E",
  surface: "rgba(255,255,255,0.04)",
  surfaceHover: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.07)",
  borderActive: "rgba(99,179,237,0.4)",
  text: "#E8EDF5",
  textMuted: "rgba(232,237,245,0.45)",
  textDim: "rgba(232,237,245,0.25)",
  blue: "#4F8EF7",
  cyan: "#22D3EE",
  purple: "#A78BFA",
  green: "#34D399",
  amber: "#FBBF24",
  red: "#F87171",
  glow: {
    blue: "0 0 20px rgba(79,142,247,0.35)",
    cyan: "0 0 20px rgba(34,211,238,0.35)",
    purple: "0 0 20px rgba(167,139,250,0.35)",
    green: "0 0 20px rgba(52,211,153,0.35)",
    red: "0 0 20px rgba(248,113,113,0.35)",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DATA — simulates a real multi-agent run
// ─────────────────────────────────────────────────────────────────────────────
const AGENTS_LEFT = [
  { id: "search", name: "Search Agent", icon: "⊕", color: T.cyan },
  { id: "sql", name: "SQL Agent", icon: "◈", color: T.blue },
  { id: "kb", name: "Knowledge Agent", icon: "◉", color: T.purple },
  { id: "web", name: "Web Agent", icon: "⊛", color: T.amber },
  { id: "mcp", name: "MCP Executor", icon: "⊟", color: T.green },
];

const WORKFLOW_NODES = [
  { id: "user", label: "User Query", type: "io", x: 50, y: 50 },
  { id: "orch", label: "Orchestrator", type: "orchestrator", x: 50, y: 165 },
  { id: "search", label: "Search Agent", type: "agent", x: 15, y: 285, color: T.cyan },
  { id: "sql", label: "SQL Agent", type: "agent", x: 85, y: 285, color: T.blue },
  { id: "vecdb", label: "Vector DB", type: "tool", x: 8, y: 380, color: T.cyan },
  { id: "sqldb", label: "SQL DB", type: "tool", x: 85, y: 380, color: T.blue },
  { id: "llm", label: "LLM Synthesizer", type: "llm", x: 50, y: 470 },
  { id: "out", label: "Response", type: "io", x: 50, y: 560 },
];

const EDGES = [
  { from: "user", to: "orch" },
  { from: "orch", to: "search" },
  { from: "orch", to: "sql" },
  { from: "search", to: "vecdb" },
  { from: "sql", to: "sqldb" },
  { from: "vecdb", to: "llm" },
  { from: "sqldb", to: "llm" },
  { from: "llm", to: "out" },
];

const TIMELINE_EVENTS = [
  { id: 1, time: "10:23:11", label: "Query received", detail: "\"What products had highest churn last quarter?\"", status: "success", nodeId: "user" },
  { id: 2, time: "10:23:12", label: "Orchestrator started", detail: "Routing to Search + SQL agents", status: "success", nodeId: "orch" },
  { id: 3, time: "10:23:13", label: "Search Agent invoked", detail: "Querying vector database", status: "success", nodeId: "search" },
  { id: 4, time: "10:23:14", label: "12 documents retrieved", detail: "Product docs · Wiki · Support KB", status: "success", nodeId: "vecdb" },
  { id: 5, time: "10:23:15", label: "SQL Agent invoked", detail: "Executing churn analysis query", status: "success", nodeId: "sql" },
  { id: 6, time: "10:23:18", label: "35 records retrieved", detail: "Q3 churn data across 7 product lines", status: "success", nodeId: "sqldb" },
  { id: 7, time: "10:23:19", label: "LLM synthesizing", detail: "Combining search + SQL results", status: "running", nodeId: "llm" },
  { id: 8, time: "10:23:23", label: "Response delivered", detail: "1,240 tokens · 4.2s total", status: "pending", nodeId: "out" },
];

const AGENT_CARDS = [
  {
    id: "orch", name: "Orchestrator", icon: "◎", color: T.purple,
    status: "success", time: "0.8s",
    meta: [
      { label: "Agents Routed", value: "2" },
      { label: "Strategy", value: "Parallel" },
    ],
    tools: [],
  },
  {
    id: "search", name: "Search Agent", icon: "⊕", color: T.cyan,
    status: "success", time: "1.3s",
    meta: [
      { label: "Documents Retrieved", value: "12" },
      { label: "Top Source", value: "Product Docs" },
    ],
    tools: ["Vector Search", "Embedding Model"],
  },
  {
    id: "sql", name: "SQL Agent", icon: "◈", color: T.blue,
    status: "running", time: "2.1s",
    meta: [
      { label: "Records Fetched", value: "35" },
      { label: "Tables Queried", value: "3" },
    ],
    tools: ["SQL DB", "Query Planner"],
  },
  {
    id: "llm", name: "LLM Synthesizer", icon: "✦", color: T.purple,
    status: "running", time: "—",
    meta: [
      { label: "Input Tokens", value: "3,842" },
      { label: "Model", value: "claude-sonnet" },
    ],
    tools: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
function statusColor(s) {
  if (s === "success") return T.green;
  if (s === "running") return T.blue;
  if (s === "error") return T.red;
  if (s === "warning") return T.amber;
  return T.textDim;
}

function statusLabel(s) {
  if (s === "success") return "Completed";
  if (s === "running") return "Running";
  if (s === "error") return "Error";
  if (s === "pending") return "Waiting";
  return "Idle";
}

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION KEYFRAMES (injected once)
// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }

body { background: ${T.bg}; color: ${T.text}; font-family: 'Inter', system-ui, sans-serif; }

@keyframes pulse-ring {
  0% { transform: scale(0.94); box-shadow: 0 0 0 0 rgba(79,142,247,0.5); }
  70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(79,142,247,0); }
  100% { transform: scale(0.94); box-shadow: 0 0 0 0 rgba(79,142,247,0); }
}
@keyframes flow {
  0% { stroke-dashoffset: 200; }
  100% { stroke-dashoffset: 0; }
}
@keyframes particle {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(-8px) scale(0); opacity: 0; }
}
@keyframes fadeSlideIn {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes spin-slow {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes blink-dot {
  0%,100% { opacity: 1; }
  50% { opacity: 0.2; }
}
@keyframes glow-pulse {
  0%,100% { opacity: 0.6; }
  50% { opacity: 1; }
}
@keyframes dash-flow {
  0% { stroke-dashoffset: 20; }
  100% { stroke-dashoffset: 0; }
}

.pulse { animation: pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite; }
.fade-in { animation: fadeSlideIn 0.35s cubic-bezier(0.4,0,0.2,1) both; }
.shimmer-bg {
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
.spin { animation: spin-slow 1.8s linear infinite; }
.blink { animation: blink-dot 1.2s ease-in-out infinite; }
.glow-pulse { animation: glow-pulse 2s ease-in-out infinite; }

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// SVG WORKFLOW GRAPH
// ─────────────────────────────────────────────────────────────────────────────
function WorkflowGraph({ activeNode, nodeStates }) {
  const W = 100; // percentage units for viewBox

  function nodeById(id) {
    return WORKFLOW_NODES.find((n) => n.id === id);
  }

  function nodeColor(node) {
    const state = nodeStates[node.id];
    if (state === "success") return T.green;
    if (state === "running") return node.color || T.blue;
    if (state === "error") return T.red;
    return "rgba(255,255,255,0.12)";
  }

  function nodeGlow(node) {
    const state = nodeStates[node.id];
    if (state === "success") return T.glow.green;
    if (state === "running") return node.color === T.cyan ? T.glow.cyan : T.glow.blue;
    return "none";
  }

  const edgeActive = useCallback((edge) => {
    const fromState = nodeStates[edge.from];
    const toState = nodeStates[edge.to];
    return fromState === "success" || fromState === "running" || toState === "running";
  }, [nodeStates]);

  return (
    <svg
      viewBox="0 0 100 620"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="edgeGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={T.blue} stopOpacity="0.8" />
          <stop offset="100%" stopColor={T.cyan} stopOpacity="0.4" />
        </linearGradient>
        <filter id="glow-filter">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Edges */}
      {EDGES.map((edge, i) => {
        const from = nodeById(edge.from);
        const to = nodeById(edge.to);
        if (!from || !to) return null;
        const active = edgeActive(edge);
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        return (
          <g key={i}>
            <line
              x1={from.x} y1={from.y + 10}
              x2={to.x} y2={to.y - 10}
              stroke={active ? T.blue : "rgba(255,255,255,0.07)"}
              strokeWidth={active ? "0.6" : "0.4"}
              opacity={active ? 1 : 0.6}
            />
            {active && (
              <line
                x1={from.x} y1={from.y + 10}
                x2={to.x} y2={to.y - 10}
                stroke={T.cyan}
                strokeWidth="0.6"
                strokeDasharray="4 4"
                opacity="0.6"
                style={{ animation: "dash-flow 0.8s linear infinite" }}
              />
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {WORKFLOW_NODES.map((node) => {
        const state = nodeStates[node.id] || "idle";
        const color = nodeColor(node);
        const isRunning = state === "running";
        const isSuccess = state === "success";

        const typeRadius = node.type === "io" ? 8 : node.type === "orchestrator" ? 10 : 8;
        const rx = node.type === "orchestrator" ? 3 : node.type === "llm" ? 3 : 2;

        return (
          <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
            {/* Glow ring for running */}
            {isRunning && (
              <circle
                cx={0} cy={0} r={typeRadius + 5}
                fill="none"
                stroke={color}
                strokeWidth="0.5"
                opacity="0.3"
                style={{ animation: "pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
              />
            )}

            {/* Main node box */}
            <rect
              x={-typeRadius * 2} y={-typeRadius * 0.8}
              width={typeRadius * 4} height={typeRadius * 1.6}
              rx={rx}
              fill={state !== "idle" ? `${color}18` : "rgba(255,255,255,0.03)"}
              stroke={color}
              strokeWidth={state !== "idle" ? "0.6" : "0.3"}
              filter={state !== "idle" ? "url(#glow-filter)" : "none"}
            />

            {/* Label */}
            <text
              x={0} y={typeRadius * 0.35}
              textAnchor="middle"
              fontSize="3.5"
              fontFamily="Inter"
              fontWeight={isRunning || isSuccess ? "600" : "400"}
              fill={state !== "idle" ? color : T.textMuted}
            >
              {node.label}
            </text>

            {/* Success tick */}
            {isSuccess && (
              <circle cx={typeRadius * 1.8} cy={-typeRadius * 0.6} r="2" fill={T.green}>
                <animate attributeName="r" from="0" to="2" dur="0.3s" fill="freeze" />
              </circle>
            )}

            {/* Running dot */}
            {isRunning && (
              <circle cx={typeRadius * 1.8} cy={-typeRadius * 0.6} r="1.5" fill={color}>
                <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS DOT
// ─────────────────────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const color = statusColor(status);
  return (
    <span style={{
      display: "inline-block",
      width: 6, height: 6,
      borderRadius: "50%",
      background: color,
      boxShadow: status === "running" ? `0 0 6px ${color}` : "none",
      flexShrink: 0,
      ...(status === "running" ? { animation: "blink-dot 1.2s ease-in-out infinite" } : {}),
    }} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CARD
// ─────────────────────────────────────────────────────────────────────────────
function AgentCard({ card, index }) {
  const [expanded, setExpanded] = useState(false);
  const color = card.color;
  const isRunning = card.status === "running";

  return (
    <div
      className="fade-in"
      style={{
        animationDelay: `${index * 0.07}s`,
        border: `1px solid ${isRunning ? color + "50" : T.border}`,
        borderRadius: 10,
        background: T.surface,
        marginBottom: 8,
        overflow: "hidden",
        boxShadow: isRunning ? `0 0 16px ${color}20` : "none",
        transition: "box-shadow 0.4s ease",
      }}
    >
      {/* Card Header */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 14px",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {/* Icon */}
        <div style={{
          width: 30, height: 30,
          borderRadius: 8,
          background: `${color}18`,
          border: `1px solid ${color}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, color,
          flexShrink: 0,
          ...(isRunning ? { animation: "glow-pulse 2s ease-in-out infinite" } : {}),
        }}>
          {isRunning ? (
            <span className="spin" style={{ display: "inline-block", fontSize: 12 }}>◌</span>
          ) : card.icon}
        </div>

        {/* Name + Status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: T.text, lineHeight: 1.2 }}>
            {card.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <StatusDot status={card.status} />
            <span style={{ fontSize: 11, color: statusColor(card.status), fontWeight: 500 }}>
              {statusLabel(card.status)}
            </span>
          </div>
        </div>

        {/* Time */}
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: T.textMuted,
          marginRight: 6,
        }}>
          {card.time}
        </div>

        {/* Chevron */}
        <div style={{
          color: T.textDim,
          fontSize: 10,
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.25s ease",
        }}>
          ▾
        </div>
      </div>

      {/* Progress bar for running */}
      {isRunning && (
        <div style={{ height: 2, background: `rgba(255,255,255,0.05)`, position: "relative" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: "60%",
            background: `linear-gradient(90deg, ${color}, ${color}80)`,
            borderRadius: 1,
            animation: "shimmer 1.5s infinite",
            backgroundSize: "200% 100%",
          }} />
        </div>
      )}

      {/* Expanded Details */}
      {expanded && (
        <div className="fade-in" style={{ padding: "0 14px 12px" }}>
          <div style={{ height: 1, background: T.border, margin: "8px 0" }} />

          {/* Meta grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {card.meta.map((m, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.03)",
                borderRadius: 6,
                padding: "7px 9px",
              }}>
                <div style={{ fontSize: 10, color: T.textDim, marginBottom: 2 }}>{m.label}</div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: T.text,
                  fontFamily: m.value.match(/^\d/) ? "'JetBrains Mono', monospace" : "inherit",
                }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* Tools */}
          {card.tools.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: T.textDim, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Tools Used</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {card.tools.map((t, i) => (
                  <span key={i} style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 20,
                    background: `${color}15`,
                    border: `1px solid ${color}30`,
                    color,
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE
// ─────────────────────────────────────────────────────────────────────────────
function Timeline({ visibleCount }) {
  return (
    <div style={{ padding: "0 2px" }}>
      {TIMELINE_EVENTS.slice(0, visibleCount).map((ev, i) => {
        const isLast = i === visibleCount - 1;
        return (
          <div
            key={ev.id}
            className="fade-in"
            style={{ animationDelay: `${i * 0.04}s`, display: "flex", gap: 10, paddingBottom: 12 }}
          >
            {/* Timeline spine */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 16 }}>
              <div style={{
                width: 7, height: 7,
                borderRadius: "50%",
                background: ev.status === "running" ? T.blue : ev.status === "success" ? T.green : T.textDim,
                boxShadow: ev.status === "running" ? `0 0 8px ${T.blue}` : "none",
                flexShrink: 0,
                marginTop: 3,
                ...(ev.status === "running" ? { animation: "blink-dot 1.2s ease-in-out infinite" } : {}),
              }} />
              {!isLast && (
                <div style={{ width: 1, flex: 1, background: T.border, marginTop: 3 }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, paddingBottom: 2 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: T.textDim,
                }}>
                  {ev.time}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>
                  {ev.label}
                </span>
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                {ev.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// METRICS BAR
// ─────────────────────────────────────────────────────────────────────────────
function MetricsBar({ elapsed }) {
  const metrics = [
    { label: "Elapsed", value: `${elapsed}s`, color: T.blue },
    { label: "Tokens In", value: "3,842", color: T.purple },
    { label: "Agents", value: "3", color: T.cyan },
    { label: "Latency P50", value: "1.3s", color: T.green },
  ];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 6,
      padding: "10px 0",
    }}>
      {metrics.map((m, i) => (
        <div key={i} style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          textAlign: "center",
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
            fontWeight: 600,
            color: m.color,
          }}>
            {m.value}
          </div>
          <div style={{ fontSize: 9, color: T.textDim, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {m.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LEFT SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function LeftSidebar() {
  return (
    <div style={{
      width: 220,
      flexShrink: 0,
      background: "rgba(0,0,0,0.3)",
      borderRight: `1px solid ${T.border}`,
      display: "flex",
      flexDirection: "column",
      padding: "16px 10px",
    }}>
      {/* Logo */}
      <div style={{ padding: "0 6px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28,
          borderRadius: 8,
          background: `linear-gradient(135deg, ${T.blue}, ${T.purple})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14,
        }}>
          ✦
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>AgentOS</div>
          <div style={{ fontSize: 10, color: T.textDim }}>Multi-Agent Platform</div>
        </div>
      </div>

      <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", padding: "0 6px 8px" }}>
        Agents
      </div>

      {AGENTS_LEFT.map((agent) => (
        <div key={agent.id} style={{
          display: "flex", alignItems: "center", gap: 9,
          padding: "8px 10px",
          borderRadius: 7,
          cursor: "pointer",
          marginBottom: 2,
        }}
          onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <div style={{
            width: 24, height: 24,
            borderRadius: 6,
            background: `${agent.color}18`,
            border: `1px solid ${agent.color}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: agent.color,
          }}>
            {agent.icon}
          </div>
          <div style={{ fontSize: 12, fontWeight: 400, color: T.textMuted }}>
            {agent.name}
          </div>
        </div>
      ))}

      <div style={{ flex: 1 }} />

      {/* Status indicator */}
      <div style={{
        padding: "10px 10px",
        background: `${T.green}12`,
        border: `1px solid ${T.green}25`,
        borderRadius: 8,
        display: "flex", alignItems: "center", gap: 7,
      }}>
        <StatusDot status="running" />
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: T.green }}>System Active</div>
          <div style={{ fontSize: 10, color: T.textDim }}>3 agents running</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT AREA
// ─────────────────────────────────────────────────────────────────────────────
function ChatArea() {
  const messages = [
    {
      role: "user",
      content: "What products had the highest churn last quarter? Include any related support issues.",
    },
    {
      role: "assistant",
      content: null, // streaming
    },
  ];

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      borderRight: `1px solid ${T.border}`,
      minWidth: 0,
    }}>
      {/* Top bar */}
      <div style={{
        padding: "14px 20px",
        borderBottom: `1px solid ${T.border}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>New Conversation</div>
          <div style={{ fontSize: 11, color: T.textDim }}>Multi-agent analysis active</div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 10px",
          background: `${T.blue}15`,
          border: `1px solid ${T.blue}30`,
          borderRadius: 20,
          fontSize: 11,
          color: T.blue,
        }}>
          <StatusDot status="running" />
          Processing
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* User message */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{
            maxWidth: "75%",
            background: `linear-gradient(135deg, ${T.blue}30, ${T.purple}20)`,
            border: `1px solid ${T.blue}25`,
            borderRadius: "12px 12px 3px 12px",
            padding: "10px 14px",
            fontSize: 13,
            lineHeight: 1.5,
          }}>
            What products had the highest churn last quarter? Include any related support issues.
          </div>
        </div>

        {/* Assistant: streaming state */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{
            width: 28, height: 28,
            borderRadius: 8,
            background: `linear-gradient(135deg, ${T.blue}, ${T.purple})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, flexShrink: 0, marginTop: 2,
            animation: "glow-pulse 2s ease-in-out infinite",
          }}>
            ✦
          </div>
          <div style={{
            flex: 1,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: "3px 12px 12px 12px",
            padding: "12px 14px",
          }}>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: T.textMuted }}>
              Analyzing Q3 churn data across your product lines
              <span style={{
                display: "inline-flex", gap: 3, marginLeft: 6, verticalAlign: "middle",
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 4, height: 4,
                    borderRadius: "50%",
                    background: T.blue,
                    animation: `blink-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    display: "inline-block",
                  }} />
                ))}
              </span>
            </div>

            {/* Inline source chips */}
            <div style={{ marginTop: 10, display: "flex", gap: 5, flexWrap: "wrap" }}>
              {["Product Docs", "Internal Wiki", "Q3 SQL Data"].map((s, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: "2px 8px",
                  borderRadius: 20,
                  background: "rgba(255,255,255,0.05)",
                  border: `1px solid ${T.border}`,
                  color: T.textMuted,
                }}>
                  ⊕ {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Input */}
      <div style={{
        padding: "14px 16px",
        borderTop: `1px solid ${T.border}`,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: "10px 14px",
        }}>
          <input
            placeholder="Message AgentOS…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 13,
              color: T.text,
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          />
          <button style={{
            width: 28, height: 28,
            borderRadius: 7,
            background: `linear-gradient(135deg, ${T.blue}, ${T.purple})`,
            border: "none",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, color: "white",
          }}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RIGHT EXECUTION PANEL
// ─────────────────────────────────────────────────────────────────────────────
function ExecutionPanel({ nodeStates, visibleCards, timelineCount, elapsed }) {
  const [tab, setTab] = useState("graph");

  const tabs = [
    { id: "graph", label: "Graph" },
    { id: "agents", label: "Agents" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div style={{
      width: 320,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      background: "rgba(0,0,0,0.2)",
    }}>
      {/* Panel header */}
      <div style={{
        padding: "14px 16px 0",
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Execution Inspector</div>
          <div style={{
            width: 6, height: 6,
            borderRadius: "50%",
            background: T.blue,
            animation: "blink-dot 1.2s ease-in-out infinite",
          }} />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: "6px 0",
                background: tab === t.id ? "rgba(79,142,247,0.15)" : "transparent",
                border: "none",
                borderBottom: `2px solid ${tab === t.id ? T.blue : "transparent"}`,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? T.blue : T.textMuted,
                fontFamily: "Inter, system-ui, sans-serif",
                borderRadius: "4px 4px 0 0",
                transition: "all 0.2s ease",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ padding: "0 12px" }}>
        <MetricsBar elapsed={elapsed} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
        {tab === "graph" && (
          <div style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: 10,
            height: 420,
          }}>
            <WorkflowGraph nodeStates={nodeStates} />
          </div>
        )}

        {tab === "agents" && (
          <div>
            {AGENT_CARDS.slice(0, visibleCards).map((card, i) => (
              <AgentCard key={card.id} card={card} index={i} />
            ))}
          </div>
        )}

        {tab === "timeline" && (
          <div style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "12px 14px",
          }}>
            <Timeline visibleCount={timelineCount} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [nodeStates, setNodeStates] = useState({});
  const [visibleCards, setVisibleCards] = useState(0);
  const [timelineCount, setTimelineCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const elapsedRef = useRef(null);

  const sequence = [
    () => setNodeStates({ user: "success" }),
    () => { setNodeStates(s => ({ ...s, orch: "running" })); setVisibleCards(1); setTimelineCount(1); },
    () => { setNodeStates(s => ({ ...s, orch: "success", search: "running" })); setVisibleCards(2); setTimelineCount(2); },
    () => { setNodeStates(s => ({ ...s, vecdb: "running" })); setTimelineCount(3); },
    () => { setNodeStates(s => ({ ...s, vecdb: "success", search: "success", sql: "running" })); setVisibleCards(3); setTimelineCount(5); },
    () => { setNodeStates(s => ({ ...s, sqldb: "running" })); },
    () => { setNodeStates(s => ({ ...s, sqldb: "success", sql: "success", llm: "running" })); setVisibleCards(4); setTimelineCount(7); },
    () => { setNodeStates(s => ({ ...s, llm: "success", out: "success" })); setTimelineCount(8); setRunning(false); },
  ];

  function startDemo() {
    setNodeStates({});
    setVisibleCards(0);
    setTimelineCount(0);
    setElapsed(0);
    setRunning(true);

    sequence.forEach((step, i) => {
      setTimeout(step, i * 900 + 200);
    });
  }

  useEffect(() => {
    if (running) {
      elapsedRef.current = setInterval(() => setElapsed(e => +(e + 0.1).toFixed(1)), 100);
    } else {
      clearInterval(elapsedRef.current);
    }
    return () => clearInterval(elapsedRef.current);
  }, [running]);

  return (
    <>
      <style>{CSS}</style>
      <div style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        fontFamily: "Inter, system-ui, sans-serif",
        color: T.text,
        overflow: "hidden",
      }}>
        {/* Top bar */}
        <div style={{
          height: 44,
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 12,
          background: "rgba(0,0,0,0.3)",
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }} />
          <button
            onClick={startDemo}
            style={{
              padding: "5px 14px",
              background: running
                ? `rgba(255,255,255,0.05)`
                : `linear-gradient(135deg, ${T.blue}, ${T.purple})`,
              border: running ? `1px solid ${T.border}` : "none",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              color: "white",
              fontFamily: "Inter, system-ui, sans-serif",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {running ? (
              <><span className="spin" style={{ display: "inline-block" }}>◌</span> Running…</>
            ) : (
              <>▶ Run Demo</>
            )}
          </button>
        </div>

        {/* Main layout */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <LeftSidebar />
          <ChatArea />
          <ExecutionPanel
            nodeStates={nodeStates}
            visibleCards={visibleCards}
            timelineCount={timelineCount}
            elapsed={elapsed}
          />
        </div>
      </div>
    </>
  );
}

