import json
import subprocess
from unittest.mock import Mock

import pytest
from easyresume import launcher
from filelock import Timeout


@pytest.fixture
def browser_mocks(monkeypatch, tmp_path):
    roots = [tmp_path / "Program Files", tmp_path / "Program Files (x86)", tmp_path / "用户"]
    for key, root in zip(("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"), roots, strict=True):
        monkeypatch.setenv(key, str(root))
    process = Mock()
    system = Mock(return_value=True)
    monkeypatch.setattr(subprocess, "Popen", process)
    monkeypatch.setattr(launcher.webbrowser, "open", system)
    return roots, process, system


@pytest.mark.parametrize("index", [0, 1, 2])
def test_chrome_uses_an_installed_official_location_without_shell_or_profile_flags(browser_mocks, index):
    roots, process, system = browser_mocks
    executable = roots[index] / "Google/Chrome/Application/chrome.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    assert launcher.open_browser("http://127.0.0.1:8765", "chrome")
    process.assert_called_once_with([str(executable), "http://127.0.0.1:8765"], close_fds=True)
    system.assert_not_called()


def test_open_jobs_passes_only_the_workbench_and_two_fixed_recruiting_entries(browser_mocks):
    roots, process, system = browser_mocks
    executable = roots[0] / "Google/Chrome/Application/chrome.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    assert launcher.open_browser("http://127.0.0.1:8790", "chrome", open_jobs=True)
    process.assert_called_once_with(
        [str(executable), "http://127.0.0.1:8790", *launcher.JOB_PAGES], close_fds=True,
    )
    system.assert_not_called()


@pytest.mark.parametrize("launch_error", [False, True])
def test_chrome_failure_does_not_silently_open_a_different_browser(browser_mocks, capsys, launch_error):
    roots, process, system = browser_mocks
    if launch_error:
        executable = roots[0] / "Google/Chrome/Application/chrome.exe"
        executable.parent.mkdir(parents=True)
        executable.touch()
        process.side_effect = OSError("synthetic launch failure")
    assert not launcher.open_browser("http://127.0.0.1:8765", "chrome")
    assert "工作台仍在运行" in capsys.readouterr().out
    system.assert_not_called()


def test_system_browser_remains_the_cli_default(browser_mocks):
    _, process, system = browser_mocks
    assert launcher.open_browser("http://127.0.0.1:8765")
    system.assert_called_once_with("http://127.0.0.1:8765")
    process.assert_not_called()


@pytest.mark.parametrize("no_browser", [False, True])
def test_existing_service_honors_explicit_browser_options_without_starting_another_service(monkeypatch, tmp_path, no_browser):
    url = "http://127.0.0.1:8765"
    (tmp_path / "runtime.json").write_text(json.dumps({"url": url}), encoding="utf-8")

    class BusyLock:
        def acquire(self):
            raise Timeout("synthetic-lock")

    open_browser = Mock()
    monkeypatch.setattr(launcher, "FileLock", lambda *_args, **_kwargs: BusyLock())
    monkeypatch.setattr(launcher, "open_browser", open_browser)
    arguments = ["EasyResume", "--data-dir", str(tmp_path), "--browser", "chrome", "--open-jobs"]
    monkeypatch.setattr(launcher.sys, "argv", arguments + (["--no-browser"] if no_browser else []))
    launcher.main()
    if no_browser:
        open_browser.assert_not_called()
    else:
        open_browser.assert_called_once_with(url, "chrome", True)
