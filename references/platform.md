---
domain: neustudydl.neumooc.com
aliases: [东软智慧教育平台, neumooc, 东软教育, NEU]
updated: 2026-06-01
---

## 🔴 编码铁律（2026-06-01 实测，最高优先级）

在 **Windows shell → curl → CDP Proxy → 浏览器** 这条链路上，**写进 curl `-d` 请求体里的中文字面量会被编码破坏**：例如发送 `学习资料`，到浏览器变成 `ѧϰ����`（charCode `[1127,1008,65533,65533,...]`，`65533` 是 Unicode 替换字符）；用中文字面量拼接的返回串回程也会损坏（`测试中文` → `��������`）。

- **后果**：所有 `textContent.trim() === "中文"`、`text.includes("中文")` 比较**静默失败**。表现为切不到 tab、找不到 `去作答`/`提交`/`去学习` 按钮、答题扫描 `filter` 返回空数组而误报"全部已完成"漏做作业。这是本平台自动化最易踩、最隐蔽的致命坑。
- **关键区别**：从 **DOM 读出来**的中文（文件名 `.file-name__span`、题目文本 `.item-box`）回传**完全正常**，可以自由 return；损坏的只是**你手写进请求体的中文字面量**。
- **修复**：请求体里要用的中文，一律 `String.fromCharCode(...)` 在浏览器端构造；要回传自己的标记用纯 ASCII（`"clicked"`/`"not found"`），不要拼中文。

常用 charCode 速查（用于 `String.fromCharCode(...)`）：

| 文本 | charCode |
|------|----------|
| 学习资料 | `23398,20064,36164,26009` |
| 作业 | `20316,19994` |
| 测验 | `27979,39564` |
| 去作答 | `21435,20316,31572` |
| 已作答 | `24050,20316,31572` |
| 已完成 | `24050,23436,25104` |
| 去学习 | `21435,23398,20064` |
| 提交 | `25552,20132` |
| 未学习 | `26410,23398,20064` |
| 学习中 | `23398,20064,20013` |

表外的中文：用一次 eval 对 **DOM 文本**取 `Array.from(el.textContent.trim()).map(c=>c.charCodeAt(0))`（不要对你发的字面量取）拿到 charCode。

## 平台特征

- 东软智慧教育平台（NEU），Element UI (Vue2) + 自定义样式，Vue3 组件
- 课程详情页 URL 固定不变，tab 切换（导学/测验/作业/学习资料等）均为前端路由，URL 始终是同一个
- 课程页 tab 使用自定义 `.tabItem` 类（非 `.el-tabs__item`），当前激活 tab 有 `.tabFocus` 类
- **作业/测验有两种类型（2026-06-01 实测修正）**：
  - **选择题型**：在课程详情页对应 tab 下以 `.card_item` 列表展示，点"去作答"后**在同一课程页 URL 内**切换为答题视图（`.item-box` 题目列表），这是 skill 支持的场景。
  - **任务型作业**（`taskBasedAssignment`）：点"去作答"**新开 tab**（URL `/taskBasedAssignmentQuestions/...`，标题"任务型作业答题"），页面是富文本编辑器 + 附件上传，要求写文档/传附件，**没有 `.item-box`/`.el-radio`**。这类作业 skill **不自动完成**——它需要真实学科作业内容且要外发提交，应跳过并提示用户手动完成。
  - **判断依据**：点"去作答"后若 `.item-box` 为 0 且 `/targets` 多出 `/taskBasedAssignmentQuestions/` 的新 tab，即为任务型，关闭该 tab 跳过，不要提交。
