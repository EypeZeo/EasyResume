# EasyResume User Guide

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

EasyResume helps you review your résumé, compare jobs, and prepare message drafts. The app currently uses Chinese; the actual button names are included below.

## 1. Download and start

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

The manual workflow works without it. BOSS reading is experimental; page changes can break extraction. Automatic sending is unavailable.

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**, choose **Load unpacked**, and select the package's `extension` folder. For the separate extension ZIP, extract it and select the folder containing `manifest.json`.
3. In the workbench, open **设置与连接 → 浏览器扩展**, then **生成连接信息 → 复制连接信息** (Generate / Copy connection information).
4. In the extension, paste into **粘贴工作台的连接信息** and click **连接工作台** (Connect). Regenerate expired information.
5. Log in to BOSS yourself, open a job page, and choose **读取当前职位页** (Read current job page). Review and click **保存到工作台** (Save). Refresh the page after installing if needed.

If the workbench is unavailable, start the EXE and click **重新检查连接** (Recheck connection). Reconnect after backup restoration if needed. Do not share connection information.

Website terms may restrict third-party tools. Stop on verification or account warnings and handle them on the website. See [platform validation](docs/PLATFORM_VALIDATION.md) for the tested scope.

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

Available: local résumé/job organization, rules, optional AI suggestions, drafts, backups, and the experimental BOSS reader. Automatic sending, OCR, company verification, commute maps, 51job and Zhaopin collection are not supported. Real-site compatibility and real-résumé accuracy require separate validation.

[Development](docs/DEVELOPMENT.md) · [Design](docs/PLAN.md) · [Validation](docs/STATUS.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

EasyResume's own code uses [MIT](LICENSE). Third-party licenses remain applicable.
