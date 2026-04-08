#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


GROUP_RE = re.compile(r"^(?:[│ ]{4})*")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check that every .stl listed in a tree file appears in a Buildr2 droid config."
    )
    parser.add_argument("tree_file", help="Path to the tree text file, for example file_structure.tree")
    parser.add_argument("config_file", help="Path to the droid JSON config")
    parser.add_argument(
        "--show-present",
        action="store_true",
        help="Also print files that were found in the config"
    )
    args = parser.parse_args()

    tree_path = Path(args.tree_file).expanduser().resolve()
    config_path = Path(args.config_file).expanduser().resolve()

    tree_stls = parse_tree_stl_paths(tree_path.read_text(encoding="utf-8"))
    config_stls = extract_config_stl_paths(json.loads(config_path.read_text(encoding="utf-8")))

    missing = sorted(tree_stls - config_stls)
    present = sorted(tree_stls & config_stls)

    print(f"Tree STL files:   {len(tree_stls)}")
    print(f"Config STL files: {len(config_stls)}")
    print(f"Matched:          {len(present)}")
    print(f"Missing:          {len(missing)}")

    if args.show_present and present:
      print("\nPresent in config:")
      for item in present:
          print(item)

    if missing:
        print("\nMissing from config:")
        for item in missing:
            print(item)
        return 1

    print("\nAll tree STL files are present in the config.")
    return 0


def parse_tree_stl_paths(tree_text: str) -> set[str]:
    stack: list[str] = []
    stl_paths: set[str] = set()

    for raw_line in tree_text.splitlines():
        line = raw_line.replace("\u00a0", " ").rstrip()
        if not line.strip():
            continue

        depth = detect_depth(line)
        name = strip_tree_prefix(line).strip()
        if not name:
            continue

        is_stl = name.lower().endswith(".stl")
        is_other_file = "." in name and not is_stl

        if is_stl:
            parts = stack[:depth] + [name]
            stl_paths.add("/".join(parts))
            continue

        if is_other_file:
            continue

        if len(stack) <= depth:
            stack.extend([""] * (depth + 1 - len(stack)))
        stack[depth] = name
        del stack[depth + 1 :]

    return stl_paths


def detect_depth(line: str) -> int:
    depth = 0
    remainder = line
    while remainder.startswith("│   ") or remainder.startswith("    "):
        depth += 1
        remainder = remainder[4:]
    if remainder.startswith("├── ") or remainder.startswith("└── "):
        depth += 1
    return depth


def strip_tree_prefix(line: str) -> str:
    remainder = line
    while remainder.startswith("│   ") or remainder.startswith("    "):
        remainder = remainder[4:]
    if remainder.startswith("├── ") or remainder.startswith("└── "):
        remainder = remainder[4:]
    return remainder


def extract_config_stl_paths(config: dict) -> set[str]:
    paths: set[str] = set()
    for section in config.get("sections", []):
        categories = section.get("categories", {})
        for parts in categories.values():
            for part in parts:
                for file_path in part.get("files", []):
                    if isinstance(file_path, str) and file_path.lower().endswith(".stl"):
                        paths.add(file_path.replace("\\", "/"))
    return paths


if __name__ == "__main__":
    raise SystemExit(main())
