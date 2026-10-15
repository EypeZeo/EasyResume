"""Real browser smoke against a local, isolated workbench. No recruitment login or traffic."""

import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("EASYRESUME_TEST_URL", "http://127.0.0.1:8765")
output = Path("artifacts/screenshots")
output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    # Set EASYRESUME_TEST_BROWSER=chromium in CI after playwright install chromium.
    options = {} if os.environ.get("EASYRESUME_TEST_BROWSER") == "chromium" else {"channel": "chrome"}
    browser = p.chromium.launch(headless=True, **options)
    context = browser.new_context(
        viewport={"width": 1440, "height": 1050},
        locale="zh-CN",
        permissions=["clipboard-write", "clipboard-read"],
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", level=1)).to_contain_text("好机会")
    if page.get_by_role("button", name="用合成示例体验").count():
        page.get_by_role("button", name="用合成示例体验").click()
    expect(page.get_by_role("button", name="[示例] Python 开发工程师", exact=True)).to_be_visible(
        timeout=15000
    )
    page.screenshot(path=str(output / "workbench-jobs.png"), full_page=True)

    page.get_by_role("button", name="[示例] 数据分析师", exact=True).click()
    detail = page.get_by_role("dialog", name="岗位依据与下一步")
    expect(detail).to_be_visible()
    detail.get_by_text("补充 HR 回答或其他依据", exact=True).click()
    detail.get_by_label("相关原文片段", exact=True).fill("合成测试回答：固定周末双休")
    detail.get_by_role("button", name="保存并重新评估", exact=True).click()
    expect(page.get_by_role("status")).to_contain_text("已补充依据", timeout=10000)
    expect(detail.locator(".detail-title .badge")).to_have_text("候选")
    detail.get_by_role("button", name="生成招呼草稿", exact=True).click()
    draft = page.get_by_role("dialog", name="沟通草稿 · 尚未发送")
    expect(draft).to_be_visible()
    expect(draft.get_by_label("草稿正文（自动保存到本地）", exact=True)).to_have_value(
        __import__("re").compile(r".*本科.*")
    )
    draft.get_by_role("button", name="保存并复制正文", exact=True).click()
    expect(page.get_by_role("status")).to_contain_text("尚未发送")
    draft.get_by_role("button", name="继续核对岗位", exact=True).click()
    detail.get_by_role("button", name="关闭对话框", exact=True).click()

    page.get_by_role("button", name="导入职位", exact=True).click()
    dialog = page.get_by_role("dialog", name="导入一条职位")
    dialog.get_by_label("职位描述原文", exact=True).fill(
        "本科优先，经验不限。Python、SQL。固定月薪 12-18K，周末双休，五险一金。"
    )
    dialog.get_by_role("button", name="预填并核对", exact=True).click()
    dialog = page.get_by_role("dialog", name="核对职位关键字段")
    dialog.get_by_label("职位名称", exact=True).fill("合成E2E职位")
    dialog.get_by_label("公司主体", exact=True).fill("合成E2E公司")
    dialog.get_by_label("工作城市", exact=True).fill("上海")
    dialog.get_by_role("button", name="已核对提取，保存岗位", exact=True).click()
    expect(dialog).not_to_be_visible()
    expect(page.get_by_role("button", name="合成E2E职位", exact=True)).to_be_visible()

    with page.expect_download() as download_event:
        page.get_by_role("button", name="导出", exact=True).click()
    export = download_event.value
    export.save_as(output / "smoke-export.csv")
    assert "合成E2E职位" in (output / "smoke-export.csv").read_text("utf-8-sig")

    page.get_by_role("button", name="沟通与记录", exact=True).click()
    outcome = page.get_by_label("合成E2E职位 登记沟通结果", exact=True)
    outcome.select_option("contact")
    expect(page.get_by_role("status")).to_contain_text("已登记人工报告")
    outcome.select_option("positive")
    expect(
        page.locator("section").filter(has=page.get_by_role("heading", name="按首次联系策略统计"))
    ).to_contain_text("积极回复 1")
    page.get_by_role("button", name="设置与连接", exact=True).click()
    page.get_by_role("button", name="生成只读配对码", exact=True).click()
    expect(page.get_by_label("一次性配对码（5分钟有效）", exact=True)).to_have_value(
        __import__("re").compile(r".{20,}")
    )
    page.get_by_role("button", name="岗位工作台", exact=False).click()
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(output / "workbench-mobile.png"), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile layout overflows"
    page.set_viewport_size({"width": 1440, "height": 1050})
    page.screenshot(path=str(output / "workbench-jobs.png"), full_page=True)
    assert not errors, errors
    print(
        json.dumps(
            {
                "result": "PASS",
                "browser": "isolated chrome",
                "checks": [
                    "load",
                    "explicit synthetic demo",
                    "pending-to-candidate evidence",
                    "grounded draft",
                    "manual job import",
                    "CSV download",
                    "manual outcome attribution",
                    "pairing UI",
                    "390px reflow",
                    "no JS errors",
                ],
                "real_boss_verified": False,
            },
            ensure_ascii=False,
        )
    )
    browser.close()
