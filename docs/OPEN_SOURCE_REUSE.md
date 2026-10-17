# 开源项目参考与复用评估

核查日期：2026-10-17。本文记录本次实际查看的公开仓库与默认分支快照，作为 EasyResume 后续改进的参考，不表示第三方项目已通过当前 BOSS／智联登录页面的兼容性验证。

核查包括 GitHub 仓库信息、固定提交下的实际代码、许可文件或许可声明。未运行第三方扩展，未调用招聘平台私有接口，未获取平台凭据，也未将第三方代码复制进本项目。下列“可借鉴”不表示本项目已经实现对应改进。

## 结论与优先级

| 优先级 | 仓库与核查快照 | 值得参考的部分 | 本次处理 |
|---|---|---|---|
| 1 | [geekgeekrun/geekgeekrun](https://github.com/geekgeekrun/geekgeekrun)，`c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a`，提交日期 2026-05-02 | BOSS 推荐列表容器、滚动追加与列表末端处理的实际行为 | 只参考已观察到的 DOM 行为；许可文件未厘清前不移植代码 |
| 2 | [DeLightor/resume_agent](https://github.com/DeLightor/resume_agent)，`ea23448c659417750bad818a6dbd98b1ed47a2b6`，提交日期 2026-09-13 | 逐字段原文回查、可编辑确认、确认后才入库、任务恢复测试 | 可借鉴独立的交互与依据表达；不替换本项目解析器和日期模型 |
| 3 | [mrcxsy/boss-auto-apply](https://github.com/mrcxsy/boss-auto-apply)，`c70372108354b3b1efdaf16775ffcbff42853919`，提交日期 2026-06-23 | 取消信号、等待清理、选择器分层；其实现也提供了应避免的反例 | 只评估与读取可靠性相关的独立思路；不接入字体猜测和反检测模块 |
| 4 | [yychuiyan/auto-resume](https://github.com/yychuiyan/auto-resume)，`a4724ff4f611b9ec1458f1e479f3f654ec5bb7e7`，提交日期 2026-09-10 | 多平台任务进度、解析后核对的产品流程 | 不引入代码；其接入方式与 EasyResume 的 DOM 读取边界不同 |

这些日期来自核查时默认分支提交记录，不代表最近一次真实招聘站点测试的日期。固定提交链接用于避免后续分支变更使结论失去依据。

## 1. BOSS 推荐列表：参考实际滚动区域，保留自己的安全边界

代码依据：

- [列表定位与空列表分支](https://github.com/geekgeekrun/geekgeekrun/blob/c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a/packages/geek-auto-start-chat-with-boss/index.mjs#L933-L944)。
- [在列表区域滚动并等待追加](https://github.com/geekgeekrun/geekgeekrun/blob/c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a/packages/geek-auto-start-chat-with-boss/index.mjs#L1068-L1098)。
- [滚动到列表项及选中详情](https://github.com/geekgeekrun/geekgeekrun/blob/c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a/packages/geek-auto-start-chat-with-boss/index.mjs#L1114-L1137)。

该实现确实定位 `.job-list-container .rec-job-list`，在列表所在区域触发滚动以取得后续职位。它支持“推荐列表可能通过追加加载继续”的判断，不能据此推断每个页面都有传统下一页按钮。它使用的是后代选择器；EasyResume 实际页面中的 `.job-list-container > ul.rec-job-list` 是否成立，仍应以本项目真实页面观察为准。

不能照搬的部分：其加载完成和末页判定还依赖请求监听、页面内部 Vue 对象与 `hasMore`，并且整体包含自动沟通流程。这些与本项目读取已打开页面、遇到异常暂停的边界不同。Puppeteer／Electron 登录与会话管理也不应一起引入。

许可依据：[根 package.json](https://github.com/geekgeekrun/geekgeekrun/blob/c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a/package.json#L1-L24) 声明 `ISC`；但核查快照中未找到仓库级 LICENSE 正文，GitHub 仓库元数据也未识别出许可。不能简单写成“完全没有许可”，也不把单个元数据字段当作完整许可审查。本次只记录页面行为，不移植源码；若后续需要移植，应先厘清目标模块的授权与应保留的声明。

对照 EasyResume：保持平台适配器负责列表和详情识别、批量读取器负责有界交互、后台负责状态与持久化的分工。读取成功需要关联选中岗位与右侧详情；列表追加成功需要看到新增岗位标识，不能只因为发生了滚动就增加页数。

本轮结合真实页面对照后，已将卡片定位从“列表的直接子节点”改为“归属于已验证列表的外层职位卡片”，允许中间包装层，并继续排除嵌套列表、右侧详情和歧义容器。实现由本项目独立编写，未复制该仓库代码；包装层回归与真实站点验收分别记录在[验证状态](STATUS.md)。

## 2. 中文简历：优先借鉴逐字段确认，不引入整套 Agent 系统

代码依据：

- [确定性的原文回查与字段标记](https://github.com/DeLightor/resume_agent/blob/ea23448c659417750bad818a6dbd98b1ed47a2b6/backend/src/resume_agent/parsers/confidence.py)。
- [可编辑解析确认界面](https://github.com/DeLightor/resume_agent/blob/ea23448c659417750bad818a6dbd98b1ed47a2b6/frontend/src/components/common/ParseConfirmModal.tsx)。
- [确认接口及任务状态处理](https://github.com/DeLightor/resume_agent/blob/ea23448c659417750bad818a6dbd98b1ed47a2b6/backend/src/resume_agent/api/resumes.py#L516-L545)。
- [恢复及确认后使用修正数据的测试](https://github.com/DeLightor/resume_agent/blob/ea23448c659417750bad818a6dbd98b1ed47a2b6/backend/tests/test_parse_recovery.py#L48-L105)。

这部分并非只有 README 描述：代码确实按归一化字段值是否出现在原文中生成标记，确认界面支持逐项修改，并明确区分原文匹配程度和事实核验；测试覆盖修正后的内容被使用、重复确认不重复入库等行为。这比让模型自行报告“准确率 98%”更容易解释和核对。

仍有不能继承的局限：

- [DOCX 解析器](https://github.com/DeLightor/resume_agent/blob/ea23448c659417750bad818a6dbd98b1ed47a2b6/backend/src/resume_agent/parsers/docx_parser.py#L38-L53) 仍分别遍历段落和表格，不能替换 EasyResume 已修复的原文顺序与合并单元格处理。
- [教育和工作模型](https://github.com/DeLightor/resume_agent/blob/ea23448c659417750bad818a6dbd98b1ed47a2b6/backend/src/resume_agent/parsers/extractor.py#L83-L99) 使用自由文本 `period`，并未提供本项目需要的年月精度、在读／已完成状态及工作区间合并规则。
- 字段在整份原文中命中，不证明它属于当前经历；同一学校多次出现、不同经历复用日期等情况，仍需要局部片段和记录关联。
- 确认界面没有承诺刷新后恢复所有未提交编辑，不能据其 README 的整体编辑保护说明推断此弹窗也已具备相同保证。

许可依据：[MIT LICENSE](https://github.com/DeLightor/resume_agent/blob/ea23448c659417750bad818a6dbd98b1ed47a2b6/LICENSE)。若今后复用实际代码，需要保留其版权和许可声明；本次没有复制实现。MinerU、LLM、向量库和版本树等其余系统不属于本次建议引入的范围。

## 3. 取消与薪资 PUA：可参考清理方式，不能把猜测当成工资

代码依据：

- [取消控制和可中断等待](https://github.com/mrcxsy/boss-auto-apply/blob/c70372108354b3b1efdaf16775ffcbff42853919/src/utils.js#L10-L15)、[等待结束后的清理](https://github.com/mrcxsy/boss-auto-apply/blob/c70372108354b3b1efdaf16775ffcbff42853919/src/utils.js#L209-L240)。
- [选择器分类](https://github.com/mrcxsy/boss-auto-apply/blob/c70372108354b3b1efdaf16775ffcbff42853919/src/core/selectors.js)。
- [薪资 PUA 处理与薪资解析实现](https://github.com/mrcxsy/boss-auto-apply/blob/c70372108354b3b1efdaf16775ffcbff42853919/src/modules/filters.js#L141-L290)。

实际代码包含取消信号、定时器及事件监听清理，也有 Canvas 字形比较，并非只有 README 声称。但不建议引入其薪资处理：它会强制为每个未知字形选择一个数字，缺少拒识门槛；缓存依据是 CSS 字体字符串，并非具体字体内容；取字体时还从全页第一个薪资元素开始。这些条件不足以证明结果对应当前岗位和本次页面的真实薪资。

本项目继续将无法可靠读取的薪资保留为未知并提供核对入口，不通过字形猜测制造确定数字，不硬编码 PUA 码位映射，也不让不可靠金额触发薪资硬筛。该项目按日薪推算月薪、对 JD 进行固定长度截断等规则，同样不能直接成为本项目的待遇口径或原文保存规则。

其事件可信度修改、反检测、自动发送及任意 API 代理模块均不纳入采纳范围。通用取消模式可参考，但 EasyResume 已有的取消、超时和后台任务生命周期不能被整套替换。

许可依据：[Apache-2.0 LICENSE](https://github.com/mrcxsy/boss-auto-apply/blob/c70372108354b3b1efdaf16775ffcbff42853919/LICENSE)。若后续移植独立代码，需要保留相应许可、归属声明和修改说明，不能把第三方部分重新标为仅适用本项目 MIT。

## 4. 三平台声明：不能等同于可直接复用的分栏 DOM 适配

代码依据：

- [README 的三平台说明](https://github.com/yychuiyan/auto-resume/blob/a4724ff4f611b9ec1458f1e479f3f654ec5bb7e7/README.md)。
- [智联内容脚本桥](https://github.com/yychuiyan/auto-resume/blob/a4724ff4f611b9ec1458f1e479f3f654ec5bb7e7/extension-v2.0/zcontent.js)。
- [智联主页面环境中的调用](https://github.com/yychuiyan/auto-resume/blob/a4724ff4f611b9ec1458f1e479f3f654ec5bb7e7/extension-v2.0/zinject.js)。
- [简历解析结果的实际字段](https://github.com/yychuiyan/auto-resume/blob/a4724ff4f611b9ec1458f1e479f3f654ec5bb7e7/extension-v2.0/resume-ai.js#L143-L149)、[解析提示与请求](https://github.com/yychuiyan/auto-resume/blob/a4724ff4f611b9ec1458f1e479f3f654ec5bb7e7/extension-v2.0/resume-ai.js#L241-L286)。

代码存在平台接入流程，但智联主要通过主页面脚本、平台令牌及私有接口执行，不能据此认定已经实现可移植的“左列表、右详情”DOM 识别。简历解析返回的主要是职位方向、城市、技能与工作关键词，不是完整的教育经历、毕业状态和逐段工作年月模型。

多平台分别展示任务进度、操作前核对解析结果的交互值得参考；会话凭据、私有接口、自动投递和主页面注入不进入 EasyResume。核查快照的文件树中未见 LICENSE 文件或明确许可条款，因此本次不移植代码。

## 采纳与不采纳

可作为本项目后续设计依据：

- 以已验证的左侧列表容器和新增稳定标识判断追加加载，保持右侧详情与选中岗位一致。
- 将加载中、确实没有更多、等待超时分别展示；可恢复的失败保留已处理进度。
- 逐字段展示原文依据、缺失项和人工修改状态，确认后的内容才参与资格判断。
- 保持停止、超时、监听器清理和旧任务恢复规则可测试。

本次明确不引入：

- PUA 强制猜数字、静态薪资映射和不带依据的工资换算。
- 平台 Cookie／Token 提取、私有接口和独立登录浏览器。
- `__vue__` 等框架内部状态、事件可信度修改和反检测 hook。
- 自动发送流程、整仓 fork、未明确授权的源码，以及与当前目标无关的 Agent／RAG 基础设施。

## 后续候选改进与验证门槛

以下仅是建议，尚未承诺实施，也不需要扩大浏览器权限。

### A. 列表加载进度与停滞提示

在现有 DOM 批量读取上补充更明确的加载状态：只观察已验证列表中的新增岗位标识和可见加载／结束标记。没有新标识且未见结束依据时，提示“未加载出下一批，可回到列表手动加载后继续”，不能直接宣称没有更多职位。若使用 MutationObserver 辅助等待，必须与取消和超时一起清理。

放行前应在真实 BOSS 和智联页面分别验证：新增一批、慢加载、重复卡片、停止时仍在加载、切换筛选条件，以及页面明确结束。需记录新增标识、实际滚动区域与最终保存结果；DOM 夹具只能用于回归，不代替真实站点证据。未知情况暂停，不连续滚动重试。

### B. 简历字段依据的定点核对

在现有经历编辑流程上，对学校、公司、起止年月和关键资格字段补充“查看对应原文”的定点入口，并标明缺失或关联不明确的字段。原文命中只表示提取依据，不能升级为事实已核实。回查应限制在对应经历片段，不用整份简历中的同名词替另一段经历作证。

放行前使用合成与授权语料覆盖：同校多段教育、同公司多次任职、重复绘制的 PDF、只有年份、在读及否定技能；验证跨经历字段不会互相借用。用户修正、取消、刷新及失败重试后不得静默丢失内容。准确率和完成时间仍应单独实测，不能以结构校验通过代替。

