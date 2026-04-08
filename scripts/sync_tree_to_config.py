#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add missing STL entries from a tree file into a Buildr2 droid config."
    )
    parser.add_argument("tree_file", help="Path to the tree file, for example file_structure.tree")
    parser.add_argument("config_file", help="Path to the droid config JSON")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write changes back to the config file. Without this flag, only a preview is shown."
    )
    args = parser.parse_args()

    tree_path = Path(args.tree_file).expanduser().resolve()
    config_path = Path(args.config_file).expanduser().resolve()

    tree_entries = parse_tree_entries(tree_path.read_text(encoding="utf-8"))
    config = json.loads(config_path.read_text(encoding="utf-8"))
    existing_files = extract_existing_files(config)
    sections = {section["id"]: section for section in config.get("sections", [])}

    created: list[dict[str, str]] = []
    skipped: list[str] = []

    for entry in tree_entries:
        path = entry["path"]
        if path in existing_files:
          continue

        inference = infer_entry(entry)
        if not inference:
            skipped.append(path)
            continue

        section = sections.get(inference["section_id"])
        if not section:
            skipped.append(path)
            continue

        categories = section.setdefault("categories", {})
        bucket = categories.setdefault(inference["category"], [])
        next_part = {
            "id": build_part_id(path),
            "name": build_part_name(path),
            "files": [path]
        }

        quantity = infer_quantity(path)
        if quantity > 1:
            next_part["quantity"] = quantity

        requirements = infer_requirements(entry["parts"])
        section_option_ids = {option["id"] for option in section.get("options", [])}
        requirements = {key: value for key, value in requirements.items() if key in section_option_ids}
        if requirements:
            next_part["requirements"] = requirements

        if any(part.get("id") == next_part["id"] for part in bucket):
            next_part["id"] = disambiguate_id(next_part["id"], bucket)

        bucket.append(next_part)
        created.append({
            "section": inference["section_id"],
            "category": inference["category"],
            "path": path
        })

    print(f"Existing files already in config: {len(existing_files)}")
    print(f"Added entries: {len(created)}")
    print(f"Skipped (no confident section/category): {len(skipped)}")

    if created:
        print("\nAdded:")
        for item in created[:200]:
            print(f"{item['section']} / {item['category']} :: {item['path']}")
        if len(created) > 200:
            print(f"... and {len(created) - 200} more")

    if skipped:
        print("\nSkipped:")
        for path in skipped[:200]:
            print(path)
        if len(skipped) > 200:
            print(f"... and {len(skipped) - 200} more")

    if args.write:
        config_path.write_text(f"{json.dumps(config, indent=2)}\n", encoding="utf-8")
        print(f"\nUpdated {config_path}")
    else:
        print("\nDry run only. Re-run with --write to update the config file.")

    return 0


def parse_tree_entries(tree_text: str) -> list[dict[str, Any]]:
    stack: list[str] = []
    entries: list[dict[str, Any]] = []

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
            entries.append({
                "path": "/".join(parts),
                "parts": parts
            })
            continue

        if is_other_file:
            continue

        if len(stack) <= depth:
            stack.extend([""] * (depth + 1 - len(stack)))
        stack[depth] = name
        del stack[depth + 1 :]

    return entries


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


def extract_existing_files(config: dict[str, Any]) -> set[str]:
    existing: set[str] = set()
    for section in config.get("sections", []):
        for parts in section.get("categories", {}).values():
            for part in parts:
                for file_path in part.get("files", []):
                    if isinstance(file_path, str) and file_path.lower().endswith(".stl"):
                        existing.add(file_path.replace("\\", "/"))
    return existing


