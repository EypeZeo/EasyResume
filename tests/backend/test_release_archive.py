"""Distribution archives contain the package tree, never runtime user data."""

import runpy
from pathlib import Path
from zipfile import ZipFile

import pytest

archive = runpy.run_path(str(Path(__file__).resolve().parents[2] / "scripts/package_release.py"))["archive"]


def test_archive_keeps_complete_directory_and_relative_paths(tmp_path):
    package = tmp_path / "package"
    (package / "_internal").mkdir(parents=True)
    (package / "EasyResume.exe").write_bytes(b"synthetic executable")
    (package / "_internal/runtime.dll").write_bytes(b"synthetic runtime")
    destination = tmp_path / "release.zip"
    archive(package, destination, "EasyResume")
    with ZipFile(destination) as result:
        assert set(result.namelist()) == {"EasyResume/EasyResume.exe", "EasyResume/_internal/runtime.dll"}
        assert result.testzip() is None


@pytest.mark.parametrize("filename", ["runtime.json", "instance.lock", "local.db", "workspace.sqlite", "data.sqlite3-wal", ".env"])
def test_archive_rejects_runtime_data_before_creating_zip(tmp_path, filename):
    package = tmp_path / "package"
    package.mkdir()
    (package / filename).write_text("synthetic private state", "utf-8")
    destination = tmp_path / "release.zip"
    with pytest.raises(ValueError, match="user state"):
        archive(package, destination, "EasyResume")
    assert not destination.exists()


def test_beginner_manuals_have_working_relative_links():
    import re

    root = Path(__file__).resolve().parents[2]
    for filename in ["README.md", "README.en.md", "README.ja.md", "README.ko.md"]:
        text = (root / filename).read_text("utf-8")
        for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", text):
            if "://" not in target:
                assert (root / target).is_file(), (filename, target)
        assert "v0.2.0-beta.1-windows-x64.zip" in text
        assert "保存简历版本" in text
        assert "确认发送脱敏文本" in text
