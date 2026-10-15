"""Reject personal identifiers in committed synthetic fixtures; not a complete anonymizer."""

import re
from pathlib import Path

errors = []
for path in Path("tests/fixtures").rglob("*"):
    if not path.is_file():
        continue
    if path.suffix.lower() not in {".json", ".txt", ".html", ".md"}:
        errors.append(f"{path}: binary fixtures require separate permission review")
        continue
    text = path.read_text("utf-8")
    if not any(mark in text.lower() for mark in ["synthetic", "合成"]):
        errors.append(f"{path}: fixture origin must be declared")
    if re.search(
        r"(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)|(?:Authorization|Cookie|Bearer|api[_-]?key)\s*[:=]",
        text,
        re.I,
    ):
        errors.append(f"{path}: identifier or credential-like material")
if errors:
    raise SystemExit("\n".join(errors))
print("Fixture privacy check passed. Synthetic fixtures do not prove real platform compatibility.")
