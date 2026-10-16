"""Synthetic-only layout and connection screen checks against the built workbench."""

import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("EASYRESUME_LAYOUT_URL", "http://127.0.0.1:4173")
output = Path("artifacts/screenshots")
output.mkdir(parents=True, exist_ok=True)
state = {
    "profiles": [
        {
            "id": "synthetic-long-profile",
            "data": {
                "name": "合成简历长名称" * 10,
                "education_completed": "本科",
                "skills": ["VeryLongSyntheticSkillNameWithoutSpaces" * 5, "Linux"],
                "confirmed": True,
            },
            "version": 1,
            "archived": False,
            "created_at": "2026-10-16T00:00:00Z",
        }
    ],
    "strategies": [],
    "jobs": [],
    "blacklist": [],
    "drafts": [],
    "observations": [],
    "outcomes": [],
    "connections": [],
    "current_strategy_id": None,
}


def api(route):
    path = route.request.url.split("/api/v1/")[-1].split("?")[0]
    if path == "session":
        body = {"token": "synthetic-layout-only"}
    elif path == "state":
        body = state
    elif path == "statistics":
        body = {"cohorts": []}
    elif path == "connections/status":
        body = {
            "connections": [{"id": "synthetic", "label": "合成浏览器扩展" * 12, "state": "idle", "last_seen_at": None}],
            "active_window_seconds": 20,
        }
    else:
        body = {"payload": None, "version": 0}
    route.fulfill(content_type="application/json", body=json.dumps(body, ensure_ascii=False))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        **({} if os.environ.get("EASYRESUME_TEST_BROWSER") == "chromium" else {"channel": "chrome"}),
        headless=True,
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, locale="zh-CN")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/api/v1/**", api)
    page.goto(BASE)
    page.get_by_role("button", name="我的简历", exact=True).click()
    expect(page.get_by_role("heading", name="已保存的简历", exact=True)).to_be_visible()
    for width in [1920, 1440, 720, 390]:
        # 720 CSS pixels is a 1440-pixel desktop viewport at 200% browser zoom.
        page.set_viewport_size({"width": width, "height": 1000})
        measurements = page.evaluate("""() => {
            const form = document.querySelector('.resume-flow').getBoundingClientRect();
            const saved = document.querySelector('.saved-profiles').getBoundingClientRect();
            const row = document.querySelector('.saved-profile-row');
            return { form: form.width, saved: saved.width,
              overflow: document.documentElement.scrollWidth > innerWidth,
              rowOverflow: row.scrollWidth > row.clientWidth,
              right: saved.right, viewport: innerWidth };
        }""")
        assert abs(measurements["form"] - measurements["saved"]) <= 1, measurements
        assert not measurements["overflow"] and not measurements["rowOverflow"], measurements
        assert measurements["right"] <= measurements["viewport"], measurements
        expect(page.get_by_role("button", name="载入编辑", exact=True)).to_be_visible()
        page.screenshot(path=str(output / f"layout-resume-{width}.png"), full_page=True)
    page.get_by_role("button", name="设置与连接", exact=True).click()
    expect(page.get_by_text("未检测到扩展活动", exact=True)).to_be_visible()
    expect(page.get_by_text("已断开", exact=True)).to_have_count(0)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(output / "layout-settings-390.png"), full_page=True)
    assert not errors, errors
    browser.close()
print("PASS: aligned resume panels, long text, 1920/1440/720/390 CSS widths, idle connection semantics")
