import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from easyresume.api import create_app

sys.stdout.reconfigure(encoding="utf-8")
with TemporaryDirectory() as directory:
    app = create_app(Path(directory))
    schema = app.openapi()
    app.state.sessions.kw["bind"].dispose()
    print(json.dumps(schema, ensure_ascii=False))