- 每个条目包含：名称、作答次数、截止状态（进行中/已截止）、**作答状态**（已作答/未作答/已完成）。作答状态是关键判断依据："已作答"或"已完成"的条目直接跳过，即使"去作答"按钮仍存在（部分测验允许多次作答）。只有"未作答"且可点击"去作答"的才需要进入答题（2026-05-22 更新）
- 作答页面一次只显示一题，通过"上一题"/"下一题"按钮切换，右侧有"答题卡"
- 所有题目均存在于 DOM 中（`.item-box`），可批量提取和作答，无需逐题翻页
- 题目类型：单选题（`.el-radio`）、多选题（`.el-checkbox`）、判断题（`.el-radio`，A.正确/B.错误）
- 提交时需二次确认：弹出 `.el-message-box` 对话框，需点击"确定"
- 提交成功后页面自动返回列表，按钮变为"详情"，进度条变绿
- **学习资料**在 `学习资料` tab 下，资料条目选择器为 `.resItem`，文件名选择器为 `.file-name__span`
- 学习资料的"去学习"按钮为 `.el-button--primary.el-button--small`，点击后**新开 tab**（URL: `/resourcesLearning/index/...`）
- 文档类资料（.docx/.pdf）：在资料页停留约 30 秒，系统自动标记已完成，无需任何操作（2026-05-15 验证）
- 视频类资料（.mp4）：HLS 流播放，快进到末尾触发 `ended` 事件后平台自动调用 `studyForAudioOrVideo` API 标记完成。视频播放器为自定义 `d-player`，`<video>` 元素 id 为 `dPlayerVideoMain`。直接设置 `video.currentTime` 不受 UI 进度条限制（2026-05-22 验证）

## 有效模式（2026-05-14 验证）

> ⚠️ **下面代码片段为了可读性直接写了中文字面量**（`"学习资料"`/`"去作答"`/`"提交"` 等），但**真正通过 curl `-d` 发送时必须改成 `String.fromCharCode(...)`**，否则中文会被编码破坏导致匹配失败——见顶部"编码铁律"。这些片段展示的是逻辑结构，charCode 见铁律速查表。

### 切换课程 Tab

```js
// 课程页 tab 用 .tabItem，不是 .el-tabs__item
const tabs = document.querySelectorAll(".tabItem");
for (const t of tabs) {
  if (t.textContent.trim() === "学习资料") { t.click(); break; }
}
```

### 扫描可作答项（含状态过滤）— SKILL.md 1.3 节的权威参考

每条作业/测验是 `.card_item` 条目，内含名称、次数、状态、"详情"/"去作答"按钮。**必须先检查状态**：已作答/已完成的跳过，只做未作答的。

```js
// 列出所有条目及其状态
const cards = document.querySelectorAll(".card_item");
const items = [];
for (let i = 0; i < cards.length; i++) {
  const text = cards[i].innerText;
  const hasAnswered = text.includes("已作答") || text.includes("已完成");
  const hasGoBtn = text.includes("去作答");
  items.push({ index: i, name: text.split("\n")[0], hasAnswered, hasGoBtn });
}
// 只处理 !hasAnswered && hasGoBtn 的条目
```

### 打开作业/测验

从上面过滤出的未作答条目中，取对应 `.card_item` 下的"去作答"按钮点击：

```js
const card = document.querySelectorAll(".card_item")[TARGET_INDEX];
const btn = Array.from(card.querySelectorAll("button")).find(b => b.textContent.trim() === "去作答");
if (btn) btn.click();
```

### 批量作答（单选/判断）

所有题目均在 DOM 中，可一次性批量点击，无需翻页：
```js
// answers: { item-box索引: 选项索引(0=A,1=B,2=C,3=D) }
const answers = {0:2, 1:0};
const items = document.querySelectorAll(".item-box");
for (let i = 0; i < items.length; i++) {
  const radios = items[i].querySelectorAll(".el-radio");
  radios[answers[i]].click();
}
```

### 多选题

**必须点击 `.el-checkbox__input` 而非 `.el-checkbox`**，每个选项点击之间需要约 200ms 延迟：
```js
const inputs = visible.querySelectorAll(".el-checkbox__input");
inputs[0].click(); await sleep(200);
inputs[1].click(); await sleep(200);
```

