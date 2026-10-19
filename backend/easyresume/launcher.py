import argparse
import json
import multiprocessing
import os
import socket
import subprocess
import sys
import webbrowser
from pathlib import Path

from filelock import FileLock, Timeout

JOB_PAGES = (
    "https://www.zhipin.com/web/geek/jobs",
    "https://www.zhaopin.com/recommend",
)


def open_browser(url: str, browser: str = "system", open_jobs: bool = False) -> bool:
    urls = [url, *JOB_PAGES] if open_jobs else [url]
    if browser == "system":
        return all([webbrowser.open(page) for page in urls])
    if browser != "chrome":
        raise ValueError("不支持的浏览器")
    locations = (
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")),
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")),
        Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")),
    )
    for root in locations:
        executable = root / "Google" / "Chrome" / "Application" / "chrome.exe"
        if executable.is_file():
            try:
                subprocess.Popen([str(executable), *urls], close_fds=True)
                return True
            except OSError:
                break
    print(f"未能打开正式 Chrome。工作台仍在运行，请在 Chrome 手动打开：{url}")
    return False


def default_data_dir() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share"))
    return root / "EasyResume"


def static_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "frontend"
    return Path(__file__).resolve().parents[2] / "apps" / "workbench" / "dist"


def choose_port(preferred: int) -> int:
    for port in range(preferred, min(preferred + 30, 65536)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("本地端口均被占用，请更换起始端口")


def main():
    multiprocessing.freeze_support()
    # Redirected Windows output otherwise inherits the system ANSI code page.
    # Keep both startup messages and diagnostics readable on non-Chinese systems.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="EasyResume 本地求职工作台")
    parser.add_argument(
        "--data-dir", type=Path, default=default_data_dir(), help="默认固定用户数据目录；测试可指定隔离目录"
    )
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--browser", choices=("system", "chrome"), default="system")
    parser.add_argument("--open-jobs", action="store_true", help="同时打开BOSS和智联职位入口")
    parser.add_argument("--dev", action="store_true", help="仅开发时允许本地Vite源")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65505:
        parser.error("port需在1024到65505之间")
    args.data_dir.mkdir(parents=True, exist_ok=True)
    lock = FileLock(args.data_dir / "instance.lock", timeout=0)
    runtime = args.data_dir / "runtime.json"
    try:
        lock.acquire()
    except Timeout:
        if runtime.exists():
            info = json.loads(runtime.read_text("utf-8"))
            print(f"EasyResume 已在运行：{info['url']}")
            if not args.no_browser:
                open_browser(info["url"], args.browser, args.open_jobs)
        else:
            print("EasyResume 正在启动，请稍后重试。")
        return
    try:
        import uvicorn

        from easyresume.api import create_app

        port = choose_port(args.port)
        url = f"http://127.0.0.1:{port}"
        app = create_app(args.data_dir, development=args.dev, static_dir=static_directory())
        runtime.write_text(json.dumps({"url": url, "pid": os.getpid(), "instance": app.state.epoch}), "utf-8")
        print(
            f"EasyResume 本地工作台：{url}\n数据目录：{args.data_dir}\n平台发送未验证，仅支持只读采集及草稿。"
        )
        if not args.no_browser:
            import threading

            threading.Timer(1.5, lambda: open_browser(url, args.browser, args.open_jobs)).start()
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
    finally:
        runtime.unlink(missing_ok=True)
        lock.release()


if __name__ == "__main__":
    main()
