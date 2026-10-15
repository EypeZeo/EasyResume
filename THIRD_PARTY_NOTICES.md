# Third-party notices

EasyResume's own code is MIT. Dependency licenses remain in effect; this is not a claim that every bundled component is MIT.

- pypdf: BSD-3-Clause. https://github.com/py-pdf/pypdf/blob/main/LICENSE
- python-docx: MIT. https://github.com/python-openxml/python-docx
- FastAPI / Starlette / SQLAlchemy / Alembic / Pydantic: consult bundled distribution license texts.
- React, WXT, Vite, Tailwind CSS, Lucide: consult generated Node dependency inventory and upstream package notices. The Lucide icon package uses ISC; retain its notice.
- Python runtime and PyInstaller bootloader have their respective licenses; PyInstaller's bootloader distribution exception must be retained with package notices.

`scripts/build.ps1` copies installed Python license texts and generates dependency inventories under the test distribution's `licenses/`. Lockfiles pin exact builds. No code from unrelated job-automation repositories is included.

Before a public binary release, complete the transitive dependency, bundled Python runtime and native library notice review. The current locally built artifact is an unsigned test distribution, not a completed commercial/legal release review.
