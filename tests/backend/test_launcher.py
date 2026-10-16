"""Chinese startup/help output must work with redirected English Windows encodings."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    ("arguments", "status", "stream", "expected"),
    [
        (["--help"], 0, "stdout", "本地求职工作台"),
        (["--port", "0"], 2, "stderr", "port需在1024到65505之间"),
    ],
)
def test_cli_uses_utf8_with_non_unicode_system_output(arguments, status, stream, expected):
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "cp1252"
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[2] / "backend")
    result = subprocess.run(
        [sys.executable, "-m", "easyresume.launcher", *arguments],
        env=environment,
        capture_output=True,
        encoding="utf-8",
        timeout=15,
    )
    assert result.returncode == status, result.stderr
    assert expected in getattr(result, stream)
