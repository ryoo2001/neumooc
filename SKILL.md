---
name: neusoft-edu
description: 东软智慧教育平台自动化：自动答题（作业/测验）+ 自动刷学习资料（文档/视频）。
---

# 东软智慧教育平台自动化

专为 neustudydl.neumooc.com 设计的自动化 skill，覆盖自动答题和自动刷学习资料两大场景。

## ⚠️ 关键约束（必须遵守）

0. **🔴 编码铁律（2026-06-01 实测，最易踩的致命坑）**：在 Windows shell → curl → CDP 这条链路上，**请求体里写的中文字面量会被编码破坏**——到浏览器变成乱码（如 `学习资料` → `ѧϰ����`，charCode 变 `65533` 替换字符），回传也一样损坏（`测试中文` → `��������`）。后果：所有 `textContent === "中文"`、`text.includes("中文")` 比较静默失败 → 切不到 tab、`去作答`/`提交`/`去学习` 按钮找不到、答题扫描误判"全部完成"而漏做。**注意区别**：从 DOM 读出来的中文（文件名、题目文本）回传完全正常，可以自由 return；坏的只是**你手写进请求体的中文字面量**。因此：
   - **请求体里需要用到的中文（比较/匹配），一律用 `String.fromCharCode(...)` 在浏览器端构造**，绝不在 curl `-d` 里直接写中文。
   - **不要用中文字面量拼接返回串**（如 `return "clicked 作业"` 会回传乱码）；返回 DOM 读到的中文没问题，要回传自己的标记就用纯 ASCII（`"clicked"` / `"not found"`）。
   - 常用中文 charCode 速查（直接用于 `String.fromCharCode(...)`）：

   | 文本 | charCode | 用途 |
   |------|----------|------|
   | 学习资料 | `23398,20064,36164,26009` | 切 tab |
   | 作业 | `20316,19994` | 切 tab |
   | 测验 | `27979,39564` | 切 tab |
   | 去作答 | `21435,20316,31572` | 答题按钮 |
   | 已作答 | `24050,20316,31572` | 状态判断 |
   | 已完成 | `24050,23436,25104` | 状态判断 |
   | 去学习 | `21435,23398,20064` | 资料按钮 |
   | 提交 | `25552,20132` | 提交按钮 |
   | 未学习 | `26410,23398,20064` | 资料状态 |
   | 学习中 | `23398,20064,20013` | 资料状态 |

   遇到表中没有的中文，先用一次 eval 取 `Array.from("...").map(c=>c.charCodeAt(0))`（在浏览器端对 DOM 文本取，不要对你发的字面量取）拿到 charCode 再用。

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

从返回列表中找到 URL 包含 `neumooc.com` 的 tab，记录其 `targetId`（后续称 `TAB_ID`）。**targetId 必须完整使用**（32 位十六进制），截断会导致 `attach 失败: No target with given id found`（2026-06-01 实测）。

### 1.2 切换到作业或测验 Tab

课程页 tab 使用自定义 `.tabItem` 类（非 `.el-tabs__item`）。**必须用 charCode 构造目标文字**（见编码铁律）：

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  // 作业=20316,19994  测验=27979,39564，按用户请求二选一
  const target = String.fromCharCode(20316,19994);
  const tabs = document.querySelectorAll(".tabItem");
  for (const t of tabs) {
    if (t.textContent.trim() === target) { t.click(); return "clicked"; }
  }
  return "tab not found";
})()'
```

### 1.3 扫描可作答项（含状态过滤）

使用 `.card_item` 扫描条目并过滤状态，只处理"未作答"的。**状态文字必须用 charCode 构造**，否则 `includes` 永远 false，会把未作答的作业误判为已完成而漏做（2026-06-01 实测确认）：

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const QU_ZUO_DA = String.fromCharCode(21435,20316,31572);     // 去作答
  const YI_ZUO_DA = String.fromCharCode(24050,20316,31572);     // 已作答
  const YI_WAN_CHENG = String.fromCharCode(24050,23436,25104);  // 已完成
  const cards = document.querySelectorAll(".card_item");
  const items = [];
  for (let i = 0; i < cards.length; i++) {
    const text = cards[i].innerText;
    const hasAnswered = text.includes(YI_ZUO_DA) || text.includes(YI_WAN_CHENG);
    const hasGoBtn = text.includes(QU_ZUO_DA);
    items.push({ index: i, name: text.split("\\n")[0], hasAnswered, hasGoBtn });
  }
  return items.filter(x => !x.hasAnswered && x.hasGoBtn);
})()'
```

