---
name: neusoft-edu
description: 东软智慧教育平台自动化：自动答题（作业/测验）+ 自动刷学习资料（文档/视频）。
---

# 东软智慧教育平台自动化

专为 neustudydl.neumooc.com 设计的自动化 skill，覆盖自动答题和自动刷学习资料两大场景。

## ⚠️ 关键约束（必须遵守）

1. **只通过 curl 调用 CDP Proxy（localhost:3456）操作浏览器**。禁止使用 mcp__Claude_in_Chrome__* 等浏览器 MCP 工具。本 skill 的所有浏览器操作都是 curl → CDP Proxy → 浏览器（Chrome/Edge，取决于 web-access 的 config.env 配置）。浏览器偏好和 CDP 连接已预先配好，不需要重新配对或授权。
2. **用户已在浏览器中打开课程页**。不需要导航、打开 URL、或搜索页面。直接 curl targets 找到已有 tab 即可。
3. **启动顺序固定为 3 步**，不要增加额外步骤：
   - Step 1: `node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"` — 确认 proxy 就绪
   - Step 2: `curl -s --max-time 10 http://localhost:3456/targets` — 找到 neumooc tab
   - Step 3: 开始执行对应流程（答题/刷资料）

如果 Step 2 已经能返回包含 `neumooc.com` 的 tab，**立即开始工作**，不要做任何其他准备。

---

## 前置准备

本 skill 依赖 [web-access](https://github.com/eze-is/web-access) 的 CDP 基础设施。操作前执行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

处理 check-deps 输出：
- `proxy: ready` 或 `proxy: ok` → 直接 curl targets，开始工作
- `exit 2`（needs decision）→ 问用户用哪个浏览器，写入 config.env 后重跑
- `exit 1`（连接失败）→ 按脚本输出的提示操作，不要自行猜测解决方案

**所有 curl 调用必须带超时参数**，防止 agent 卡住：
- `--max-time 10`：targets 查询、tab 关闭
- `--max-time 15`：普通 eval（DOM 操作）
- `--max-time 30`：视频相关 eval（HLS 加载慢）

若 curl 超时（exit code 28），按下方错误恢复策略处理。

**平台详细参考**：遇到选择器或编码问题时，读取 `references/platform.md`。

---

## 执行决策树

| 用户意图 | 执行流程 |
|----------|----------|
| 做作业 / 做测验 | → 一、自动答题 |
| 刷学习资料 / 刷课 | → 二（文档）+ 三（视频），自动区分类型 |
| 只刷文档 | → 二、自动刷文档资料 |
| 只刷视频 | → 三、自动刷视频资料 |

### 错误恢复策略

| 错误场景 | 处理方式 |
|----------|----------|
| curl 超时（exit code 28） | CDP proxy 可能挂起。先 curl targets 测试连通性，若也超时则提示用户重启 proxy |
| curl 返回空或连接拒绝 | proxy 未启动，重新执行 check-deps.mjs 启动 proxy |
| targets 中找不到 neumooc tab | 提示用户在浏览器中打开课程页，等待后重试 |
| eval 返回 null / undefined / "not found" | 等待 2s 重试一次，仍失败则向用户报告当前页面状态 |
| eval 卡住（超时返回） | 页面可能在加载中或弹窗阻塞，等 3s 后重试，最多 2 次 |
| 按钮点击后页面无变化 | 等待 2s，重新查询 DOM 确认状态，必要时刷新页面重试 |
| 视频 duration 始终为 NaN | 重试 5 次（间隔 10s，共约 60s），超时则跳过该视频继续下一个 |
| 提交后无确认弹窗 | 等待 3s 重试点击提交按钮，最多重试 2 次 |
| 新开 tab 未出现在 targets 中 | 等待 3s 后重新 curl targets |

---

## 一、自动答题

### 1.1 找到课程页 Tab

```bash
curl -s --max-time 10 http://localhost:3456/targets
```

从返回列表中找到 URL 包含 `neumooc.com` 的 tab，记录其 `targetId`（后续称 `TAB_ID`）。

### 1.2 切换到作业或测验 Tab

课程页 tab 使用自定义 `.tabItem` 类（非 `.el-tabs__item`）：

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const target = "作业";  // 或 "测验"，根据用户请求决定
  const tabs = document.querySelectorAll(".tabItem");
  for (const t of tabs) {
    if (t.textContent.trim() === target) { t.click(); return "clicked " + target; }
  }
  return "tab not found";
})()'
```

### 1.3 扫描可作答项（含状态过滤）

使用 `.card_item` 扫描条目并过滤状态，只处理"未作答"的：

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const cards = document.querySelectorAll(".card_item");
  const items = [];
  for (let i = 0; i < cards.length; i++) {
    const text = cards[i].innerText;
    const hasAnswered = text.includes("已作答") || text.includes("已完成");
    const hasGoBtn = text.includes("去作答");
    items.push({ index: i, name: text.split("\\n")[0], hasAnswered, hasGoBtn });
  }
  return items.filter(x => !x.hasAnswered && x.hasGoBtn);
})()'
```

