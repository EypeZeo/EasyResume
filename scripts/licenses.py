"""Copy installed Python distributions' license texts into the test distribution."""

import importlib.metadata as metadata
import json
import sys
from pathlib import Path

destination = Path("artifacts/licenses")
destination.mkdir(parents=True, exist_ok=True)
inventory = []
for name in [
    "fastapi",
    "starlette",
    "uvicorn",
    "sqlalchemy",
    "alembic",
    "pydantic",
    "pydantic-core",
    "python-multipart",
    "python-docx",
    "lxml",
    "pypdf",
    "filelock",
    "psutil",
    "tzdata",
    "anyio",
    "h11",
    "click",
    "greenlet",
    "typing-extensions",
    "typing-inspection",
    "annotated-types",
    "annotated-doc",
    "mako",
    "markupsafe",
    "idna",
    "opentelemetry-api",
]:
    dist = metadata.distribution(name)
    files = []
    for file in dist.files or []:
        if any(term in file.name.lower() for term in ["license", "copying", "notice"]) and (
            "dist-info" in str(file) or file.name.upper().startswith("LICENSE")
        ):
            source = dist.locate_file(file)
            if source.is_file():
                target = destination / name / file.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
                files.append(str(target.relative_to(destination)))
    inventory.append(
        {
            "name": name,
            "version": dist.version,
            "license": dist.metadata.get(
                "License-Expression", dist.metadata.get("License", "see package notices")
            ),
            "texts": files,
        }
    )
(destination / "python-dependencies.json").write_text(
    json.dumps(inventory, ensure_ascii=False, indent=2), "utf-8"
)
# Include build-runtime notices too: PyInstaller can bundle setuptools helpers.
for dist in metadata.distributions():
    name = dist.metadata.get("Name", "unknown")
    for file in dist.files or []:
        if file.name.lower().startswith(("license", "copying", "notice")) and "dist-info" in str(file):
            source = dist.locate_file(file)
            if source.is_file():
                target = destination / "python-all-notices" / name / file.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
for root in {Path(sys.base_prefix), Path(sys.executable).parent}:
    for pattern in ["LICENSE*", "license*"]:
        for source in root.glob(pattern):
            if source.is_file():
                target = destination / "python-runtime" / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())

node_notices = 0
for source in Path("node_modules/.pnpm").rglob("*"):
    if source.is_file() and source.name.lower().startswith(("license", "copying", "notice")):
        target = destination / "node-package-notices" / source.relative_to("node_modules/.pnpm")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        node_notices += 1
print(f"Copied license metadata for {len(inventory)} Python distributions.")
print(f"Copied {node_notices} Node package notice files; native library review remains a release gate.")
