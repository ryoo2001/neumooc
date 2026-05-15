---
name: neusoft-edu
description: 东软智慧教育平台（neustudydl.neumooc.com）自动化操作 skill。用于自动答题（作业/测验）和自动刷学习资料（文档类停留即完成）。触发场景：用户提到"东软"、"neumoc"、"neumooc"、"做作业"、"做测验"、"刷学习资料"、"自动答题"、"刷课"等关键词时必须使用此 skill。即使用户只说"帮我做作业"而未明确提到平台，只要当前工作目录或上下文与东软教育平台相关，也应触发此 skill。
---

# 东软智慧教育平台自动化

专为 neustudydl.neumooc.com 设计的自动化操作 skill，覆盖自动答题和自动刷学习资料两大场景。

## 前置准备

本 skill 依赖 [web-access](https://github.com/eze-is/web-access) skill 的 CDP 基础设施。操作前必须：

```bash
node "{SKILL_DIR}/scripts/check-deps.mjs"
```

> `{SKILL_DIR}` 为本 skill 的安装目录（系统自动注入，通常为 `~/.agents/skills/neusoft-edu`）。  
> 脚本会自动定位 web-access，若未安装会给出安装提示。

确认 Node.js 22+ 和 Chrome 远程调试已就绪，CDP Proxy 已连接（端口 3456）。

**平台详细参考**：读取 `references/platform.md` 获取已验证的 DOM 选择器和 JS 代码片段。

**用户前提**：用户已在 Chrome 中打开课程详情页（URL 形如 `neustudydl.neumooc.com/...`）。

---

## 一、自动答题

### 1.1 找到课程页 Tab

```bash
curl -s http://localhost:3456/targets
```

从返回列表中找到 URL 包含 `neumoc.com` 的 tab，记录其 `targetId`（后续称 `TAB_ID`）。

### 1.2 切换到作业或测验 Tab

根据用户请求决定操作哪个 tab：
- 用户说"做作业" → 点击"作业" tab 标签
- 用户说"做测验" → 点击"测验" tab 标签

```bash
# 点击对应 tab 标签（按文本匹配）
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const tabs = document.querySelectorAll(".el-tabs__item");
  for (const t of tabs) {
    if (t.textContent.trim() === "作业") { t.click(); return "clicked 作业"; }
  }
  return "tab not found";
})()'
```

将 `"作业"` 替换为 `"测验"` 即可切换目标。

### 1.3 列出可作答项

```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const btns = document.querySelectorAll("button");
  const list = [];
  for (let i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === "去作答") list.push(i);
  }
  return list;
})()'
```

返回所有"去作答"按钮的索引列表。默认操作第一个（`list[0]`），若用户指定"第X个"则取 `list[X-1]`。

### 1.4 进入作答页面

```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
document.querySelectorAll("button")[INDEX].click()'
```

将 `INDEX` 替换为上一步得到的按钮索引。

### 1.5 提取全部题目

```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const items = document.querySelectorAll(".item-box");
  const result = [];
  items.forEach((item, i) => {
    result.push({ index: i, text: item.innerText.trim() });
  });
  return result;
})()'
```

将返回的题目列表发给 Claude 分析，由 AI 判断每题答案（格式：`{ 题目索引: 选项索引 }`，选项索引 0=A, 1=B, 2=C, 3=D）。

### 1.6 批量作答

AI 分析完成后，根据题型分别处理：

**单选题 / 判断题**（`.el-radio`）：
```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const answers = {0:2, 1:0, 2:1};  // 替换为 AI 给出的答案
  const items = document.querySelectorAll(".item-box");
  for (let i = 0; i < items.length; i++) {
    if (answers[i] === undefined) continue;
    const radios = items[i].querySelectorAll(".el-radio");
    if (radios[answers[i]]) radios[answers[i]].click();
  }
  return "done";
})()'
```

**多选题**（`.el-checkbox__input`，必须加 200ms 延迟）：
```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(async function() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const item = document.querySelectorAll(".item-box")[ITEM_INDEX];
  const inputs = item.querySelectorAll(".el-checkbox__input");
  const selected = [0, 2];  // 替换为要选的选项索引
  for (const idx of selected) {
    if (inputs[idx]) { inputs[idx].click(); await sleep(200); }
  }
  return "done";
})()'
```

**注意**：多选题不能点击 `.el-checkbox`（外层 label），必须点击 `.el-checkbox__input`，否则只有最后一个选项生效。

### 1.7 提交

```bash
# 第一步：点击"提交"按钮
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const btns = document.querySelectorAll("button");
  for (let i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === "提交") { btns[i].click(); return i; }
  }
  return "not found";
})()'

# 等待约 1.5s 后点击确认对话框
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
document.querySelector(".el-message-box").querySelectorAll("button")[2].click()'
```

提交成功后页面自动返回列表，"去作答"按钮变为"详情"，进度条变绿。

---

## 二、自动刷学习资料（文档类）

学习资料在课程详情页的 **`学习资料` tab** 下，不是"导学"。

### 2.1 切换到学习资料 Tab

课程页 tab 使用自定义 `.tabItem` 类（非 `.el-tabs__item`）：

```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const tabs = document.querySelectorAll(".tabItem");
  for (const t of tabs) {
    if (t.textContent.trim() === "学习资料") { t.click(); return "clicked"; }
  }
  return "tab not found";
})()'
```

### 2.2 列出所有资料

```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const items = document.querySelectorAll(".resItem");
  return Array.from(items).map((item, i) => {
    const spans = item.querySelectorAll("span");
    const last = spans[spans.length - 1];
    // 状态文字前有  ，需过滤非 ASCII
    const status = Array.from(last?.textContent || "").filter(c => c.charCodeAt(0) > 255).join("");
    return {
      index: i,
      fileName: item.querySelector(".file-name__span")?.textContent?.trim(),
      status  // "已完成" | "未学习"
    };
  });
})()'
```

### 2.3 依次打开未完成的文档资料

每次点击"去学习"会**新开一个 tab**（URL: `/resourcesLearning/index/...`），停留约 30 秒后系统自动标记已完成，无需任何操作。

```bash
# 点击第 N 个资料的"去学习"按钮（按 .resItem 索引）
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
document.querySelectorAll(".el-button--primary.el-button--small")[INDEX].click()'
```

等待约 30 秒后关闭该 tab，再点击下一个：

```bash
# 关闭资料 tab
curl -s "http://localhost:3456/close?target=RESOURCE_TAB_ID"
```

### 2.4 检查完成进度

```bash
curl -s -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const YI_WAN_CHENG = [24050,23436,25104];  // 已完成
  const WEI_XUE_XI   = [26410,23398,20064];  // 未学习
  function match(t, codes) {
    const chars = Array.from(t).filter(c => c.charCodeAt(0) > 255);
    return chars.length === codes.length && chars.every((c,i) => c.charCodeAt(0) === codes[i]);
  }
  const items = document.querySelectorAll(".resItem");
  let done = 0, todo = 0;
  for (const item of items) {
    const spans = item.querySelectorAll("span");
    const t = spans[spans.length-1]?.textContent || "";
    if (match(t, YI_WAN_CHENG)) done++;
    else if (match(t, WEI_XUE_XI)) todo++;
  }
  return { total: items.length, done, todo };
})()'
```

> **注意**：视频类资料（.mp4）的完成机制尚未验证，暂不处理，跳过即可。

---

## 注意事项

- 课程页 tab 切换用 `.tabItem`（自定义类），不是 `.el-tabs__item`
- 学习资料在 **`学习资料` tab**，不是"导学"
- 点击"去学习"会新开 tab，URL 格式：`/resourcesLearning/index/...`
- 文档类资料（.docx/.pdf）：停留约 30 秒自动标记已完成，无需任何操作
- 视频类资料（.mp4）：完成机制未验证，暂跳过
- 状态文字前有 ` `（非断行空格），不能用 `.trim()` 或 `includes()` 直接匹配，需过滤 charCode > 255 的字符后比较
- `textContent.trim() === "确定"` 在 eval 中可能因编码问题匹配失败，改用按钮索引 `[2]` 更稳定
- 多选题每个选项点击间隔必须 ≥ 200ms
- 提交后需等待约 1-1.5s 再点击确认对话框
- 详细的 DOM 选择器和已验证代码见 `references/platform.md`