若返回空数组，说明所有作业/测验已完成，向用户报告即可。

### 1.4 进入作答页面

从上一步结果取目标条目的 index，点击其"去作答"按钮：

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const card = document.querySelectorAll(".card_item")[INDEX];
  const btn = Array.from(card.querySelectorAll("button")).find(b => b.textContent.trim() === "去作答");
  if (btn) { btn.click(); return "entered"; }
  return "button not found";
})()'
```

### 1.5 提取全部题目

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const items = document.querySelectorAll(".item-box");
  const result = [];
  items.forEach((item, i) => {
    const hasRadio = item.querySelectorAll(".el-radio").length > 0;
    const hasCheckbox = item.querySelectorAll(".el-checkbox").length > 0;
    result.push({
      index: i,
      type: hasCheckbox ? "multiple" : "single",
      text: item.innerText.trim()
    });
  });
  return result;
})()'
```

### 1.6 AI 分析答案

将提取的题目列表交给 AI 分析。**必须按以下 JSON 格式输出**：

```json
{
  "answers": {
    "0": [2],
    "1": [0, 2],
    "2": [0]
  }
}
```

格式规则：
- key 为题目索引（字符串），value 为选项索引数组
- 单选题 / 判断题：数组只有一个元素，如 `[2]` 表示选 C
- 多选题：数组有多个元素，如 `[0, 2]` 表示选 A+C
- 判断题选项：`[0]` = 正确（A），`[1]` = 错误（B）
- 不确定的题目仍给出最可能的答案，不要跳过

### 1.7 批量作答

根据题目类型分别处理。先处理所有单选/判断题，再处理多选题：

**单选题 / 判断题**（`.el-radio`）：
```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const answers = {"0":[2], "1":[0], "2":[1]};  // 替换为 AI 输出
  const items = document.querySelectorAll(".item-box");
  for (const [idx, opts] of Object.entries(answers)) {
    const item = items[parseInt(idx)];
    if (!item) continue;
    const radios = item.querySelectorAll(".el-radio");
    if (radios.length > 0 && opts.length === 1) {
      radios[opts[0]]?.click();
    }
  }
  return "single done";
})()'
```

**多选题**（`.el-checkbox__input`，必须逐个点击并加 200ms 延迟）：
```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(async function() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const answers = {"3":[0,2], "5":[1,2,3]};  // 替换为 AI 输出中的多选题
  const items = document.querySelectorAll(".item-box");
  for (const [idx, opts] of Object.entries(answers)) {
    const item = items[parseInt(idx)];
    if (!item) continue;
    const inputs = item.querySelectorAll(".el-checkbox__input");
    if (inputs.length === 0) continue;
    for (const o of opts) {
      if (inputs[o]) { inputs[o].click(); await sleep(200); }
    }
  }
  return "multiple done";
})()'
```

**关键**：多选题必须点击 `.el-checkbox__input`（不是 `.el-checkbox`），否则只有最后一个选项生效。

### 1.8 提交

```bash
# 点击"提交"按钮
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const btns = document.querySelectorAll("button");
  for (const btn of btns) {
    if (btn.textContent.trim() === "提交") { btn.click(); return "submitted"; }
  }
  return "submit button not found";
})()'
```

等待约 1.5s 后点击确认对话框：

```bash
# 点击确认弹窗的"确定"按钮 — 索引 [0]=关闭X, [1]=取消, [2]=确定
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const dlg = document.querySelector(".el-message-box");
  if (!dlg) return "no dialog";
  const btns = dlg.querySelectorAll("button");
  if (btns[2]) { btns[2].click(); return "confirmed"; }
  return "confirm button not found";
})()'
```

提交成功后页面自动返回列表。若需要做多个作业/测验，回到 1.3 重新扫描。

---

## 二、自动刷学习资料（文档类）

### 2.1 切换到学习资料 Tab

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const tabs = document.querySelectorAll(".tabItem");
  for (const t of tabs) {
    if (t.textContent.trim() === "学习资料") { t.click(); return "clicked"; }
  }
  return "tab not found";
})()'
```

### 2.2 列出所有资料及状态

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const YI_WAN_CHENG = [24050,23436,25104];
  const WEI_XUE_XI = [26410,23398,20064];
  function getStatus(item) {
    const spans = item.querySelectorAll("span");
    const t = spans[spans.length-1]?.textContent || "";
    const chars = Array.from(t).filter(c => c.charCodeAt(0) > 255);
    if (chars.length === 3 && chars.every((c,i) => c.charCodeAt(0) === YI_WAN_CHENG[i])) return "done";
    if (chars.length === 3 && chars.every((c,i) => c.charCodeAt(0) === WEI_XUE_XI[i])) return "todo";
    return "unknown";
  }
  const items = document.querySelectorAll(".resItem");
  return Array.from(items).map((item, i) => ({
    index: i,
    fileName: item.querySelector(".file-name__span")?.textContent?.trim(),
    status: getStatus(item)
  }));
})()'
```

