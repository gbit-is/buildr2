#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


DIRECT_PARTS_KEY = "__parts"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate an R2-D2 config from a template and a source STL directory."
    )
    parser.add_argument("source_dir", help="Root directory of the R2-D2 file set")
    parser.add_argument("output_file", help="Where to write the generated JSON")
    parser.add_argument(
        "--template",
        default="data/droid-types/r2d2.template.json",
        help="Template JSON to use as a starting point"
    )
    args = parser.parse_args()

    source_dir = Path(args.source_dir).expanduser().resolve()
    template_path = Path(args.template).expanduser().resolve()
    output_file = Path(args.output_file).expanduser().resolve()

    if not source_dir.exists() or not source_dir.is_dir():
      raise SystemExit(f"Not a directory: {source_dir}")

    if not template_path.exists():
      raise SystemExit(f"Template not found: {template_path}")

    config = json.loads(template_path.read_text(encoding="utf-8"))
    sections = {section["id"]: section for section in config.get("sections", [])}

    reset_section_categories(sections)
    populate_body_simple(source_dir, sections.get("body"))
    populate_dome_simple(source_dir, sections.get("dome"))
    populate_leg(source_dir / "Legs" / "Left", sections.get("left-leg"), side="left")
    populate_leg(source_dir / "Legs" / "Right", sections.get("right-leg"), side="right")

    output_file.write_text(f"{json.dumps(config, indent=2)}\n", encoding="utf-8")
    print(f"Wrote {output_file}")
    return 0


def reset_section_categories(sections: dict[str, dict]) -> None:
    for section in sections.values():
        if not section:
            continue
        section["categories"] = {
            "main": [],
            "greebles": []
        }


def populate_body_simple(source_dir: Path, body_section: dict | None) -> None:
    if not body_section:
        return

    body_root = source_dir / "Body" / "Basic Body"
    if not body_root.exists():
        return

    small_root = body_root / "250mm Cut Main Body"
    large_root = body_root / "500mm Cut Main Body"

    add_parts_from_tree(
        body_section,
        small_root,
        ["main"],
        requirements={"build_style": ["simple"], "printer_size": ["small"]},
        preserve_tree=False
    )
    add_parts_from_tree(
        body_section,
        large_root,
        ["main"],
        requirements={"build_style": ["simple"], "printer_size": ["large"]},
        preserve_tree=False
    )

    for child in sorted(body_root.iterdir(), key=lambda item: item.name.lower()):
        if child.name in {"250mm Cut Main Body", "500mm Cut Main Body"}:
            continue
        if not child.is_dir():
            continue

        add_parts_from_tree(
            body_section,
            child,
            [child.name],
            requirements={"build_style": ["simple"]},
            preserve_tree=True
        )


def populate_dome_simple(source_dir: Path, dome_section: dict | None) -> None:
    if not dome_section:
        return

    dome_root = source_dir / "Dome" / "Basic Dome"
    if not dome_root.exists():
        return

    greebles_root = dome_root / "Greebles"
    if greebles_root.exists():
        for child in sorted(greebles_root.iterdir(), key=lambda item: item.name.lower()):
            if child.is_dir():
                add_parts_from_tree(
                    dome_section,
                    child,
                    ["greebles", child.name],
                    requirements={"build_style": ["simple"]},
                    preserve_tree=True
                )
            elif is_stl_file(child):
                add_direct_part(
                    dome_section,
                    ["greebles"],
                    part_from_file(
                        child,
                        greebles_root,
                        requirements={"build_style": ["simple"]}
                    )
                )

    add_parts_from_tree(
        dome_section,
        dome_root / "Single Print",
        ["main"],
        requirements={"build_style": ["simple"], "printer_size": ["large"]},
        preserve_tree=False
    )
    add_parts_from_tree(
        dome_section,
        dome_root / "CutVersion",
        ["main"],
        requirements={"build_style": ["simple"], "printer_size": ["small"]},
        preserve_tree=False
    )


def populate_leg(leg_root: Path, leg_section: dict | None, *, side: str) -> None:
    if not leg_section or not leg_root.exists():
        return

    shoulder_name = f"{side.title()}Shoulder.stl"
    ankle_name = f"{side.title()}Ankle(STD).stl"
    leg_name = f"{side.title()}Leg.stl"
    main_filenames = {shoulder_name.lower(), ankle_name.lower(), leg_name.lower()}

    for file_path in sorted(leg_root.rglob("*.stl"), key=lambda item: str(item).lower()):
        relative_parent = file_path.relative_to(leg_root).parent
        part = part_from_file(file_path, leg_root)
        if file_path.name.lower() in main_filenames:
            add_direct_part(leg_section, ["main"], part)
            continue

        category_path = ["greebles"]
        if relative_parent != Path("."):
            category_path.extend(relative_parent.parts)
        add_direct_part(leg_section, category_path, part)


def add_parts_from_tree(
    section: dict,
    root: Path,
    category_path: list[str],
    *,
    requirements: dict[str, list[str]] | None,
    preserve_tree: bool
) -> None:
    if not root.exists():
        return

    for file_path in sorted(root.rglob("*.stl"), key=lambda item: str(item).lower()):
        relative_parent = file_path.relative_to(root).parent
        path = list(category_path)
        if preserve_tree and relative_parent != Path("."):
            path.extend(relative_parent.parts)

        add_direct_part(
            section,
            path,
            part_from_file(file_path, root, requirements=requirements)
        )


def part_from_file(
    file_path: Path,
    base_root: Path,
    *,
    requirements: dict[str, list[str]] | None = None
) -> dict:
    relative_path = file_path.relative_to(base_root).as_posix()
    part = {
        "id": slugify(file_path.stem),
        "name": build_part_name(file_path.stem),
        "files": [relative_path]
    }

    quantity = infer_quantity(file_path.stem)
    if quantity > 1:
        part["quantity"] = quantity

    if requirements:
        part["requirements"] = clone_requirements(requirements)

    return part


def add_direct_part(section: dict, category_path: list[str], part: dict) -> None:
    categories = section.setdefault("categories", {})
    bucket = get_or_create_bucket(categories, category_path)
    bucket.append(part)


def get_or_create_bucket(categories: dict, path: list[str]) -> list[dict]:
    if not path:
        raise ValueError("Category path cannot be empty")

    key = path[0]
    is_leaf = len(path) == 1

    if is_leaf:
        existing = categories.get(key)
        if isinstance(existing, list):
            return existing
        if isinstance(existing, dict):
            parts = existing.setdefault(DIRECT_PARTS_KEY, [])
            return parts
        categories[key] = []
        return categories[key]

    existing = categories.get(key)
    if isinstance(existing, list):
        categories[key] = {DIRECT_PARTS_KEY: existing}
        existing = categories[key]
    elif not isinstance(existing, dict):
        categories[key] = {}
        existing = categories[key]

    return get_or_create_bucket(existing, path[1:])


def infer_quantity(stem: str) -> int:
    match = re.search(r"(?:^|[^a-z0-9])x(\d+)(?:$|[^a-z0-9])", stem.lower())
    if match:
        return max(1, int(match.group(1)))
    return 1


def build_part_name(stem: str) -> str:
    text = stem.replace("_", " ").replace("-", " ").strip()
    words = [word for word in re.split(r"\s+", text) if word]
    return " ".join(word.capitalize() for word in words) if words else stem


def clone_requirements(requirements: dict[str, list[str]]) -> dict[str, list[str]]:
    return {key: list(values) for key, values in requirements.items()}


def slugify(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def is_stl_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() == ".stl"


if __name__ == "__main__":
    raise SystemExit(main())
