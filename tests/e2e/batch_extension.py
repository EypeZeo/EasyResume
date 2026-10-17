"""Real MV3 + isolated local backend; all recruiting-site pages below are synthetic.

Run after building both workbench and extension:
    .venv/Scripts/python.exe tests/e2e/batch_extension.py

This never loads a user's Chrome profile or the default EasyResume data directory.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import httpx
import psutil
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EXTENSION = ROOT / "apps/extension/.output/chrome-mv3"
PREFIX = "batch_" + uuid4().hex[:8]


@contextmanager
def test_server():
    with TemporaryDirectory(prefix="easyresume-batch-data-") as directory:
        root = Path(directory)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        environment = os.environ.copy()
        executable = os.environ.get("EASYRESUME_TEST_EXE", "").strip()
        if executable:
            app = Path(executable).resolve()
            assert app.is_file(), f"Packaged application does not exist: {app}"
            command = [str(app)]
            environment.pop("PYTHONPATH", None)
            environment.pop("PYTHONHOME", None)
        else:
            command = [sys.executable, "-m", "easyresume"]
            environment["PYTHONPATH"] = str(ROOT / "backend")
        command.extend(["--no-browser", "--data-dir", directory, "--port", str(port)])
        with (root / "server.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                command,
                cwd=ROOT,
                env=environment,
                stdout=log,
                stderr=log,
            )
            try:
                deadline = time.monotonic() + 40
                while time.monotonic() < deadline:
                    assert process.poll() is None, (root / "server.log").read_text("utf-8")
                    runtime = root / "runtime.json"
                    if runtime.is_file():
                        try:
                            base = json.loads(runtime.read_text("utf-8"))["url"]
                            if httpx.get(base + "/api/v1/health", timeout=0.5).status_code == 200:
                                break
                        except (httpx.HTTPError, json.JSONDecodeError):
                            pass
                    time.sleep(0.1)
                else:
                    raise AssertionError("Isolated backend did not start")
                yield base
            finally:
                if process.poll() is None:
                    children = psutil.Process(process.pid).children(recursive=True)
                    for child in reversed(children):
                        child.terminate()
                    process.terminate()
                    process.wait(timeout=10)
                    psutil.wait_procs(children, timeout=5)


def fixture(platform: str) -> str:
    """The title changes before its description, exposing stale-detail bugs."""
    boss = platform == "boss"
    html = """<!doctype html><html><head><meta charset="utf-8"><title>Synthetic split-pane fixture</title>
    <style>body{font:16px sans-serif}.layout{display:flex;gap:24px}.cards{width:320px}.card{padding:16px;border:1px solid #ccc;margin-bottom:10px;cursor:pointer}.active,.job-card--active{border-color:green}section{width:650px}button{padding:12px}.job-list-panel{height:270px;overflow:auto;scroll-behavior:auto}.job-list-panel .card{height:200px}</style></head>
    <body><div class="layout"><aside class="LEFT_CLASS"><div class="cards PANEL_CLASS"></div><div class="loading"></div></aside><section class="DETAIL_ROOT"></section></div>
    <div class="pagination"><button class="next" aria-label="下一页">下一页</button></div>
    <script>
    const platform=PLATFORM; const prefix=PREFIX; const boss=platform==='boss';
    window.cardClicks=[];window.pageClicks=0;window.externalActions=0;let page=1;let revision=0;let loading=false;
    function item(index){const key=prefix+'_'+platform+'_p'+page+'_'+index;return {key,title:'合成'+platform+'岗位'+page+'-'+index,company:'合成'+platform+'企业'+index}}
    function detail(item,delayed){
      const version=++revision;const root=document.querySelector('.DETAIL_ROOT');
      const old=root.querySelector('.DESCRIPTION')?.textContent||'旧描述，不得拼接';
      root.innerHTML='<h1 class="TITLE">'+item.title+'</h1><div class="COMPANY">'+item.company+'</div><div class="SALARY">8-12K</div><p class="REQUIREMENTS">本科 · 经验不限 · 郑州</p><div class="DESCRIPTION">'+old+'</div><a href="JOB_PATH'+item.key+'.html">查看更多职位信息</a><button onclick="window.externalActions++">DANGEROUS</button>';
      const finish=()=>{if(version===revision)root.querySelector('.DESCRIPTION').textContent='完整描述 '+item.key+'：维护 Linux 服务器和网络，周末双休，五险一金。'};
      if(delayed)setTimeout(finish,1100);else finish();
    }
    function render(append=false){
      const cards=document.querySelector('.cards');if(!append)cards.innerHTML='';
      for(let i=1;i<=2;i++){
        const data=item(i);const card=document.createElement(boss?'li':'div');card.className='card CARD';card.dataset.index=String(i);
        card.innerHTML='<span class="CARD_TITLE">'+data.title+'</span><div class="CARD_COMPANY">'+data.company+'</div><span class="LOCATION">郑州</span>'+(boss?'<a href="/job_detail/'+data.key+'.html">职位详情</a>':'');
        card.addEventListener('click',()=>{window.cardClicks.push({key:data.key,at:Date.now()});document.querySelectorAll('.card').forEach(e=>e.classList.remove('active','job-card--active'));card.classList.add(boss?'active':'job-card--active');detail(data,true)});cards.append(card);
      }
      const next=document.querySelector('.next');if(next)next.disabled=page>=2;
    }
    if(boss)document.querySelector('.next').addEventListener('click',()=>{window.pageClicks++;setTimeout(()=>{page++;render()},600)});
    else{
      document.querySelector('.next').remove();
      const panel=document.querySelector('.job-list-panel');
      panel.addEventListener('scroll',()=>{
        const last=panel.lastElementChild;
        if(page>=2||loading||!last||last.getBoundingClientRect().bottom>panel.getBoundingClientRect().bottom+2)return;
        loading=true;window.pageClicks++;document.querySelector('.loading').textContent='加载更多...';
        setTimeout(()=>{page++;render(true);loading=false;document.querySelector('.loading').textContent=''},600);
      });
    }
    render();document.querySelector('.card').classList.add(boss?'active':'job-card--active');detail(item(1),false);
    </script></body></html>"""
    replacements = {
        "PLATFORM": json.dumps(platform),
        "PREFIX": json.dumps(PREFIX),
        "DETAIL_ROOT": "job-detail-box" if boss else "job-detail-modules",
        "LEFT_CLASS": "job-list-box" if boss else "job-split-layout__left",
        "PANEL_CLASS": "job-list-box" if boss else "job-list-panel",
        "DESCRIPTION": "job-sec-text" if boss else "job-description__content",
        "TITLE": "job-name" if boss else "job-detail-summary__title-text",
        "COMPANY": "company-name" if boss else "job-detail-summary__company-name",
        "SALARY": "salary" if boss else "job-detail-summary__salary",
        "REQUIREMENTS": "job-info" if boss else "job-detail-summary__tag",
        "JOB_PATH": "/job_detail/" if boss else "/jobdetail/",
        "CARD_TITLE": "job-name" if boss else "job-card__title-main",
        "CARD_COMPANY": "company-name" if boss else "job-card__company-name",
        "LOCATION": "company-location" if boss else "job-card__location",
        "CARD": "job-card-box" if boss else "job-card",
        "DANGEROUS": "立即沟通" if boss else "立即投递",
    }
    # Longer tokens first so e.g. CARD_TITLE cannot be partially replaced by TITLE.
    for source in sorted(replacements, key=len, reverse=True):
        html = html.replace(source, replacements[source])
    return html


def send(popup, message: dict):
    response = popup.evaluate("message => chrome.runtime.sendMessage(message)", message)
    assert isinstance(response, dict) and "error" not in response, response
    return response


def status_until(popup, predicate, timeout=30):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = send(popup, {"type": "BATCH_STATUS"})
        if predicate(last):
            return last
        assert last.get("status") != "error", last
        popup.wait_for_timeout(150)
    raise AssertionError(f"Batch status timeout: {last}")


def content_cannot_read_credentials(context, site, extension_id):
    client = context.new_cdp_session(site)
    worlds = []
    client.on("Runtime.executionContextCreated", lambda event: worlds.append(event["context"]))
    client.send("Runtime.enable")
    try:
        for world in worlds:
            result = client.send(
                "Runtime.evaluate",
                {
                    "contextId": world["id"],
                    "expression": "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id",
                    "returnByValue": True,
                },
            )
            if result.get("result", {}).get("value") != extension_id:
                continue
            result = client.send(
                "Runtime.evaluate",
                {
                    "contextId": world["id"],
                    "expression": "(async()=>{try{const v=await chrome.storage.local.get('connection');return {exposed:!!v.connection,denied:false}}catch{return {exposed:false,denied:true}}})()",
                    "awaitPromise": True,
                    "returnByValue": True,
                },
            )
            value = result.get("result", {}).get("value")
            assert value == {"exposed": False, "denied": True}, value
            return
        raise AssertionError("The recruiting content script world was not found")
    finally:
        client.detach()


def main():
    assert (EXTENSION / "manifest.json").is_file(), "Build the MV3 extension first"
    with (
        test_server() as base,
        TemporaryDirectory(prefix="easyresume-batch-browser-") as profile,
        sync_playwright() as p,
    ):
        options = {}
        candidates = list(
            (Path.home() / "AppData/Local/ms-playwright").glob("chromium-*/chrome-win64/chrome.exe")
        )
        if candidates:
            options["executable_path"] = str(
                max(candidates, key=lambda path: int(path.parents[1].name.split("-")[1]))
            )
        context = p.chromium.launch_persistent_context(
            profile,
            headless=True,
            args=[f"--disable-extensions-except={EXTENSION}", f"--load-extension={EXTENSION}"],
            **options,
        )
        try:
            worker = (
                context.service_workers[0]
                if context.service_workers
                else context.wait_for_event("serviceworker")
            )
            extension_id = worker.url.split("/")[2]
            popup = context.new_page()
            popup.goto(f"chrome-extension://{extension_id}/popup.html")
            assert send(popup, {"type": "STATUS"})["state"] == "unpaired"
            workbench = context.new_page()
            workbench.goto(base)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                connection = send(popup, {"type": "STATUS"})
                if connection.get("state") == "connected":
                    break
                popup.wait_for_timeout(200)
            else:
                raise AssertionError("Opening the workbench did not pair the extension automatically")
            assert connection["base"] == base
            headers = {"Origin": base, "X-EasyResume-Client": "workbench"}
            token = httpx.post(base + "/api/v1/session", headers=headers).json()["token"]
            headers["Authorization"] = f"Bearer {token}"
            assert httpx.get(base + "/api/v1/state", headers=headers).json()["jobs"] == []
            workbench.close()
            context.route(
                "https://www.zhipin.com/**",
                lambda route: route.fulfill(
                    status=200, content_type="text/html; charset=utf-8", body=fixture("boss")
                ),
            )
            context.route(
                "https://www.zhaopin.com/**",
                lambda route: route.fulfill(
                    status=200, content_type="text/html; charset=utf-8", body=fixture("zhaopin")
                ),
            )
            platforms = [
                ("boss", "https://www.zhipin.com/web/geek/job-recommend"),
                ("zhaopin", "https://www.zhaopin.com/jobs/recommend"),
            ]
            reports = []
            for platform, href in platforms:
                site = context.new_page()
                site.goto(href)
                site.bring_to_front()
                site.wait_for_timeout(300)
                current = send(popup, {"type": "READ"})
                assert current["observations"][0]["title"] == f"合成{platform}岗位1-1", current
                # A normal workbench button grants no activeTab permission to the recruiting tab.
                # Exercise the deployed UI/bridge, not a temporary extension-action grant.
                workbench = context.new_page()
                workbench.goto(base)
                workbench.get_by_role("button", name="设置与连接", exact=True).click()
                workbench.get_by_role("combobox", name="招聘网站").select_option(
                    "boss" if platform == "boss" else "zhilian"
                )
                workbench.get_by_role("button", name="读取浏览器当前职位", exact=True).click()
                expect(workbench.get_by_text(f"合成{platform}岗位1-1", exact=True)).to_be_visible(timeout=20000)
                expect(workbench.get_by_role("button", name="保存读取的职位", exact=True)).to_be_enabled()
                workbench.close()
                site.bring_to_front()
                content_cannot_read_credentials(context, site, extension_id)
                started = send(popup, {"type": "BATCH_START", "maxJobs": 4, "maxPages": 2, "autoPage": True})
                assert started["status"] == "running", started
                status_until(popup, lambda status: status.get("saved", 0) >= 1)
                paused = send(popup, {"type": "BATCH_PAUSE"})
                assert paused["status"] == "paused", paused
                saved_at_pause = paused["saved"]
                site.wait_for_timeout(1800)
                assert send(popup, {"type": "BATCH_STATUS"})["saved"] == saved_at_pause
                resumed = send(popup, {"type": "BATCH_RESUME"})
                assert resumed["status"] == "running", resumed
                final = status_until(popup, lambda status: status.get("status") == "completed", timeout=40)
                assert final["saved"] == 4, final
                state = httpx.get(base + "/api/v1/state", headers=headers).json()
                jobs = [job for job in state["jobs"] if job["data"]["platform"] == platform]
                assert len(jobs) == 4, [
                    (job["data"]["title"], job["data"]["platform"]) for job in state["jobs"]
                ]
                for record in jobs:
                    job = record["data"]
                    assert "旧描述" not in job["text"], job
                    assert f"完整描述 {PREFIX}_{platform}_" in job["text"], job
                    identifier = job["platform_job_id"]
                    assert f"完整描述 {identifier}：" in job["text"], job
                evidence = site.evaluate(
                    "({cardClicks:window.cardClicks,pageClicks:window.pageClicks,externalActions:window.externalActions})"
                )
                assert evidence["pageClicks"] == 1, evidence
                if platform == "zhaopin":
                    assert site.locator(".job-list-panel > .job-card").count() == 4
                assert evidence["externalActions"] == 0, evidence
                click_times = [item["at"] for item in evidence["cardClicks"]]
                assert all(b - a >= 3000 for a, b in zip(click_times, click_times[1:], strict=False)), (
                    evidence
                )
                reports.append(
                    {
                        "platform": platform,
                        "saved": 4,
                        "pages": final["pages"],
                        "pause_resume": True,
                        "pagination": "SPA next button"
                        if platform == "boss"
                        else "verified list scroll append",
                    }
                )
                # Starting a separate bounded run and stopping it must not save an in-flight detail.
                site.reload()
                site.wait_for_timeout(300)
                send(popup, {"type": "BATCH_START", "maxJobs": 4, "maxPages": 2, "autoPage": True})
                stopped = send(popup, {"type": "BATCH_STOP"})
                assert stopped["status"] == "stopped", stopped
                site.wait_for_timeout(3500)
                assert send(popup, {"type": "BATCH_STATUS"})["saved"] == stopped["saved"]
                state = httpx.get(base + "/api/v1/state", headers=headers).json()
                assert len([job for job in state["jobs"] if job["data"]["platform"] == platform]) == 4
                site.close()
            manifest = json.loads((EXTENSION / "manifest.json").read_text("utf-8"))
            assert "cookies" not in manifest["permissions"]
            result = {
                "result": "PASS",
                "checks": [
                    "isolated backend and browser profile",
                    "real MV3 service worker",
                    "automatic workbench bridge",
                    "workbench UI reading without a temporary activeTab grant",
                    "BOSS and Zhaopin split-pane extraction",
                    "delayed detail body",
                    "SPA next page and verified Zhaopin list scroll append",
                    "start/pause/resume/stop",
                    "no duplicate saved jobs",
                    "minimum 3-second click interval",
                    "content scripts cannot read long-lived credentials",
                    "no send/apply action clicked",
                ],
                "platforms": reports,
                "real_recruiting_accounts_verified": False,
                "backend_runtime": "frozen executable"
                if os.environ.get("EASYRESUME_TEST_EXE")
                else "python module",
            }
            output = ROOT / "artifacts/batch-extension-beta3.json"
            output.parent.mkdir(exist_ok=True)
            output.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
            print(json.dumps(result, ensure_ascii=False))
        finally:
            context.close()


if __name__ == "__main__":
    main()
