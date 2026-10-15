"""Exercise the actual Windows executable in a disposable data directory."""

import io
import json
import socket
import subprocess
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
import psutil
from docx import Document

executable = Path("artifacts/windows/EasyResume/EasyResume.exe").resolve()
assert executable.is_file(), "Build the Windows test distribution first"
with TemporaryDirectory(prefix="easyresume-frozen-") as directory:
    root = Path(directory)
    with socket.socket() as occupied, (root / "server.log").open("w", encoding="utf-8") as log:
        occupied.bind(("127.0.0.1", 8780))
        occupied.listen()
        command = [str(executable), "--no-browser", "--data-dir", directory, "--port", "8780"]
        process = subprocess.Popen(command, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 40
            info = None
            while time.monotonic() < deadline:
                assert process.poll() is None, (root / "server.log").read_text("utf-8")
                runtime = root / "runtime.json"
                if runtime.exists():
                    info = json.loads(runtime.read_text("utf-8"))
                    try:
                        if httpx.get(info["url"] + "/api/v1/health", timeout=1).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                time.sleep(0.2)
            else:
                raise AssertionError("Frozen server startup timeout")
            assert info["url"] != "http://127.0.0.1:8780", "Occupied port must not be reused"
            duplicate = subprocess.run(command, capture_output=True, timeout=15)
            assert duplicate.returncode == 0
            assert json.loads(runtime.read_text("utf-8")) == info, (
                "Duplicate launch replaced running instance"
            )
            base = info["url"]
            headers = {"Origin": base, "X-EasyResume-Client": "workbench"}
            token = httpx.post(base + "/api/v1/session", headers=headers).json()["token"]
            headers["Authorization"] = f"Bearer {token}"
            assert "<html" in httpx.get(base).text.lower()
            assert httpx.get(base + "/api/v1/state", headers=headers).json()["profiles"] == []
            document = Document()
            document.add_paragraph("合成打包测试简历，本科，Python")
            content = io.BytesIO()
            document.save(content)
            result = httpx.post(
                base + "/api/v1/profiles/upload",
                headers=headers,
                files={"file": ("synthetic.docx", content.getvalue())},
                timeout=35,
            )
            assert result.status_code == 200, result.text
            assert result.json()["profile"]["education_completed"] == "本科"
            assert result.json()["format"] == "docx"
            assert not httpx.get(base + "/api/v1/health").json()["verified_actions"]
            print(
                json.dumps(
                    {
                        "result": "PASS",
                        "executable": "EasyResume.exe",
                        "checks": [
                            "startup",
                            "bundled frontend",
                            "occupied port",
                            "single instance",
                            "empty user workspace",
                            "DOCX spawned parser",
                            "sending disabled",
                        ],
                        "clean_windows_verified": False,
                    }
                )
            )
        finally:
            if process.poll() is None:
                children = psutil.Process(process.pid).children(recursive=True)
                for child in children:
                    child.terminate()
                process.terminate()
                process.wait(timeout=10)
                psutil.wait_procs(children, timeout=5)
