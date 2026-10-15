from pathlib import Path

from playwright.sync_api import sync_playwright

output = Path("artifacts/screenshots")
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1050}, locale="zh-CN")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8765")
    page.wait_for_load_state("networkidle")
    print("TITLE:", page.title())
    print("HEADINGS:", page.get_by_role("heading").all_text_contents())
    print("BUTTONS:", page.get_by_role("button").all_text_contents())
    print("ERRORS:", errors)
    page.screenshot(path=str(output / "workbench-empty.png"), full_page=True)
    browser.close()
