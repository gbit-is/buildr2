#!/usr/bin/env python3

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert .stl files in a directory into Buildr2 bulk-import lines."
    )
    parser.add_argument("directory", help="Directory to scan for .stl files")
    parser.add_argument(
        "--base",
        default=None,
        help="Optional base directory for emitted relative file paths. Defaults to the scanned directory."
    )
    parser.add_argument(
        "--flat",
        action="store_true",
        help="Use only the filename in output paths instead of relative nested paths."
    )
    args = parser.parse_args()

    scan_root = Path(args.directory).expanduser().resolve()
    if not scan_root.exists() or not scan_root.is_dir():
      raise SystemExit(f"Not a directory: {scan_root}")

    base_root = Path(args.base).expanduser().resolve() if args.base else scan_root
    stl_files = sorted(scan_root.rglob("*.stl"), key=lambda item: str(item).lower())

    for file_path in stl_files:
        if args.flat:
            emitted_path = file_path.name
        else:
            emitted_path = file_path.relative_to(base_root).as_posix()

        print(f"{build_part_name(file_path.stem)} | {emitted_path}")

    return 0


def build_part_name(stem: str) -> str:
    text = stem.replace("_", " ").replace("-", " ").strip()
    words = [word for word in text.split() if word]
    return " ".join(word.capitalize() for word in words) if words else stem


if __name__ == "__main__":
    raise SystemExit(main())
