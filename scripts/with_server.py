"""Start one local test server, run a command, and terminate its entire process tree."""

import argparse
import shlex
import socket
import subprocess
import sys
import time

import psutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--timeout", default=30, type=int)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not command:
        parser.error("provide a test command after --")
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", args.port)) == 0:
            raise SystemExit("Test port already in use; refusing to test another process")
    server = subprocess.Popen(shlex.split(args.server), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", args.port)) == 0:
                    break
            if server.poll() is not None:
                raise SystemExit("Server exited before becoming ready")
            time.sleep(0.1)
        else:
            raise SystemExit("Local test server startup timed out")
        return subprocess.run(command, check=False).returncode
    finally:
        try:
            children = psutil.Process(server.pid).children(recursive=True)
            for child in reversed(children):
                child.terminate()
            server.terminate()
            psutil.wait_procs(children, timeout=5)
            server.wait(timeout=5)
        except (psutil.NoSuchProcess, ProcessLookupError, subprocess.TimeoutExpired):
            pass


if __name__ == "__main__":
    sys.exit(main())
