"""Load the built extension in a disposable Chromium profile; BOSS traffic is synthetic."""

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import httpx
from playwright.sync_api import expect, sync_playwright

base = os.environ.get("EASYRESUME_TEST_URL", "http://127.0.0.1:8765")
headers = {"Origin": base, "X-EasyResume-Client": "workbench"}
token = httpx.post(f"{base}/api/v1/session", headers=headers).json()["token"]
headers["Authorization"] = f"Bearer {token}"
code = httpx.post(f"{base}/api/v1/pairing", headers=headers).json()["code"]
extension = Path("apps/extension/.output/chrome-mv3").resolve()

with TemporaryDirectory(prefix="easyresume-extension-") as directory, sync_playwright() as p:
    options = {}
    candidates = list(
        (Path.home() / "AppData/Local/ms-playwright").glob("chromium-*/chrome-win64/chrome.exe")
    )
    if candidates:
        options["executable_path"] = str(
            max(candidates, key=lambda path: int(path.parents[1].name.split("-")[1]))
        )
    context = p.chromium.launch_persistent_context(
        directory,
        headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"],
        **options,
    )
    try:
        worker = (
            context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
        )
        extension_id = worker.url.split("/")[2]
        popup = context.new_page()
        popup.goto(f"chrome-extension://{extension_id}/popup.html")
        popup.get_by_label("本地工作台地址", exact=True).fill(base)
        popup.get_by_label("工作台生成的配对码", exact=True).fill(code)
        popup.get_by_role("button", name="建立只读连接", exact=True).click()
        expect(popup.get_by_role("status")).to_contain_text("已建立", timeout=10000)
        synthetic_html = '<!doctype html><html><head><meta charset="utf-8"><title>Synthetic BOSS fixture</title></head><body><h1 class="job-name">合成扩展集成职位</h1><div class="company-name">合成扩展企业</div><span class="salary">12-18K</span><div class="job-sec-text">本科，Python，固定月薪12-18K，周末双休，五险一金。</div><div class="boss-info">合成招聘者，不应收集</div></body></html>'
        context.route(
            "https://www.zhipin.com/**",
            lambda route: route.fulfill(status=200, content_type="text/html", body=synthetic_html),
        )
        job = context.new_page()
        job.goto(f"https://www.zhipin.com/job_detail/extension_synthetic_{uuid4().hex[:8]}.html")
        job.wait_for_load_state("networkidle")
        job.bring_to_front()
        response = popup.evaluate("""async () => {
            const tabs = await chrome.tabs.query({});
            // No tabs permission: URL may be hidden. The harness created the synthetic job last.
            const job = tabs.reduce((a,b) => a.index > b.index ? a : b);
            await chrome.tabs.update(job.id, {active: true});
            return chrome.runtime.sendMessage({type:'READ'});
        }""")
        assert "error" not in response, response
        observation = response["observations"][0]
        assert observation["title"] == "合成扩展集成职位"
        assert "招聘者" not in observation["text"]
        saved = popup.evaluate(
            "o => chrome.runtime.sendMessage({type:'SAVE', observations:[o]})", observation
        )
        assert saved.get("saved") == 1, saved
        rejected = popup.evaluate("chrome.runtime.sendMessage({type:'SEND', text:'must-never-send'})")
        assert "不支持" in rejected["error"]
        manifest = json.loads((extension / "manifest.json").read_text("utf-8"))
        assert "cookies" not in manifest["permissions"]
        assert manifest["side_panel"]["default_path"] == "sidepanel.html"
        state = httpx.get(f"{base}/api/v1/state", headers=headers).json()
        assert any(j["data"]["title"] == "合成扩展集成职位" for j in state["jobs"])
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "checks": [
                        "real MV3 load",
                        "popup pairing",
                        "content script extraction",
                        "background credentials",
                        "local observation API",
                        "unknown sending command rejected",
                        "sidepanel manifest",
                    ],
                    "real_boss_verified": False,
                },
                ensure_ascii=False,
            )
        )
    finally:
        context.close()