**已知陷阱**：直接点击 `.el-checkbox`（外层 label）会导致只有最后一个点击生效。

### 提交作业/测验

```js
// 1. 点击"提交"按钮
const btns = document.querySelectorAll("button");
for (let i = 0; i < btns.length; i++) {
  if (btns[i].textContent.trim() === "提交") { btns[i].click(); break; }
}
// 2. 等待约 1.5s 后点击对话框"确定"
// 按钮索引：[0]=关闭X（右上角）, [1]=取消, [2]=确定
const dlg = document.querySelector(".el-message-box");
dlg.querySelectorAll("button")[2].click();
```

### 学习资料状态检测

资料状态文字在 `.resItem` 最后一个 `span` 内，前有 ` `（非断行空格），不能用 `.trim()` 或 `includes()` 直接匹配：

```js
// 已完成 charCodes: [24050,23436,25104]
// 未学习 charCodes: [26410,23398,20064]
// 学习中 charCodes: [23398,20064,20013]
function matchStatus(item, codes) {
  const spans = item.querySelectorAll("span");
  const t = spans[spans.length - 1]?.textContent || "";
  const chars = Array.from(t).filter(c => c.charCodeAt(0) > 255);
  return chars.length === codes.length && chars.every((c, i) => c.charCodeAt(0) === codes[i]);
}
```

**状态读取关键**：课程页 DOM 状态只在页面刷新后准确。开工/重启续传时刷新页面读一次状态确定工作队列，刷课过程中以本地队列记账，最终核验时再刷新读一次。详见下方"断点续传与核验关键"。

### 学习资料批量刷完（文档类）

```js
// 点击第 N 个资料的"去学习"按钮
document.querySelectorAll(".el-button--primary.el-button--small")[N].click();
// 新 tab 打开后停留 ~30s，系统自动标记完成
// 然后关闭该 tab，继续下一个
```

### 学习资料批量刷完（视频类）

```js
// 1. 点击"去学习"打开视频 tab（同文档类）
// 2. 等待 10-15s 视频加载后快进到末尾
const video = document.querySelector("video");
video.currentTime = video.duration - 3;
// 3. 等待 5-8s 视频自然结束，检查完成弹窗
const msgBox = document.querySelector(".el-message-box");
// msgBox 存在说明已完成
// 4. 关闭弹窗
msgBox.querySelectorAll("button")[0].click();
// 5. 关闭 tab，继续下一个
```

## 已知陷阱

