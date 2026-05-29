---
domain: neustudydl.neumooc.com
aliases: [东软智慧教育平台, neumooc, 东软教育, NEU]
updated: 2026-05-15
---

## 平台特征

- 东软智慧教育平台（NEU），Element UI (Vue2) + 自定义样式，Vue3 组件
- 课程详情页 URL 固定不变，tab 切换（导学/测验/作业/学习资料等）均为前端路由，URL 始终是同一个
- 课程页 tab 使用自定义 `.tabItem` 类（非 `.el-tabs__item`），当前激活 tab 有 `.tabFocus` 类
- **作业**和**测验**结构完全相同，操作方式一致，均在课程详情页对应 tab 下以 `.card_item` 条目列表展示，无需新开 tab
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
function matchStatus(item, codes) {
  const spans = item.querySelectorAll("span");
  const t = spans[spans.length - 1]?.textContent || "";
  const chars = Array.from(t).filter(c => c.charCodeAt(0) > 255);
  return chars.length === codes.length && chars.every((c, i) => c.charCodeAt(0) === codes[i]);
}
```

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
- 作业和测验操作方式完全一致，切换 tab 后操作流程相同（2026-05-15）
- 学习资料状态文字前有 ` `，必须用 charCode 过滤后比较，不能用字符串直接匹配（2026-05-15）
- 视频类资料（.mp4）：HLS 流加载需 10-15 秒，必须等 `video.duration` 有值后再快进。快进后需等 5-8 秒让视频自然播放到末尾触发 `ended`。完成后弹窗按钮用 `[0]` 索引关闭（2026-05-22 验证）
- 视频完成后列表状态先变"学习中"，稍后自动更新为"已完成"，属正常延迟（2026-05-22）
- 部分视频源可能损坏或 CDN 不可达，表现为 `video.duration` 始终为 NaN/null、`readyState` 卡在 0。必须设超时（重试 5 次，间隔 10 秒，共约 60 秒），超时后关闭 tab 跳过，不要阻塞后续视频（2026-05-22）
- 测验/作业列表可能有多条，已完成项按钮为"详情"，已作答项按钮也可能变为"详情"。存在"已作答"中间状态，此类测验无需重复做，直接跳过。每次进入列表应重新扫描"去作答"按钮，因为提交后按钮顺序会变（2026-05-22）

