"""Copy installed Python distributions' license texts into the test distribution."""

import hashlib
import importlib.metadata as metadata
import json
import ssl
import sys
import time
import urllib.error
import urllib.request
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
    "httpx",
    "httpcore",
    "certifi",
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

def is_notice(name):
    name = name.lower()
    return name in {"license", "licence", "copying", "notice", "copyright"} or any(
        name == stem + suffix
        for stem in ["license", "licence", "copying", "notice", "copyright"]
        for suffix in [".txt", ".md", ".rst", ".bsd", ".apache", "-mit", "-apache"]
    )


node_notices = 0
for source in Path("node_modules/.pnpm").rglob("*"):
    if source.is_file() and is_notice(source.name):
        target = destination / "node-package-notices" / source.relative_to("node_modules/.pnpm")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        node_notices += 1

# Remove previously collected license-* source/test files, not real license texts.
node_destination = (destination / "node-package-notices").resolve()
for target in node_destination.rglob("*"):
    if target.is_file() and target.resolve().is_relative_to(node_destination) and not is_notice(target.name):
        target.unlink()

# Windows lxml wheels statically link libiconv. Ship the corresponding source and
# build inputs, rather than treating a URL or the wheel's short notice as enough.
if metadata.version("lxml") != "6.1.3":
    raise RuntimeError("Review native source/license pins before changing the lxml version")
if not ssl.OPENSSL_VERSION.startswith("OpenSSL 3."):
    raise RuntimeError("Review the OpenSSL notice when changing its major version")
native_sources = [
    ("MPL-2.0.txt", "https://www.mozilla.org/media/MPL/2.0/index.815ca599c9df.txt", "fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85"),
    ("python-3.12.14-third-party.html", "https://docs.python.org/release/3.12.14/license.html", "94c99e6ce3dbd328dfe964962b77fef0ad4a00f22406473ce88cb049e1194ef8"),
    ("openssl-3.5.8-LICENSE.txt", "https://raw.githubusercontent.com/openssl/openssl/openssl-3.5.8/LICENSE.txt", "7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a"),
    ("libffi-3.4.4-LICENSE.txt", "https://raw.githubusercontent.com/libffi/libffi/v3.4.4/LICENSE", "2c9c2acb9743e6b007b91350475308aee44691d96aa20eacef8e199988c8c388"),
    ("lgpl-2.1.txt", "https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt", "20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95"),
    ("expat-2.8.3-COPYING.txt", "https://raw.githubusercontent.com/libexpat/libexpat/R_2_8_3/expat/COPYING", "31b15de82aa19a845156169a17a5488bf597e561b2c318d159ed583139b25e87"),
    ("xz-5.8.2-COPYING.txt", "https://raw.githubusercontent.com/tukaani-project/xz/v5.8.2/COPYING", "616a3ad264ce29b8f1cb97e53037b139d406899ca8d1f799651e17bfa09830b8"),
    ("xz-5.8.2-COPYING.0BSD", "https://raw.githubusercontent.com/tukaani-project/xz/v5.8.2/COPYING.0BSD", "0b01625d853911cd0e2e088dcfb743261034a091bb379246cb25a14cc4c74bf1"),
    ("zlib-1.3.2-LICENSE.txt", "https://raw.githubusercontent.com/madler/zlib/v1.3.2/LICENSE", "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2"),
    ("lxml-6.1.3-sdist.tar.gz", "https://files.pythonhosted.org/packages/23/ad/28ecd7cb894d172f3c9c80a075eeeb2017ac62e3632cee05a5f9493547eb/lxml-6.1.3.tar.gz", "45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21"),
    ("libxml2-win-binaries-2026.05.17.tar.gz", "https://codeload.github.com/lxml/libxml2-win-binaries/tar.gz/refs/tags/2026.05.17", "ed1e59196361c8753e2c2d5ce4d2ad5f2c721a1876479f08e918e93c00750813"),
    ("libiconv-880a1fa8.tar.gz", "https://github.com/winlibs/libiconv/archive/880a1fa8b5581e37e136a7b051947d3ea39097b6.tar.gz", "89dd45d7f074ddae04dcd25cc4ceace3432c04b72dc36a6508854aac713f3eb6"),
    ("libxml2-bb846788.tar.gz", "https://github.com/winlibs/libxml2/archive/bb84678855e3407fc88180295c992f9c984e28e0.tar.gz", "5182396205f97b183d34ab8dadd7693523c7d4e2137394aec02514a5a9a9dcf0"),
    ("libxslt-c0076eaa.tar.gz", "https://github.com/winlibs/libxslt/archive/c0076eaa6e0d1f99e01107e8db225a308eb1e543.tar.gz", "d687aaf48527e042d942dccbc74fbcd150588522305e63d3e91785d9b6590677"),
    ("zlib-0089522e.tar.gz", "https://github.com/winlibs/zlib/archive/0089522e62e6b5d4950e62bd20f0cb06a9288413.tar.gz", "e2af9f28fcdf723e464b40af73fdeed07ce3e581a9ea110702c1ba733983f8a0"),
]
native = destination / "native"
native.mkdir(parents=True, exist_ok=True)
expected_native_names = {name for name, _, _ in native_sources} | {"sources.json", "REBUILD-LXML.md"}
for obsolete in native.iterdir():
    if obsolete.is_file() and obsolete.resolve().is_relative_to(native.resolve()) and obsolete.name not in expected_native_names:
        obsolete.unlink()