def infer_entry(entry: dict[str, Any]) -> dict[str, str] | None:
    parts = [part.lower() for part in entry["parts"]]
    path = "/".join(parts)
    top = parts[0] if parts else ""

    if top == "dome":
        section_id = "dome"
    elif top == "body":
        if "skirt" in parts:
            section_id = "skirt"
        else:
            section_id = "body"
    elif top == "legs":
        if "centreanklefoot" in path or "centerfoot" in path or "centrefoot" in path:
            section_id = "middle-leg"
        elif has_left_marker(parts, path):
            section_id = "left-leg"
        elif has_right_marker(parts, path):
            section_id = "right-leg"
        elif any(token in path for token in ["legplug", "boosterpins"]):
            # These are generic outer-leg support parts in the tree root with
            # no side marker. Keep them in the left-leg bucket instead of
            # leaving them untracked.
            section_id = "left-leg"
        elif "horseshoe complication" in path:
            # Community remix folder has a few generic sub-parts without an
            # explicit side marker. Keep them visible under the left leg rather
            # than dropping them on the floor.
            section_id = "left-leg"
        else:
            return None
    elif top == "outerfeet drives":
        if has_left_marker(parts, path):
            section_id = "outer-foot-left"
        elif has_right_marker(parts, path):
            section_id = "outer-foot-right"
        else:
            return None
    else:
        return None

    category = "greebles" if is_greeble(parts) else "main"
    return {
        "section_id": section_id,
        "category": category
    }


def is_greeble(parts: list[str]) -> bool:
    path = "/".join(parts)
    hints = [
        "greebles",
        "paintmasks",
        "logic",
        "holo",
        "psi",
        "radareye",
        "radar eye",
        "coinreturn",
        "coinslots",
        "pockets",
        "vent",
        "powercoupler",
        "button",
        "detail",
        "bracelet",
        "booster",
        "horseshoe",
        "veneer",
        "panel",
        "door"
    ]
    return any(hint in path for hint in hints)


def infer_requirements(parts: list[str]) -> dict[str, list[str]]:
    path = "/".join(part.lower() for part in parts)
    requirements: dict[str, list[str]] = {}

    if any(token in path for token in ["basic body", "basic dome", "simple", "mk4 astromech simple", "single print", "simpleone"]):
        requirements["build_style"] = ["simple"]
    if "complex body" in path or "complex dome" in path or "complexcut" in path:
        requirements["build_style"] = ["complex"]

    if "250mm" in path or "cutversion" in path or "cut print" in path or "cut main body" in path:
        requirements["printer_size"] = ["small"]
    if "500mm" in path or "single print" in path or "singleprint" in path or "fullring" in path:
        requirements["printer_size"] = ["large"]

    return requirements


def infer_quantity(path: str) -> int:
    filename = path.split("/")[-1]
    match = re.search(r"[xX](\d+)(?=\.stl$|\s|$)", filename)
    if match:
        return max(1, int(match.group(1)))
    return 1


def has_left_marker(parts: list[str], path: str) -> bool:
    left_markers = [
        "left",
        "leftfoot",
        "leftlegonepiece",
        "lshell",
        "lbase",
        "lbattery",
        "lhub",
        "lomni",
        "lsuspension",
        "lwedge",
        "lbooster",
        "lhorseshoe",
    ]
    return (
        "/left/" in path
        or parts[1:2] == ["left"]
        or any(marker in path for marker in left_markers)
    )


def has_right_marker(parts: list[str], path: str) -> bool:
    right_markers = [
        "right",
        "rigth",
        "rightfoot",
        "rightlegonepiece",
        "rshell",
        "rbase",
        "rbattery",
        "rhub",
        "romni",
        "rsuspension",
        "rwedge",
        "rbooster",
        "rhorseshoe",
    ]
    return (
        "/right/" in path
        or "/rigth/" in path
        or parts[1:2] in (["right"], ["rigth"])
        or any(marker in path for marker in right_markers)
    )


def build_part_name(path: str) -> str:
    filename = path.split("/")[-1].rsplit(".", 1)[0]
    clean = re.sub(r"[_-]+", " ", filename)
    clean = re.sub(r"\s+", " ", clean).strip()
    return " ".join(word.capitalize() for word in clean.split()) if clean else filename


def build_part_id(path: str) -> str:
    base = path.rsplit(".", 1)[0].replace("/", "-")
    base = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    return base


def disambiguate_id(base_id: str, bucket: list[dict[str, Any]]) -> str:
    existing_ids = {part.get("id") for part in bucket}
    index = 2
    candidate = f"{base_id}-{index}"
    while candidate in existing_ids:
        index += 1
        candidate = f"{base_id}-{index}"
    return candidate


if __name__ == "__main__":
    raise SystemExit(main())
