"""Create checked release archives from a built package, never from a user data folder."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def archive(source: Path, destination: Path, prefix: str):
    files = sorted(path for path in source.rglob("*") if path.is_file())
    if not files:
        raise ValueError(f"Empty package: {source}")
    for path in files:
        if path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
            raise ValueError("Release package must not contain external links")
        if path.name in {"runtime.json", "instance.lock", ".env"} or re.search(
            r"\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$", path.name, re.I
        ):
            raise ValueError("Local user state must not be distributed")
    with ZipFile(destination, "w", ZIP_DEFLATED, compresslevel=6) as output:
        for path in files:
            output.write(path, f"{prefix}/{path.relative_to(source).as_posix()}")
    with ZipFile(destination) as output:
        bad = output.testzip()
        if bad:
            raise ValueError(f"Corrupt archive entry: {bad}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--package", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", args.version):
        parser.error("Invalid release version")
    package = args.package.resolve()
    root = Path(__file__).resolve().parents[1]
    if not package.is_relative_to(root / "artifacts" / "windows"):
        parser.error("Package must be a build under artifacts/windows")
    required = [
        "EasyResume.exe", "LICENSE", "THIRD_PARTY_NOTICES.md", "README.md", "README.en.md",
        "README.ja.md", "README.ko.md", "docs/DEVELOPMENT.md", "extension/manifest.json",
        "licenses/python-dependencies.json", "licenses/node-dependencies.json",
    ]
    missing = [name for name in required if not (package / name).is_file()]
    if missing:
        parser.error(f"Missing distribution files: {missing}")
    manifest = json.loads((package / "extension/manifest.json").read_text("utf-8"))
    if manifest.get("version_name") != args.version.removeprefix("v"):
        parser.error("Extension version does not match release")
    if set(manifest.get("permissions", [])) - {"storage", "activeTab", "sidePanel"}:
        parser.error("Unexpected extension permissions")
    expected_hosts = {
        "http://127.0.0.1/*", "https://www.zhipin.com/*", "https://zhipin.com/*",
        "https://www.zhaopin.com/*", "https://zhaopin.com/*",
        "https://sou.zhaopin.com/*", "https://jobs.zhaopin.com/*",
    }
    if set(manifest.get("host_permissions", [])) != expected_hosts:
        parser.error("Recruiting tab discovery requires exactly the documented local/BOSS/Zhaopin hosts")
    destination = root / "artifacts/release"
    destination.mkdir(parents=True, exist_ok=True)
    windows = destination / f"EasyResume-{args.version}-windows-x64.zip"
    extension = destination / f"EasyResume-{args.version}-extension.zip"
    archive(package, windows, "EasyResume")
    archive(package / "extension", extension, "extension")
    sums = []
    for path in [windows, extension]:
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        sums.append(f"{digest}  {path.name}")
    (destination / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", "ascii")
    print("Release archives verified; SHA256SUMS.txt generated. Publication is a separate step.")


if __name__ == "__main__":
    main()
