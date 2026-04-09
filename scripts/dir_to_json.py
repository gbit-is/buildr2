#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dump a directory structure to JSON for easier machine reading."
    )
    parser.add_argument("directory", help="Directory to scan")
    parser.add_argument("output_file", help="Where to write the JSON output")
    parser.add_argument(
        "--include-hidden",
        action="store_true",
        help="Include hidden files and directories"
    )
    args = parser.parse_args()

    root = Path(args.directory).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise SystemExit(f"Not a directory: {root}")

    output_file = Path(args.output_file).expanduser().resolve()
    tree = build_node(root, root, include_hidden=args.include_hidden)
    output_file.write_text(f"{json.dumps(tree, indent=2)}\n", encoding="utf-8")
    print(f"Wrote {output_file}")
    return 0


def build_node(path: Path, root: Path, *, include_hidden: bool) -> dict:
    relative_path = "." if path == root else path.relative_to(root).as_posix()

    if path.is_dir():
        children = []
        for child in sorted(path.iterdir(), key=sort_key):
            if not include_hidden and child.name.startswith("."):
                continue
            children.append(build_node(child, root, include_hidden=include_hidden))

        return {
            "type": "directory",
            "name": path.name,
            "path": relative_path,
            "children": children
        }

    return {
        "type": "file",
        "name": path.name,
        "path": relative_path
    }


def sort_key(path: Path) -> tuple[int, str]:
    return (0 if path.is_dir() else 1, path.name.lower())


if __name__ == "__main__":
    raise SystemExit(main())