### 2.3 并行打开未完成的文档资料

每次最多同时打开 3 个文档 tab，等待 35 秒后批量关闭，再开下一批。这比串行快 2-3 倍：

```bash
# 点击第 N 个资料的"去学习"按钮
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
document.querySelectorAll(".el-button--primary.el-button--small")[INDEX].click()'
```

操作流程：
1. 从 2.2 结果中筛选 `status: "todo"` 的条目
2. 取前 3 个（或剩余全部），依次点击"去学习"，每次间隔 1s
3. 每次点击后等 3s，curl targets 获取新开 tab 的 targetId
4. 全部打开后 sleep 35s（文档停留 30s 即标记完成，多留 5s 余量）
5. 批量关闭所有资料 tab：
```bash
curl -s --max-time 10 "http://localhost:3456/close?target=RESOURCE_TAB_ID"
```
6. 重复直到所有文档完成

### 2.4 检查完成进度

重新执行 2.2 的脚本，确认所有文档状态变为 "done"。

---

## 三、自动刷学习资料（视频类）

视频完成机制：打开视频页 → 等 HLS 加载 → 快进到末尾 → `ended` 事件触发 → 平台 API 标记完成 → 弹出完成提示。

### 3.1 打开视频资料

同 2.3，点击"去学习"按钮新开 tab。视频必须逐个处理（不能并行，因为需要等待 ended 事件）。

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
document.querySelectorAll(".el-button--primary.el-button--small")[INDEX].click()'
```

等待 3s 后 curl targets 获取新 tab 的 targetId（`VIDEO_TAB_ID`）。

### 3.2 等待视频加载并快进

HLS 流加载需要时间，必须等 `video.duration` 有值：

```bash
curl -s --max-time 30 -X POST "http://localhost:3456/eval?target=VIDEO_TAB_ID" -d '
(function() {
  const video = document.querySelector("video");
  if (!video) return { ready: false, error: "no video element" };
  if (!video.duration || isNaN(video.duration)) return { ready: false, readyState: video.readyState };
  video.currentTime = video.duration - 3;
  return { ready: true, duration: video.duration };
})()'
```

**重试策略**：若返回 `ready: false`，等待 10s 后重试。最多重试 5 次（共约 60s）。若始终无法加载，关闭该 tab 跳过，继续下一个视频。

### 3.3 等待视频结束并确认

快进后等约 5-8s，检查视频是否结束并出现完成弹窗：

```bash
curl -s --max-time 30 -X POST "http://localhost:3456/eval?target=VIDEO_TAB_ID" -d '
(function() {
  const video = document.querySelector("video");
  const msgBox = document.querySelector(".el-message-box");
  return { ended: video?.ended, hasMsgBox: !!msgBox };
})()'
```

确认 `ended: true` 且 `hasMsgBox: true` 后，关闭弹窗：

```bash
curl -s --max-time 30 -X POST "http://localhost:3456/eval?target=VIDEO_TAB_ID" -d '
(function() {
  const dlg = document.querySelector(".el-message-box");
  if (!dlg) return "no dialog";
  dlg.querySelectorAll("button")[0].click();
  return "closed";
})()'
```

若等待超过 30s 仍无完成弹窗，视为异常，直接关闭 tab 跳过。

### 3.4 关闭视频 tab 并继续

```bash
curl -s --max-time 10 "http://localhost:3456/close?target=VIDEO_TAB_ID"
```

回到课程页继续下一个未完成的视频。视频完成后列表状态可能先显示"学习中"，稍后自动更新为"已完成"，属正常延迟。

---

## 注意事项

> 详细的 DOM 选择器、charCode 映射和已知陷阱见 `references/platform.md`

- 课程页 tab 用 `.tabItem`（自定义类），不是 `.el-tabs__item`
- 学习资料在 **`学习资料` tab**，不是"导学"
- 多选题每个选项点击间隔必须 ≥ 200ms，且必须点击 `.el-checkbox__input`
- 提交后需等待约 1.5s 再点击确认对话框
- 每完成一个作业/测验后重新扫描列表（按钮顺序会变）
- 状态文字前有 ` `，不能用 `.includes()` 直接匹配，需用 charCode 过滤
