# 招聘扩展复用调研（2026-10-19）

本次只读检查 GitHub 仓库、公开源文件与 Chrome 官方文档，未安装、执行第三方项目，也未用其调用招聘平台接口。以下是访问当日的分支状态，后续可能变化。README 的支持声明不等于真实页面测试通过；本次没有验证这些项目的运行效果。未找到许可证时，不直接复制其代码。

## 与本轮故障最相关的结论

- “获得权限”需要分清 Chrome 允许扩展读取指定站点、平台登录会话、网页实际加载状态、自动化工具本身的操作限制。它们不能互相替代。Chrome 官方说明内容脚本可以读取 DOM；程序化注入需要站点权限或临时 `activeTab`。这不保证页面一定加载，更不能证明平台授权。[内容脚本文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[activeTab 文档](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)。
- 现成项目提供了页面等待、滚动容器检测、后台任务和结果上报的思路，但没有找到能直接证明“智联无公开编号卡片在刷新后仍是同一岗位”的实现。不能用同名、同公司、同地点替代公开稳定标识，不能为恢复任务而降低身份门槛。
- BOSS 跳回首页或空白页应分别记录导航前后 URL、页面类型和是否已发出读取命令。第三方项目同样可能遇到重定向；其猜测不能作为 EasyResume 已确认的根因。

## 1. yychuiyan/auto-resume

证据：[仓库及 README](https://github.com/yychuiyan/auto-resume)、[v2 内容脚本](https://github.com/yychuiyan/auto-resume/blob/master/extension-v2.0/content.js)、[manifest](https://github.com/yychuiyan/auto-resume/blob/master/extension-v2.0/manifest.json)。

README 声明 v2 支持 BOSS、智联、前程无忧，但也明确 BOSS 路线调用搜索 API 获取标识并跳过详情页，不能据此证明左右分栏 DOM 适配可用。当前根目录没有展示许可证，根 `LICENSE` 请求返回 404；本次未确认可复用授权。

内容脚本使用重复注入保护、命令 ID 和单请求互斥，值得独立实现同类约束。其 10 秒超时解锁只能说明停止等待结果，不能证明原操作已经结束，不适合作为刷新前的静默完成确认。manifest 还包含 `cookies`；EasyResume 读取当前页面不因此增加 Cookie 权限。本轮不采用其非公开接口、自动发送或页面主世界桥接方案。

## 2. Chinaduanyun/JobsIn

证据：[README](https://github.com/Chinaduanyun/JobsIn)、[content.js](https://github.com/Chinaduanyun/JobsIn/blob/main/chrome_extension/content.js)、[background.js](https://github.com/Chinaduanyun/JobsIn/blob/main/chrome_extension/background.js)。

README 明确 BOSS 已实现，智联、前程无忧和猎聘为架构预留。根目录未展示许可证，根 `LICENSE` 请求为 404；本次不复制代码。

可读源码有滚动容器候选检测、卡片数量与容器高度增长记录、有限轮次等待；后台保存带 `command_id` 的待上报结果，并限制补报次数。可借鉴其诊断指标及“重新上报结果不等于重新执行页面动作”的职责划分。

局限：去重在没有 URL 时退回标题、公司、城市；详情使用全页查询，不能直接保证分栏选中对象一致；静止若干轮即结束也可能把加载失败误当末尾。导航只等 `complete` 加固定延时，不能证明 SPA 详情稳定。源码发现空白页时仅推测可能被检测，不能据此断定 EasyResume 的重定向原因。未在已检查文件中发现符合本项目要求的跨文档恢复核对。

## 3. h1077/BossJob-Helper

证据：[当前主分支](https://github.com/h1077/BossJob-Helper)、[发行记录](https://github.com/h1077/BossJob-Helper/releases)。

README 声称提供 BOSS 搜索、筛选、审核和桌面桥接；本次主分支文件列表只有 README，未能检查其声称的扩展引擎，也未核验可复用代码许可证。不下载运行发行二进制来替代源码核验，不能把它当作可直接整合的成熟适配器。

可作为产品需求对照：把采集、筛选、审核、结果记录分开；故障应有停止与诊断入口。自动回复、自动交换联系方式以及缺乏来源的 AI 风险定性不纳入本轮。发行说明中的性能、平台额度或防封效果均未作为本项目事实采用。

## 4. Ocyss/boss-helper

证据：[仓库](https://github.com/Ocyss/boss-helper)、[LICENSE](https://github.com/Ocyss/boss-helper/blob/main/LICENSE)、[README](https://github.com/Ocyss/boss-helper/blob/main/README.md)。

访问时仓库有较多提交和问题记录，相比前三者具备更多社区使用线索；这不证明本项目所需场景已被覆盖。README 定位为 BOSS 助手，使用 WXT，未据此认定支持智联。LICENSE 文件为 MIT，而 README 同时写有禁止商业用途，表述存在不一致；若实际搬用代码，需要先确认适用文件、固定提交及许可条件。本轮仅作思路参考。

可借鉴配置切换、筛选入口和扩展界面分工的产品方向。本次未完成其适配器源码审计，不声称它已解决 BOSS 重定向、双栏串位或刷新恢复；也不将 README 功能清单视作验收证据。

## 本轮采用与拒绝的工程做法

| 采用的思路 | 在 EasyResume 中的约束 |
|---|---|
| 有界等待和可读诊断 | 记录实际卡片数、容器、最终 URL、超时阶段；不把固定延时当成功 |
| 任务与结果分离 | 原步骤确认结束后才恢复；迟到结果不能使旧任务继续；保存失败不能重跑页面动作 |
| 页面增长检测 | 同时检查新增身份、加载状态和明确末尾；停滞与自然结束分别显示 |
| 命令互斥及注入幂等 | 新旧文档、任务及连接分别绑定，刷新后不能复用旧元素或旧行号 |
| 明确平台支持范围 | 分平台、分页面形态记录实测；预留适配接口不显示为已支持 |

拒绝直接移植基于标题拼接的跨刷新去重、不断刷新直到成功、自动处理验证码、模拟行为以规避检测、读取或导出 Cookie，以及未验证的自动发送。GitHub 研究为实现提供线索；真实 BOSS/智联的批量读取、加载、末尾停止和恢复仍需单独记录本机实测结果。
