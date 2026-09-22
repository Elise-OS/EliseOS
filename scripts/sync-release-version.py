#!/usr/bin/env python3
"""Synchronize release metadata with the version selected by GitHub Actions.

The release tag is the source of truth.  This script keeps the versions exposed
by the workspace, the Raspberry defaults, the mobile package, and the
Home Assistant bridge aligned with that tag.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STABLE_TAG = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
JSON_VERSION_LINE = re.compile(r'(?m)^([ \t]*"version"[ \t]*:[ \t]*)"[^"\r\n]*"')


def package_manifests() -> list[Path]:
    return [
        ROOT / "package.json",
        *sorted((ROOT / "apps").glob("*/package.json")),
        *sorted((ROOT / "packages").glob("*/package.json")),
    ]


def json_version(
    path: Path,
    version: str,
    write: bool,
    field_path: tuple[str, ...] = ("version",),
) -> bool:
    original = path.read_text(encoding="utf-8")
    document = json.loads(original)
    value: object = document
    for key in field_path:
        if not isinstance(value, dict) or key not in value:
            raise ValueError(f"{path.relative_to(ROOT)} does not expose a version field")
        value = value[key]
    if not isinstance(value, str):
        raise ValueError(f"{path.relative_to(ROOT)} does not expose a version field")

    match = JSON_VERSION_LINE.search(original)
    if match is None:
        raise ValueError(f"{path.relative_to(ROOT)} has no writable version line")

    updated = (
        original[: match.start()]
        + match.group(1)
        + json.dumps(version)
        + original[match.end() :]
    )
    parsed = json.loads(updated)
    parsed_value: object = parsed
    for key in field_path:
        parsed_value = parsed_value[key]
    if parsed_value != version:
        raise ValueError(f"failed to update {path.relative_to(ROOT)}")
    if updated == original:
        return False
    if write:
        path.write_text(updated, encoding="utf-8")
    return True


def replace_line(path: Path, pattern: re.Pattern[str], replacement: str, write: bool) -> bool:
    original = path.read_text(encoding="utf-8")
    updated, count = pattern.subn(replacement, original)
    if count == 0:
        raise ValueError(f"{path.relative_to(ROOT)} has no matching version metadata")
    if updated == original:
        return False
    if write:
        path.write_text(updated, encoding="utf-8")
    return True


def synchronize(version: str, check: bool) -> int:
    tag = version if version.startswith("v") else f"v{version}"
    match = STABLE_TAG.fullmatch(tag)
    if match is None:
        raise ValueError("expected a stable release tag such as v0.1.2")
    plain_version = ".".join(match.groups())

    changed: list[Path] = []

    json_paths = [
        *package_manifests(),
        ROOT / "apps/mobile/app.json",
        ROOT / "docker/homeassistant/custom_components/michel_bridge/manifest.json",
    ]
    write = not check
    for path in json_paths:
        field_path = ("expo", "version") if path.name == "app.json" else ("version",)
        if json_version(path, plain_version, write, field_path):
            changed.append(path)

    line_updates = [
        (
            ROOT / "apps/ai/pyproject.toml",
            re.compile(r'(?m)^version[ \t]*=[ \t]*"[^"]*"$'),
            f'version = "{plain_version}"',
        ),
        (
            ROOT / ".env.example",
            re.compile(r"(?m)^MICHEL_VERSION=.*$"),
            f"MICHEL_VERSION={plain_version}",
        ),
        (
            ROOT / "compose.yaml",
            re.compile(r"(MICHEL_VERSION:-)\d+\.\d+\.\d+"),
            rf"\g<1>{plain_version}",
        ),
        (
            ROOT / "compose.raspberry.yaml",
            re.compile(r"(MICHEL_VERSION:-)\d+\.\d+\.\d+"),
            rf"\g<1>{plain_version}",
        ),
        (
            ROOT / "docker/homeassistant/custom_components/michel_bridge/__init__.py",
            re.compile(r'("status": "online", "version": ")[^"]+(")'),
            rf"\g<1>{plain_version}\g<2>",
        ),
    ]
    for path, pattern, replacement in line_updates:
        if replace_line(path, pattern, replacement, write):
            changed.append(path)

    relative = [str(path.relative_to(ROOT)) for path in changed]
    if check:
        if relative:
            print("version metadata is out of sync:")
            print("\n".join(f"- {path}" for path in relative))
            return 1
        print(f"version metadata already matches {tag}")
        return 0

    if relative:
        print(f"synchronized {tag} in {len(relative)} files")
        print("\n".join(f"- {path}" for path in relative))
    else:
        print(f"version metadata already matches {tag}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="stable release tag, for example v0.1.2")
    parser.add_argument(
        "--check",
        action="store_true",
        help="only verify metadata; do not write files",
    )
    args = parser.parse_args()
    try:
        return synchronize(args.version, args.check)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
