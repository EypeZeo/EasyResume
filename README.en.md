# EasyResume User Guide

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

EasyResume helps you review your résumé, compare jobs, and prepare message drafts. The app currently uses Chinese; the actual button names are included below.

**Local test build v0.2.0-beta.20:** If you have the local test folder, launch `本地验证/启动 EasyResume.cmd` after closing the older app window. Load the extension from the fixed `本地验证/extension` folder; after an update, reload it in the extension manager and refresh the workbench and recruiting pages. The download links below still point to the published beta.1. Automatic connection, Zhaopin, and batch reading are local beta.20 test features.

## 1. Download and start

The local test folder also includes `启动 Chrome 求职工作区.cmd`. It opens the workbench, BOSS and Zhaopin in installed Chrome and reuses a running service, without changing your default browser. It does not reload the extension or start a batch automatically. See [scope and unattended design (Chinese)](docs/UNATTENDED.md).

1. Open the [Windows test release](https://github.com/EypeZeo/EasyResume/releases/tag/v0.2.0-beta.1). Under **Assets**, download `EasyResume-v0.2.0-beta.1-windows-x64.zip`. GitHub's “Source code” is not the Windows app.
2. Right-click the ZIP and choose **Extract All**. Keep the entire folder together; do not run the EXE inside the ZIP or move it alone.
3. Open the extracted `EasyResume` folder and double-click `EasyResume.exe`. Windows x64 users do not need Python or Node.
4. Keep the console window open. Your browser opens the workbench automatically.

If the browser does not open, copy the `http://127.0.0.1:…` address from the console. It connects to the app on your own computer. Closing the browser does not stop the app; close the console to quit. Run the EXE again to restart.

This is an **unsigned test build**. If Windows or antivirus software blocks it, stop and verify the source and SHA-256 checksum, or wait for a signed build. Do not disable protection. See [validation status](docs/STATUS.md) for clean-Windows acceptance.

## 2. Import and review your résumé

1. Open **我的简历** (My résumé), choose **选择简历文件** (Choose file), and select DOCX, text PDF, or TXT. You can also use **粘贴简历原文** (Paste résumé text).
2. Review **检查识别建议** (Review suggestions), then choose **采用所选建议** (Apply selected suggestions).
3. Check **教育经历** (Education): school, degree, enrollment/end date, and study status. Keep year-only dates when the month is unknown.
4. Check **工作经历** (Work): employer, role, employment type, dates, and current employment. Internships and part-time work are separate; overlapping periods are not counted twice.
5. Review **技能** (Skills), correcting missing or incorrect entries. Open the source text when needed. Mark reviewed entries **已核对**.
6. Click **保存简历版本** (Save résumé version). Choose explicitly whether the current screening strategy should use it.

Missing months or employment types can prevent an experience total; complete the record rather than assuming zero experience. **重新识别** (Re-extract) proposes changes for review. Draft edits are separate from saved versions used in matching. Convert old DOC files to DOCX in Word/WPS; use text files or manual entry for scanned PDFs.

### Optional AI assistance

Local parsing works without AI. Under **设置与连接 → 关于与帮助** (Settings & connections → About & help), enter your provider's service URL, model, and API key, for example DeepSeek. The key is held only for the running session; re-enter it after restarting.

Choose **AI 辅助识别** on the résumé page. Check the destination and redacted preview, and delete any remaining personal information, then click **确认发送脱敏文本** (Confirm sending redacted text). Only that text is sent, not the original file. Automatic redaction can miss information, so review it yourself. The provider may charge for requests.

You can cancel while waiting. Failure or timeout preserves local work. Returned data is a suggestion; review and save it before matching. Keys are excluded from logs and backups.

## 3. Import and compare jobs

1. In **筛选策略** (Screening strategy), select a saved résumé and set roles, cities, salary, and unacceptable conditions. Save the strategy.
2. In **岗位工作台** (Jobs), choose **导入职位** (Import job). Paste the description and add its title, company, and link.
3. Check the extracted fields and save. Unmentioned benefits remain unknown.
4. Read the explanation and save jobs worth pursuing.

| Result | Next step |
|---|---|
| 候选 — Candidate | Review the reasons and prepare contact |
| 待核实 — Needs checking | Resolve the unknowns or draft a question |
| 冲刺 — Stretch | Decide separately whether to try despite qualification gaps |
| 排除 — Excluded | Inspect the reason and correct data or strategy if needed |

Scores show a rule-based matching range, not hiring probability. If there are no candidates, inspect the reasons and preview relaxed conditions before changing your strategy.

Create greeting or clarification drafts in job details, then review them in **沟通与记录** (Messages & records). **Copying is not sending:** paste and send manually on the recruiting website, then record the actual outcome.

## 4. Optional browser extension

The manual workflow works without it. These steps apply to local **beta.20**, which adds experimental BOSS / Zhaopin right-hand detail reading and user-started batch reading. The public beta.1 still uses a pairing code and contains the earlier BOSS prototype. Page changes can break extraction. Automatic sending is unavailable.

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**, choose **Load unpacked**, and select the package's `extension` folder. For the separate extension ZIP, extract it and select the folder containing `manifest.json`.
3. Open the local EasyResume workbench in the browser where the extension is installed. It connects automatically on first use; refresh the workbench if it was already open. Open the extension and check for **已连接** (Connected).
4. Log in to BOSS or Zhaopin yourself. Select a job in the left list and wait for its right-hand details. Choose **读取当前职位** (Read current job), check the title and company, then **保存到工作台** (Save). Refresh the recruiting page after installation if needed.
5. To collect several jobs, select **批量读取** (Batch reading), set the limit, and click **开始批量读取** (Start). The default is at most 20 jobs on the current page. Paging requires explicitly selecting **自动翻页** (Automatic paging); the default is then 2 pages, with limits of 100 jobs / 5 pages. Use **暂停 / 继续读取 / 停止任务** (Pause / Resume / Stop) when needed.

While open, the extension checks its connection every five seconds and briefly reports changes. An existing pairing can discover a changed port and reconnect after verifying the same workbench. Start the app if it is offline. “未检测到扩展活动” may simply mean the popup is closed. After an explicit **断开连接** (Disconnect), it does not pair again automatically; click **查找并连接工作台** (Find and connect) to reconnect.

If automatic connection fails, use **设置与连接 → 浏览器扩展 → 生成连接码 → 复制连接码** in the workbench, expand **使用连接码** in the extension, paste the five groups of digits, and choose **使用连接码连接**. Codes expire in five minutes, work once, and should not be shared. Beta.1 calls these “连接信息”.

Paging uses only supported, recognizable next-page controls or adapted loading at the end of the job list. Each newly loaded batch counts as a page. It stops when no supported loading method is available; it never scrolls indefinitely or blindly. Batch reading changes the selected job in the recruiting tab. Keep that tab in the foreground and inspect any pause/error message before continuing.

If reading fails, select one job’s title and description and use **读取选中的职位文字**. Check the first-line title and company in the workbench. **薪资采用特殊字体，待核对** means the salary font could not be read reliably; check the original page instead of treating salary as absent.

Check the title, company, city, and description before saving; expand **查看读取的职位内容** to inspect the text. Zhaopin interactions are at least five seconds apart. If the same selected job remains empty, it is reselected once; if it stays empty, batch reading pauses. Reselect the job on the site, wait for details, and resume. A manual page refresh or extension background restart leaves the task paused; check the reason and stop/restart the old task if needed. Changes to existing jobs require review and are not counted as new or silently overwritten. See [validation status](docs/STATUS.md) for actual testing.

The separate **加载失败时自动刷新一次并恢复** option (refresh once after a loading failure) is off by default; it is not periodic refresh. It allows at most one refresh per task and at least five minutes between tasks. Recovery requires rechecking public stable job IDs, the original queue, and search scope; otherwise it pauses. The currently tested Zhaopin list has no public IDs on its left-hand cards, so it cannot automatically continue across a refresh. This does not reload the extension. See [refresh limits](docs/UNATTENDED.md) (Chinese).

When postings share a title and company and cannot be distinguished, batch reading pauses. Click **查看更多职位信息** on the recruiting site to open and read the separate job page.

Website terms may restrict third-party tools. Stop on verification or account warnings and handle them on the website. See [platform validation](docs/PLATFORM_VALIDATION.md) for the tested scope.

You can also use **设置与连接 → 浏览器扩展 → 从浏览器整理岗位** in the workbench. Select the site, click **定位招聘页面**, then **读取浏览器当前职位**. Choose a tab if several job pages are open. A homepage is followed only through its actual Jobs link, once per action. Failures show a reason without repeated refreshes. Batch pause, resume, and stop are available here too.

If the browser asks about site access after updating, check that recruiting access is limited to BOSS and Zhaopin. It lets the workbench locate open job tabs; it does not enable Cookie access or automatic applications.

For the supported Zhaopin tutorial “点击消息，可以直接跟招聘方聊天啦~”, the extension attempts “我知道了” once per page and waits for the overlay to disappear. Other overlays pause collection for manual review. Closing this tutorial still requires verification when it appears on the real site.

## 5. Back up, restore, and upgrade

- Open **设置与连接 → 数据管理 → 导出备份** (Settings → Data → Export backup) and save the downloaded file.
- Choose **从备份恢复** (Restore), select your file, review added/skipped counts, and confirm. Existing records with the same ID are not overwritten.
- Backups omit original résumé files, names, source/evidence text, recruiter personal information, chats, connection credentials, and AI keys. Recheck restored résumés and supply missing evidence; omitted content is expected.
- To upgrade, export a backup, quit, extract the new version to a new folder, and launch its EXE. Do not run both versions or delete the data folder.

Data lives under `%LOCALAPPDATA%\EasyResume`, separate from the program. Deleting a résumé does not delete external backups. See [maintenance](docs/DEVELOPMENT.md) for technical details.

## 6. Troubleshooting

| Problem | What to do |
|---|---|
| Incorrect extraction | Edit affected records and review new suggestions |
| PDF has no text | Use text PDF, DOCX, or manual entry |
| Workbench does not open | Keep the console open and use its current address |
| Extension cannot read | Refresh, open job details, or paste text manually |
| Missing EXE | Check you downloaded the Windows ZIP, extraction, and antivirus history |
| AI request fails | Check URL, model, balance, and network; retry without discarding local work |
| Database error after upgrade | Stop and preserve the data and error; do not delete the database |

Report [issues](https://github.com/EypeZeo/EasyResume/issues) with the version, steps, and redacted screenshots. Never attach real résumés, keys, or databases.

## 7. Current scope and developer resources

Available: local résumé/job organization, rules, optional AI suggestions, drafts, and backups. Local beta.20 adds experimental BOSS / Zhaopin read-only adapters and bounded batch reading; public beta.1 has an earlier scope. Automatic sending, OCR, company verification, commute maps, and 51job collection are unavailable. Complete real-site workflows and real-résumé accuracy require separate validation.

[Development](docs/DEVELOPMENT.md) · [Design](docs/PLAN.md) · [Validation](docs/STATUS.md) · [Reuse review (Chinese)](docs/OPEN_SOURCE_REUSE.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

EasyResume's own code uses [MIT](LICENSE). Third-party licenses remain applicable.
