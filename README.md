# neusoft-edu

东软智慧教育平台（neustudydl.neumooc.com）自动化 skill，适用于 [Kiro](https://kiro.dev) / Claude Code。

覆盖三大场景：**自动答题**（作业 / 测验）、**自动刷文档资料**（停留即完成）和**自动刷视频资料**（快进到末尾触发完成）。

---

## 功能

| 功能 | 说明 |
|------|------|
| 自动答题 | 提取全部题目，AI 自动判断答案，批量作答并提交 |
| 自动刷文档资料 | 依次打开文档资料，停留约 30 秒系统自动标记已完成 |
| 自动刷视频资料 | 打开视频页面，快进到末尾触发平台完成逻辑，每个约 20-30 秒 |

---

## 安装

### 第一步：安装 web-access skill（依赖）

本 skill 依赖 [web-access](https://github.com/eze-is/web-access) 提供 CDP 浏览器自动化能力。

```bash
git clone https://github.com/eze-is/web-access.git ~/.agents/skills/web-access
```

### 第二步：安装本 skill

```bash
git clone https://github.com/ryoo2001/neumooc.git ~/.agents/skills/neusoft-edu
```

### 第三步：开启 Chrome 远程调试

在 Chrome 地址栏打开：

```
chrome://inspect/#remote-debugging
```

勾选 **"Allow remote debugging for this browser instance"**，可能需要重启浏览器。

### 第四步：验证安装

```bash
node ~/.agents/skills/neusoft-edu/scripts/check-deps.mjs
```

看到 `proxy: ready` 即表示一切就绪。

---

## 使用方式

在 Kiro / Claude Code 中直接用自然语言触发，**无需手动加载 skill**：

```
帮我做东软的作业
帮我做第一个测验
帮我刷学习资料
```

skill 会自动：
1. 检查 CDP 连接
2. 找到已打开的课程页 tab
3. 切换到对应模块执行操作

---

## 前置条件

- Node.js 22+（[下载](https://nodejs.org)）
- Chrome 浏览器，已开启远程调试（见第三步）
- 已在 Chrome 中打开课程详情页并登录

---

## 文件结构

```
neusoft-edu/
├── .claude-plugin/
│   ├── plugin.json           # 插件元数据
│   └── marketplace.json      # 市场描述
├── scripts/
│   └── check-deps.mjs        # 前置检查（自动发现 web-access）
├── references/
│   └── platform.md           # 平台 DOM 结构、已验证选择器、已知陷阱
├── SKILL.md                  # skill 主体（AI 执行指令）
└── README.md                 # 本文件
```

---

## 平台关键信息

| 要素 | 值 |
|------|----|
| 域名 | `neustudydl.neumooc.com` |
| 框架 | Element UI (Vue2) + Vue3 组件 |
| 课程 Tab 选择器 | `.tabItem`（非 `.el-tabs__item`） |
| 题目容器 | `.item-box` |
| 单选/判断 | `.el-radio` |
| 多选（必须） | `.el-checkbox__input`（间隔 ≥ 200ms） |
| 提交确认 | `.el-message-box button[2]`（charCode 匹配不稳定） |
| 学习资料条目 | `.resItem` / `.file-name__span` |
| 去学习按钮 | `.el-button--primary.el-button--small` |
| 文档完成方式 | 打开后停留 ~30s，系统自动标记 |
| 视频完成方式 | 快进到末尾（`video.currentTime = duration - 3`），触发 `ended` 事件 |

详细选择器和代码片段见 [`references/platform.md`](references/platform.md)。

---

## 已知陷阱

- 状态文字前有 ` `（非断行空格），不能用 `.trim()` / `includes()` 匹配，需过滤 charCode > 255
- 多选题必须点击 `.el-checkbox__input`，点外层 `.el-checkbox` 只有最后一个选项生效
- `"确定"` 文本在 eval 中可能因编码失败，改用按钮索引 `[2]`
- 点击"去学习"会新开 tab，不是弹窗
- 视频 HLS 流加载慢（土豆服务器），超时 60 秒后跳过，不卡流程
- 视频完成后状态先变"学习中"，稍后自动更新为"已完成"

---

## License

MIT
