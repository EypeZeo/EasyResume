# 开发与维护

普通用户请从 [使用手册](../README.md) 开始。本页面向源码运行、测试和发行维护。

## 源码运行

需要 Python 3.12、uv、Node 22 和 pnpm 11.7。首次安装依赖需要网络。

```powershell
uv sync --frozen
pnpm install --frozen-lockfile
pnpm build
uv run easyresume
```

根目录的 `启动 EasyResume.cmd` 优先打开本次构建的测试 EXE；没有构建产物时使用 `uv run easyresume`，此时需要开发依赖。Windows Release 包内直接运行 `EasyResume.exe`。

前端开发：先执行 `uv run easyresume --dev --no-browser`，再执行 `pnpm --filter @easyresume/workbench dev`。

## 检查和构建

```powershell
uv run pytest -q
uv run ruff check backend tests scripts
uv run python scripts/check_fixtures.py
pnpm typecheck
pnpm test
pnpm build
pnpm generate:api
```

API 生成后检查差异并提交。测试必须使用独立的 `--data-dir`，不接触用户实际简历和平台账号。`tests/e2e/smoke.py` 使用本地合成资料；`tests/e2e/extension_smoke.py` 加载真实 MV3，但招聘站点响应被合成 HTML 替代。这不等于真实 BOSS 兼容性通过。

## Windows 测试发行

在 Windows x64 构建：

```powershell
powershell -NoProfile -File scripts/build.ps1 -ReleaseVersion v0.2.0-beta.2
powershell -NoProfile -File scripts/stage_local.ps1 -Version v0.2.0-beta.2
```

脚本安装锁定依赖、运行静态/类型/单元检查、构建前端与扩展、生成许可清单、打包 PyInstaller 目录，再生成以下资产：

- `artifacts/release/EasyResume-v0.2.0-beta.2-windows-x64.zip`
- `artifacts/release/EasyResume-v0.2.0-beta.2-extension.zip`
- `artifacts/release/SHA256SUMS.txt`

`stage_local.ps1` 另将已构建程序放入 `本地验证/versions/<版本>`，更新固定启动入口及 `本地验证/extension`。旧程序包和旧扩展备份保留，不修改用户数据、不终止运行中的应用。再次投放必须使用新版本号；验证前需用户退出旧服务。

连接码由五位端口加二十位密码学随机数字组成，仅连接回环地址，五分钟单次有效；全进程最多每分钟十次配对尝试。授权仍使用32字节随机令牌。连接活动记录只在服务内存，20秒没有心跳标记idle，不把浏览器弹窗休眠等同于凭据撤销。

发行包必须保持 `EasyResume.exe`、`_internal`、`extension` 和手册在同一目录。构建脚本只生成文件，不自动发布。`.github/workflows/windows-package.yml` 可手动构建并上传 Actions 产物；完成验证后才把对应产物上传 GitHub Release。

发布前核对 ZIP 内容、哈希、版本、第三方许可；在防护软件开启的环境运行启动、重复启动、端口冲突、升级和隔离数据解析测试。未经独立干净 Windows 测试时，发行说明必须保留这一限制。未签名测试包不应要求用户关闭防护软件。发布页面中的附件名必须与四语言 README 一致。

## 数据与恢复

默认数据目录 `%LOCALAPPDATA%\EasyResume` 与程序目录独立。重复启动同一数据目录应复用已有服务。数据库迁移失败停止写入，不用空库替代旧库。

用户导出的备份是删减后的业务数据，不是完整数据库镜像。恢复合并记录，不恢复连接密钥或可执行授权，也不回滚执行账本和额度。恢复前后均要核对省略项，禁止在测试中用用户真实备份替代夹具。

如果需要完整开发环境快照，先停止服务，再复制**隔离测试目录**。复制真实数据目录可能包含敏感原文和配置，不得提交到 Git 或随发行包分发。

## 隐私与连接边界

简历提取在有内存、时间和页数上限的子进程中运行。原始文件二进制不持久保存；提取文本和确认记录保存在本机。AI 默认关闭，每次外发先预览脱敏文本和目标服务；自动脱敏不能保证覆盖所有个人信息。模型输出要校验并由用户检查，不能创建平台授权或改写规则。

扩展只连接 `http://127.0.0.1` 根地址。配对码短期、单次有效；长期令牌仅存可信扩展上下文。`GET /api/v1/connection` 使用读取凭据验证实际连接，不能用存储里存在令牌代替在线状态。内容脚本没有管理、发送、Cookie 或任意网络代理权限。

## 更多设计资料

[设计基线](PLAN.md) · [验证状态](STATUS.md) · [平台验证](PLATFORM_VALIDATION.md) · [标注规范](ANNOTATION.md)
