# Third-party notices

EasyResume's own code is MIT. Dependency licenses remain in effect; this is not a claim that every bundled component is MIT.

The application and extension logo adapts Lucide `FileCheck2` (ISC). Commercial use is permitted with the retained notice in `brand/LICENSE-LUCIDE.txt` (Windows package) or `LICENSE-LUCIDE.txt` (extension); editable assets and provenance are in `assets/brand/` in the source repository.

- pypdf: BSD-3-Clause. https://github.com/py-pdf/pypdf/blob/main/LICENSE
- python-docx: MIT. https://github.com/python-openxml/python-docx
- FastAPI / Starlette / SQLAlchemy / Alembic / Pydantic: consult bundled distribution license texts.
- React, WXT, Vite, Tailwind CSS, Lucide: consult generated Node dependency inventory and upstream package notices. The Lucide icon package uses ISC; retain its notice.
- Python runtime and PyInstaller bootloader have their respective licenses; PyInstaller's bootloader distribution exception must be retained with package notices.

`scripts/build.ps1` copies installed Python license texts and generates dependency inventories under the test distribution's `licenses/`. Lockfiles pin exact builds. No code from unrelated job-automation repositories is included.

## Windows v0.2.0-beta.1 distribution

The release retains the installed dependency notices and inventories under `licenses/`:

| Component | Included notice/source |
|---|---|
| Python runtime | `python-runtime/LICENSE.txt`, including PSF/history and Windows Microsoft Distributable Code conditions; `native/python-3.12.14-third-party.html` contains the official full third-party license page |
| PyInstaller bootloader | `python-all-notices/pyinstaller/COPYING.txt`, including its bootloader distribution exception |
| lxml, libxml2, libxslt, libexslt | `lxml/LICENSE.txt` and `lxml/LICENSES.txt`, plus complete pinned source archives in `native/` |
| GNU libiconv | `native/lgpl-2.1.txt`, full source archive and Windows build inputs; replacement/relink instructions in `native/REBUILD-LXML.md` |
| OpenSSL, libffi, Expat, zlib, liblzma | Versioned license files in `native/`; Python's full third-party license page retains additional standard-library notices |
| SQLite | SQLite is in the public domain; see [upstream copyright statement](https://sqlite.org/copyright.html) |
| certifi CA bundle | `certifi/LICENSE` retains the copyright notice and `native/MPL-2.0.txt` provides the full terms; unchanged PEM source data is included under `_internal/certifi`, with upstream source at [certifi](https://github.com/certifi/python-certifi) |
| JavaScript libraries and icons | `node-dependencies.json` and the retained package license texts under `node-package-notices/` |

Native source archives are shipped with the Windows package, not merely linked. `native/sources.json` records fixed upstream URLs and SHA-256 values. The build verifies every cached/downloaded file and fails if a required notice is absent, download fails, or a checksum changes. Source archives are supplied for license compliance and rebuilding; they are not executed by the application.

The shipped lxml Windows wheel uses LGPL libiconv in addition to its BSD/MIT components. Users may modify or replace that component and rebuild the lxml modules; EasyResume imposes no restriction on reverse engineering needed to debug such modifications. The included upstream source and build instructions document this path. Each component retains its own license; EasyResume's MIT license does not relicense third-party code.

This review covers retained notices and source availability for this test distribution. It does not certify a modified third-party build, code-signing status, or platform compatibility. When changing dependencies, runtime versions or native build inputs, update and verify the inventory and source pins again. This Windows test package is unsigned.
