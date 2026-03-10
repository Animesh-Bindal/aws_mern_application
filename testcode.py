#!/usr/bin/env python3
"""
compare_img_files.py

Usage:
    python compare_img_files.py

Add as many compare() calls as you need inside main().
"""

import sys
import json
import os
import re


class ImgFileComparator:
    """
    Compares pairs of disk-layout txt files (data.img / platform.img listings),
    extracts app names under /usr/apps/, classifies them as RW / RO / RORW,
    and upserts results into a single shared JSON file.

    The same instance (and therefore the same JSON file) is reused across
    every compare() call, so results accumulate correctly.
    """

    APP_PATTERN = re.compile(r'/usr/apps/([^/\s]+)')

    ROLE_MAP = {
        'data.img':     'RW',
        'platform.img': 'RO',
    }

    def __init__(self, json_path: str = 'apps.json'):
        """
        Parameters
        ----------
        json_path : str
            Path to the shared JSON file that stores all app entries.
            Created automatically if it does not exist.
        """
        self.json_path = json_path
        self._db: dict = self._load_db()

    # ── private helpers ───────────────────────────────────────────────────────

    def _load_db(self) -> dict:
        """Load the JSON database from disk, or return an empty dict."""
        if os.path.exists(self.json_path):
            with open(self.json_path, 'r', encoding='utf-8') as fh:
                try:
                    return json.load(fh)
                except json.JSONDecodeError:
                    print(f"  Warning: '{self.json_path}' had invalid JSON – starting fresh.")
        return {}

    def _save_db(self) -> None:
        """Persist the in-memory database to disk."""
        with open(self.json_path, 'w', encoding='utf-8') as fh:
            json.dump(self._db, fh, indent=4, ensure_ascii=False)

    def _get_role(self, filepath: str) -> str:
        """
        Derive RW or RO from the bare filename.
            data.img     → RW
            platform.img → RO
        """
        base = os.path.basename(filepath).lower()
        role = self.ROLE_MAP.get(base)
        if role is None:
            raise ValueError(
                f"Unrecognised image file '{base}'. "
                f"Expected one of: {list(self.ROLE_MAP.keys())}"
            )
        return role

    def _extract_apps(self, filepath: str) -> set:
        """
        Parse a txt file and return the set of app names found
        between /usr/apps/ and the next / on each line.
        """
        apps = set()
        with open(filepath, 'r', encoding='utf-8') as fh:
            for line in fh:
                m = self.APP_PATTERN.search(line)
                if m:
                    apps.add(m.group(1))
        return apps

    def _upsert(self, app_name: str, placeholder: str) -> str:
        """
        Insert or update a single app entry.
        Returns 'added', 'updated', or 'skipped'.
        """
        desired = {
            'placeholder': placeholder,
            'packageType': 'Downloadable',
        }

        if app_name not in self._db:
            self._db[app_name] = desired
            return 'added'

        existing = self._db[app_name]
        changed = any(existing.get(k) != v for k, v in desired.items())
        if changed:
            existing.update(desired)
            return 'updated'

        return 'skipped'

    # ── public API ────────────────────────────────────────────────────────────

    def compare(self, file1: str, file2: str) -> dict:
        """
        Compare two txt files and upsert their app entries into the JSON db.

        Parameters
        ----------
        file1, file2 : str
            Paths to the two txt files (one must be a data.img listing,
            the other a platform.img listing – order does not matter).

        Returns
        -------
        dict
            Summary with keys 'added', 'updated', 'skipped' and the
            three app-name sets: 'common', 'rw_only', 'ro_only'.
        """
        # Validate files exist
        for f in (file1, file2):
            if not os.path.isfile(f):
                raise FileNotFoundError(f"File not found: '{f}'")

        # Determine roles
        role1 = self._get_role(file1)
        role2 = self._get_role(file2)

        if role1 == role2:
            raise ValueError(
                f"Both files resolved to role '{role1}'. "
                "Pass one data.img and one platform.img listing."
            )

        # Extract app names
        apps1 = self._extract_apps(file1)
        apps2 = self._extract_apps(file2)

        rw_apps = apps1 if role1 == 'RW' else apps2
        ro_apps = apps1 if role1 == 'RO' else apps2

        # Categorise
        common  = rw_apps & ro_apps
        rw_only = rw_apps - ro_apps
        ro_only = ro_apps - rw_apps

        # Upsert all apps
        counters = {'added': 0, 'updated': 0, 'skipped': 0}

        for app in common:
            counters[self._upsert(app, 'RORW')] += 1
        for app in rw_only:
            counters[self._upsert(app, 'RW')] += 1
        for app in ro_only:
            counters[self._upsert(app, 'RO')] += 1

        # Persist after every compare call
        self._save_db()

        # Print summary
        print(f"\n  Files   : {file1}  |  {file2}")
        print(f"  Common (RORW) : {len(common)}")
        print(f"  RW only       : {len(rw_only)}")
        print(f"  RO only       : {len(ro_only)}")
        print(f"  JSON '{self.json_path}' → "
              f"added: {counters['added']}, "
              f"updated: {counters['updated']}, "
              f"skipped: {counters['skipped']}")

        return {
            **counters,
            'common':  common,
            'rw_only': rw_only,
            'ro_only': ro_only,
        }


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    # One comparator instance → one shared JSON file for all runs
    comparator = ImgFileComparator(json_path='apps.json')

    # Add as many compare() calls as you need:
    comparator.compare('data.img.txt', 'platform.img.txt')
    # comparator.compare('data.img.txt', 'platform.img.txt')   # another pair
    # comparator.compare('data.img.txt', 'platform.img.txt')   # and so on …


if __name__ == '__main__':
    main()
  