- `textContent.trim() === "确定"` 在 /eval 中因编码问题可能匹配失败，改用 `.el-message-box button` 的索引 `[2]`（2026-05-15）
- 多选题不能快速连续点击，必须每个选项间隔约 200ms（2026-05-14）
- 点击 `.el-checkbox`（外层）不会触发多选切换，必须点击 `.el-checkbox__input`（2026-05-14）
- 提交后需等待对话框出现再点击确定，间隔约 1-1.5s
- 作业/测验名称列表不含序号前缀，每提交一个后按钮顺序会变，用文本匹配比索引更稳定
- 作业和测验操作方式完全一致，切换 tab 后操作流程相同（2026-05-15）。**但任务型作业例外**（见上方"作业/测验有两种类型"），点"去作答"会新开 tab 且无选择题，需跳过。
- **targetId 必须用 `/targets` 返回的完整值，绝不截断（2026-06-01 实测）**：targetId 是 32 位十六进制串（如 `6EF62BE7B25D60D4E5C0EDEE45A673E8`），截断成前 12 位会导致 `attach 失败: No target with given id found`。脚本里解析 targets 时不要为了显示而 slice targetId。
- 学习资料状态文字前有 ` `，必须用 charCode 过滤后比较，不能用字符串直接匹配（2026-05-15）
- 视频类资料（.mp4）：HLS 流加载需 10-15 秒，必须等 `video.duration` 有值后再快进。快进后需等 5-8 秒让视频自然播放到末尾触发 `ended`。完成后弹窗按钮用 `[0]` 索引关闭（2026-05-22 验证）
- 视频完成后列表状态先变"学习中"，刷新页面后才更新为"已完成"，属正常延迟（2026-05-22 / 2026-06-01 补充：需刷新才可见最终状态）
- **并行度（2026-06-01）**：平台对刷课节奏无严格审计，可适度并行提升效率。文档类资料每批同时开 5 个 tab（只需停留 ~30s，无交互），视频类每批同时开 3 个 tab（各自在独立 tab 等 `ended`，互不干扰）。仍以稳定优先，浏览器/proxy 卡顿时降档（文档 3 / 视频逐个），不要无上限开 tab 拖垮浏览器。
- 部分视频源可能损坏或 CDN 不可达，表现为 `video.duration` 始终为 NaN/null、`readyState` 卡在 0。必须设超时（重试 5 次，间隔 10 秒，共约 60 秒），超时后关闭 tab 跳过，不要阻塞后续视频（2026-05-22）
- 测验/作业列表可能有多条，已完成项按钮为"详情"，已作答项按钮也可能变为"详情"。存在"已作答"中间状态，此类测验无需重复做，直接跳过。每次进入列表应重新扫描"去作答"按钮，因为提交后按钮顺序会变（2026-05-22）
- **断点续传与核验关键（2026-06-01 修复+全流程实测，含用户反馈 bug）**：课程页学习资料列表的状态文字（已完成/未学习/学习中）只有在**页面刷新后**才反映服务器真实状态。刷课过程中关闭资料 tab 并不会刷新课程页 DOM；视频刷完后列表还会先停在"学习中"，刷新后才变"已完成"。若不刷新就重新扫描，会把已完成的误判为未完成又重刷一遍（用户实测 bug）。正确做法：① 最终核验、**每批资料刷完后**、断点续传重启前，必须先 `location.reload()`（reload 触发导航，eval curl 可能超时/返回空，sleep ~6s，刷新后回到默认 tab 需用 charCode 构造重新点"学习资料" tab），再扫描；② **原子扫描+点击**——在同一次 eval 内实时找第一个 `!done`（charCode 判 `isDone`）的资料并点击，**绝不"先扫描记下 index、再用旧 index 点击"**：实测同一批 learning 视频 index 会从 15,16,17 漂移到 42,45,46，旧 index 会点错；用页面内 `window.__neuSkip` Set 避免一批内重复点同一项（刷新自动清空）；③ 范围用 `!done`（含 todo 未学习 + learning 学习中，learning 多为看一半没触发 ended，需补刷）。
- **index 会漂移（2026-06-01 实测）**：`location.reload()` 或资料完成后，`.resItem` 列表顺序会变，同一文件的 index 改变。所以 index 只能在"扫描的同一次 eval 内"即时使用，不能跨 curl 调用复用。配合原子扫描+点击 + `isDone` 跳过，整个流程天然幂等。
- **资料列表重名（2026-06-01 实测）**：同一课程的资料列表里存在多个同名文件（如多个 `1.命题逻辑.pdf`、两份 `8_逻辑等价式.mp4`/`17_带量词的推理规则.mp4`），因此**绝不能用文件名定位**；原子扫描按 DOM 顺序逐个点 `!done` 即可覆盖所有副本。
- **按钮与条目对齐可靠（2026-06-01 实测）**：全局 `document.querySelectorAll(".el-button--primary.el-button--small")` 的数量恰好等于 `.resItem` 数量，第 i 个按钮对应第 i 个 `.resItem`。之前怀疑的"索引错位"根因实际是编码 bug 导致的连锁误判——index 定位本身是可靠的，配合点击前状态校验即可。