for name, url, expected in native_sources:
    target = native / name
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
        continue
    for attempt in range(3):
        try:
            print(f"Fetching native notice/source: {name} (attempt {attempt + 1}/3)", flush=True)
            with urllib.request.urlopen(url, timeout=20) as response:
                data = response.read(35_000_001)
            break
        except (OSError, urllib.error.URLError) as error:
            if attempt == 2:
                raise RuntimeError(f"Unable to download required native notice/source: {name}") from error
            time.sleep(2 ** attempt)
    if len(data) > 35_000_000 or hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(f"Native notice/source integrity check failed: {name}")
    target.write_bytes(data)
(native / "sources.json").write_text(json.dumps([
    {"file": name, "url": url, "sha256": digest} for name, url, digest in native_sources
], indent=2), "utf-8")
(native / "REBUILD-LXML.md").write_text("""# Native source and replacement information

This package includes lxml 6.1.3, using libxml2 2.11.9 and libxslt 1.1.45.
The Windows wheel was published on PyPI on 2026-09-02. Its build uses the
2026.05.17 lxml/libxml2-win-binaries release: libiconv 1.17.1, libxml2 2.11.9,
libxslt 1.1.45 and zlib 1.3.2. The immutable upstream submodule commits and
checksums are recorded in sources.json. Source archives are included here.

GNU libiconv is LGPL-2.1-or-later; see lgpl-2.1.txt and its archive's COPYING.LIB.
You may modify this library and replace/relink the lxml module that uses it.
No EasyResume restriction prohibits reverse engineering for debugging changes
to LGPL components. EasyResume source is MIT and available with this release.

To rebuild with modified libiconv:
1. Unpack libxml2-win-binaries-2026.05.17.tar.gz. Unpack each of the four
   dependency archives into its named libiconv/libxml2/libxslt/zlib directory.
2. Follow the included build repository README.md and build.ps1 with the
   Microsoft C++ build tools. Retain the included libiconv.patch and apply the
   build script's configuration. Use x64 for this x64 distribution.
3. Unpack lxml-6.1.3-sdist.tar.gz (includes generated C sources). Follow its
   INSTALL.txt and setup.py Windows build instructions with CPython 3.12 x64.
   Set LXML_STATIC_INCLUDE_DIRS and LXML_STATIC_LIBRARY_DIRS to semicolon-separated
   rebuilt dependency include/lib directories, then run
   python setup.py build_ext --static
   with STATIC_DEPS unset. These variables and --static are read by the included
   setup.py/setupinfo.py. Do not use --static-deps: it downloads stock libraries
   instead of your modified library.
4. Close EasyResume, preserve a copy of _internal/lxml, and replace its matching
   CPython 3.12 x64 .pyd modules with the rebuilt modules. The package does not
   check their hashes or prevent replacement. Restart and test DOCX parsing.

These are upstream build instructions and source availability, not a claim that
EasyResume has tested every compiler or a modified libiconv build. The full
license texts in the source archives govern the respective components.
""", "utf-8")
required = [destination / "python-runtime/LICENSE.txt", destination / "lxml/LICENSES.txt",
            destination / "python-all-notices/pyinstaller/COPYING.txt"]
for target in required:
    if not target.is_file():
        raise RuntimeError(f"Required bundled runtime notice missing: {target}")
if "bootloader" not in required[-1].read_text("utf-8").lower():
    raise RuntimeError("PyInstaller bootloader exception notice missing")
print(f"Copied license metadata for {len(inventory)} Python distributions.")
print(f"Copied {node_notices} Node notices and verified {len(native_sources)} pinned native notices/source archives.")