`name` 是 DOM 读出的中文，回传正常。若返回空数组，说明所有作业/测验已完成，向用户报告即可。

### 1.4 进入作答页面

从上一步结果取目标条目的 index，点击其"去作答"按钮（**按钮文字用 charCode 匹配**）：

```bash
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const QU_ZUO_DA = String.fromCharCode(21435,20316,31572); // 去作答
  const card = document.querySelectorAll(".card_item")[INDEX];
  const btn = Array.from(card.querySelectorAll("button")).find(b => b.textContent.trim() === QU_ZUO_DA);
  if (btn) { btn.click(); return "entered"; }
  return "button not found";
})()'
```

**⚠️ 作业有两种类型（2026-06-01 实测）**：点"去作答"后等 4s，先做一次类型判断：
- **选择题型**：仍在课程页 URL 内，`.item-box` > 0 → 正常进入 1.5。
- **任务型作业**：`.item-box` 为 0，且 `/targets` 多出 `/taskBasedAssignmentQuestions/` 的新 tab（标题"任务型作业答题"，富文本+附件上传）。这类作业 **skill 不自动完成**——它需要真实学科作业内容且要外发提交。**关闭该新 tab 跳过，明确告知用户此作业需手动完成**，继续处理下一个选择题型条目。

```bash
# 类型判断：检查当前 tab 是否有选择题
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  return { itemBox: document.querySelectorAll(".item-box").length, url: location.href };
})()'
# 若 itemBox 为 0，curl /targets 看是否有 taskBasedAssignmentQuestions 新 tab；有则 close 跳过（用完整 targetId）
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
# 点击"提交"按钮（按钮文字用 charCode 匹配）
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const TI_JIAO = String.fromCharCode(25552,20132); // 提交
  const btns = document.querySelectorAll("button");
  for (const btn of btns) {
    if (btn.textContent.trim() === TI_JIAO) { btn.click(); return "submitted"; }
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
  const target = String.fromCharCode(23398,20064,36164,26009); // 学习资料
  const tabs = document.querySelectorAll(".tabItem");
  for (const t of tabs) {
    if (t.textContent.trim() === target) { t.click(); return "clicked"; }
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
  const XUE_XI_ZHONG = [23398,20064,20013];
  function getStatus(item) {
    const spans = item.querySelectorAll("span");
    const t = spans[spans.length-1]?.textContent || "";
    const chars = Array.from(t).filter(c => c.charCodeAt(0) > 255);
    if (chars.length === 3 && chars.every((c,i) => c.charCodeAt(0) === YI_WAN_CHENG[i])) return "done";
    if (chars.length === 3 && chars.every((c,i) => c.charCodeAt(0) === WEI_XUE_XI[i])) return "todo";
    if (chars.length === 3 && chars.every((c,i) => c.charCodeAt(0) === XUE_XI_ZHONG[i])) return "learning";
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

**核心原则（用户反馈 bug 修复 + 2026-06-01 实测）**：课程页 DOM 的状态文字只有在**页面刷新后**才反映服务器真实状态。刷课过程中反复读 DOM 会读到旧值，把已完成的资料误判为未完成而重刷。因此：
- **每轮：刷新页面 → 原子扫描+点击一批 → 等待完成 → 关闭 tab → 再刷新**，循环至刷新后无 `!done` 项。
- **原子扫描+点击**：在同一次 eval 内实时找第一个 `!done` 资料并点击，绝不"先记 index 再用旧 index 点击"（index 会漂移）。范围 `!done` = todo 未学习 + learning 学习中。
- **判断完成只信刷新后的扫描**：关 tab 后不要立刻读未刷新的 DOM 判断完成（会读旧值）。

并行度：每批最多同时打开 **5** 个文档 tab（文档只需停留，开销小）。浏览器或 proxy 卡顿时降到 3。

操作流程：

**步骤 0 — 刷新页面拿真实状态**（2.4 最终核验、断点续传重启都复用这段）：
```bash
# location.reload() 会触发导航，这条 curl 可能超时或返回空，属正常，sleep 等待即可
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d 'location.reload()'
sleep 6
# reload 后会回到默认 tab，重新点学习资料 tab（charCode 构造，TAB_ID 不变）
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function(){const target=String.fromCharCode(23398,20064,36164,26009);const ts=document.querySelectorAll(".tabItem");for(const t of ts){if(t.textContent.trim()===target){t.click();return "clicked";}}return "not found";})()'
sleep 2
```
然后执行 2.2 扫描，确认还有 `status !== "done"` 的资料（既包括 `todo` 未学习，也包括 `learning` 学习中——后者多为看了一半没触发完成，需补刷，2026-06-01 用户确认）。**只用扫描结果判断"是否还有活要干"，不要记下具体 index 跨操作复用**——见下方原子化说明。

**步骤 1 — 原子扫描+点击（关键，2026-06-01 实测修正）**：

⚠️ **index 会在页面刷新/资料完成后变化**（实测同一批 learning 视频 index 从 15,16,17 漂移到 42,45,46）。因此**绝不能"先扫描记下 index，再用旧 index 点击"**——必须在**同一次 eval 内**实时扫描并点击第一个 `!done` 的资料。列表存在重名文件（多个 `1.命题逻辑.pdf`），所以也不能用文件名。全局第 i 个 `.el-button--primary.el-button--small` 与第 i 个 `.resItem` 一一对齐（实测按钮数 = resItem 数），可靠。

文档可一次开多个（每批 5 个）：连续调用下面的"原子点击"5 次，每次它都点当前第一个 `!done` 的资料并返回刚点的文件名——你据返回值去重记账，避免同一批内重复点到同一项。

```bash
# 原子扫描+点击：实时找第一个非 done 的资料并点击（index 在 eval 内实时定位，不跨操作复用）
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const YI_WAN_CHENG = [24050,23436,25104]; // 已完成
  function isDone(item){
    const spans=item.querySelectorAll("span");
    const t=spans[spans.length-1]?.textContent||"";
    const chars=Array.from(t).filter(c=>c.charCodeAt(0)>255);
    return chars.length===3 && chars.every((c,i)=>c.charCodeAt(0)===YI_WAN_CHENG[i]);
  }
  const SKIP = window.__neuSkip || (window.__neuSkip = new Set()); // 本批已点过的 index，避免一批内重复
  const items = document.querySelectorAll(".resItem");
  const btns = document.querySelectorAll(".el-button--primary.el-button--small");
  for (let i = 0; i < items.length; i++) {
    if (!isDone(items[i]) && !SKIP.has(i)) {
      SKIP.add(i);
      btns[i].click();
      return { clickedIndex: i, fileName: items[i].querySelector(".file-name__span")?.textContent?.trim() };
    }
  }
  return "no more";
})()'
```

`fileName` 是 DOM 读出的中文，回传正常，用于记账展示。返回 `"no more"` 表示当前页面（未刷新）已无可点项。

**步骤 2 — 收尾**：
1. 每次点击后等 3s，curl targets 获取新开 tab 的 targetId
2. 一批全部打开后 sleep 35s（文档停留 30s 即标记完成，多留 5s 余量）
3. 批量关闭这批资料 tab：
```bash
curl -s --max-time 10 "http://localhost:3456/close?target=RESOURCE_TAB_ID"
```
4. **关闭整批 tab 后，必须执行步骤 0 刷新页面**，再回到步骤 1 继续。原因（2026-06-01 实测）：① 资料完成后列表要刷新才显示 `done`，不刷新会被原子扫描重新选中（尤其重名文件）；② 刷新会重置页面里的 `__neuSkip` 去重集合，正好开始新一轮。
5. 重复"步骤 1 开一批 → 步骤 2 收尾 + 刷新"，直到刷新后 2.2 扫描无 `!done` 项 → 进入 2.4 最终核验。

**断点续传**：若整个任务被打断后重启 skill，从步骤 0 开始（刷新 + 扫描）即可——因为流程本就是"刷新→原子扫描→点击"，天然幂等，已完成的 `done` 会被 `isDone` 跳过，不会重刷。无需记忆上一轮的 index。

### 2.4 检查完成进度（最终核验）

**⚠️ 用户反馈的核心 bug：核验前必须刷新页面，否则读到旧 DOM，把已完成的当成未完成又重刷一遍。**

1. 执行上面的**步骤 0**（`location.reload()` → sleep 6 → 点学习资料 tab → sleep 2）。
2. 执行 2.2 扫描。
3. 若仍有 `status !== "done"` 的资料（todo 或 learning），说明还没刷完，回到步骤 1 再刷一轮；若全部 `done`，完成。

**绝不能**用刷课过程中（未刷新页面时）读到的 DOM 状态来判定是否还需补刷。

---

## 三、自动刷学习资料（视频类）

视频完成机制：打开视频页 → 等 HLS 加载 → 快进到末尾 → `ended` 事件触发 → 平台 API 标记完成 → 弹出完成提示。

**核心原则（同 2.3，2026-06-01 全流程实测验证）**：
- **原子扫描+点击**：用 2.3 步骤 1 同款的"原子点击"脚本实时找第一个 `!done` 视频并点击，**绝不跨操作复用 index**（实测 index 会漂移）。`!done` 包含 `todo` 和 `learning`——learning 多为看了一半没触发 ended，需补刷（用户确认）。
- **每完成一批必须刷新**：视频刷完后列表要刷新才显示 `done`，不刷新原子扫描会重选刚完成的项（尤其重名文件，实测 `8_逻辑等价式.mp4` 有两份）。
- **最终核验**：刷新 + 2.2 扫描，确认无 `!done`；有残留再刷一轮。

**并行度**：视频可同时开 **3 个 tab**——每个视频在自己 tab 独立等 `ended`，互不干扰（per-video 机制已实测，批量并行为同款操作叠加）。一批开 3 个 → 各自快进 → 各自等 ended → 各自关闭 → 整批刷新。HLS 加载或快进失败的视频按重试策略单独处理，不阻塞同批其他视频。proxy 卡顿时降到逐个处理（逐个 = 每次开 1 个、完成、刷新、再开下一个，已充分实测）。

### 3.1 打开一批视频（原子扫描+点击，最多 3 个）

连续调用下面的"原子点击"最多 3 次（每次间隔 ~1s），每次实时点当前第一个 `!done` 视频。脚本用页面内 `__neuSkip` 集合避免一批内重复点同一项；中文用 charCode 比对，不进请求体；`fileName` 从 DOM 读出回传正常：

```bash
# 原子扫描+点击：找第一个非 done 资料并点击（index 在 eval 内实时定位）
curl -s --max-time 15 -X POST "http://localhost:3456/eval?target=TAB_ID" -d '
(function() {
  const YI_WAN_CHENG = [24050,23436,25104]; // 已完成
  function isDone(item){
    const spans=item.querySelectorAll("span");
    const t=spans[spans.length-1]?.textContent||"";
    const chars=Array.from(t).filter(c=>c.charCodeAt(0)>255);
    return chars.length===3 && chars.every((c,i)=>c.charCodeAt(0)===YI_WAN_CHENG[i]);
  }
  const SKIP = window.__neuSkip || (window.__neuSkip = new Set());
  const items = document.querySelectorAll(".resItem");
  const btns = document.querySelectorAll(".el-button--primary.el-button--small");
  for (let i = 0; i < items.length; i++) {
    if (!isDone(items[i]) && !SKIP.has(i)) {
      SKIP.add(i); btns[i].click();
      return { clickedIndex: i, fileName: items[i].querySelector(".file-name__span")?.textContent?.trim() };
    }
  }
  return "no more";
})()'
```

每点一个等 3s 后 `curl http://localhost:3456/targets` 获取新 tab（URL 含 `resourcesLearning`）的**完整 targetId**（勿截断），记为 `VIDEO_TAB_ID`。一批最多 3 个，下面 3.2/3.3 对每个 tab 分别执行。返回 `"no more"` 说明当前页面已无可点项，转 3.4 收尾刷新。

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

**关键收尾（2026-06-01 实测）**：这一批 tab 全部关闭后，**必须执行 2.3 步骤 0 刷新页面**（reload → 点学习资料 tab）再回到 3.1 开下一批。原因：① 视频刚刷完列表仍显示"学习中"，刷新后才变"已完成"；不刷新会被原子扫描重新选中，尤其重名文件（实测 `8_逻辑等价式.mp4` 两份）。② 刷新会重置页面内 `__neuSkip` 集合，正好开始新一批。

**循环终止条件**：刷新后 2.2 扫描无 `status !== "done"` 项。视频完成后列表状态先显示"学习中"，刷新后才更新为"已完成"，属正常延迟——以刷新后的扫描为准。

---

## 注意事项

> 详细的 DOM 选择器、charCode 映射和已知陷阱见 `references/platform.md`

- **🔴 编码铁律（见开头关键约束 0）**：请求体里绝不写中文字面量（会损坏），需要比较/匹配中文一律 `String.fromCharCode(...)` 构造；返回串不要拼中文（DOM 读出的中文可正常 return）。这是切 tab、找按钮、答题扫描失败的头号根因。
- 课程页 tab 用 `.tabItem`（自定义类），不是 `.el-tabs__item`
- 学习资料在 **`学习资料` tab**，不是"导学"
- 多选题每个选项点击间隔必须 ≥ 200ms，且必须点击 `.el-checkbox__input`
- 提交后需等待约 1.5s 再点击确认对话框
- 每完成一个作业/测验后重新扫描列表（按钮顺序会变）
- 状态文字前有 ` `，不能用 `.includes()` 直接匹配，需用 charCode 过滤
- **核验/断点续传关键（2026-06-01 修复+实测，含用户反馈 bug）**：
  - **课程页 DOM 状态只有刷新页面后才准**。最终核验、每批资料刷完后、重启续传前，必须先 `location.reload()`（步骤 0）再扫描 2.2，否则读到旧 DOM 把已完成的当未完成又重刷一遍（用户实测 bug）。
  - **原子扫描+点击**：在同一次 eval 内实时找第一个 `!done` 资料并点击，**绝不"先记 index 再用旧 index 点击"**——index 会在刷新/完成后漂移（实测从 15,16,17 → 42,45,46）。用页面内 `__neuSkip` 集合避免一批内重复点同一项，刷新会自动重置它。
  - **资料范围用 `!done`**（含 `todo` 未学习 + `learning` 学习中）。learning 多为看了一半没触发 ended，需补刷（用户确认）；`isDone` 用 charCode 判定，已完成的天然跳过，流程幂等。
  - **重名文件**：列表有同名文件（实测多个 `1.命题逻辑.pdf`、两份 `8_逻辑等价式.mp4`），所以绝不用文件名定位；原子扫描按 DOM 顺序逐个 `!done` 点击即可覆盖所有副本。
  - 第 i 个 `.el-button--primary.el-button--small` 对齐第 i 个 `.resItem`（实测可靠）。targetId 必须完整不截断。
- **并行度**：文档每批 5 个 tab、视频每批 3 个 tab；浏览器/proxy 卡顿时各降一档（文档 3 / 视频逐个）。平台无严格审计，但仍以稳定优先，不要无上限开 tab。
- **任务型作业不自动做**：点"去作答"若新开 `taskBasedAssignmentQuestions` tab（富文本+附件，无 `.item-box`），关闭跳过并提示用户手动完成（需真实作业内容且外发提交）。
