---
name: yuketang-tewen-browse
description: 雨课堂/学堂在线系（如 xidianyjs.yuketang.cn）批量任务工具集。任务一：把课程里的「图文」逐个点开停留 N 秒刷学习记录；任务二：把课程里「未发言」的讨论逐个进入，随机复制评论区一条评论作为本人观点发表；任务三：在「测试题/习题」页读题作答并交卷（含字体混淆、Vuex 切题、拖动验证码、iframe 内提交等坑）；任务四：把测试题导成题库（破解字体混淆，还原题干与选项文字，输出 xlsx/md）。触发词：雨课堂、图文任务、未完成图文、批量浏览课程内容、讨论区发言、刷讨论、课程待办清零、测试题、习题、做题、答题、交卷、题库、导出题目、整理题库、复习资料、题干乱码。
agent_created: true
---

# 雨课堂批量任务（图文 / 讨论 / 习题 / 题库）

## 何时用

在一个**已登录**的雨课堂站点（研究生版 `/pro`）上批量处理课程任务。四个任务共用同一套底座，按需取用：

| 任务 | 用户说法 | 入口 |
|---|---|---|
| 一 图文浏览 | 把未完成图文刷掉、待办清零 | `/studycontent` 目录 |
| 二 讨论发言 | 把未发言的讨论发掉 | 同上，筛「未发言」 |
| 三 习题作答 | 把某几周测试题做了、交卷 | `/exercise/<id>` |
| 四 题库导出 | 把题目导成文字、做复习资料 | 任务三的页面 + 字体破解 |

> 任务四**复用任务三的全部页面知识与切题方法**，只是把「读题作答」换成「把 `content.Body` 存下来」。两者不可分割。

## 前置：拿到一个可调试的浏览器

1. 自动化只能走 CDP，且**新版 Edge/Chrome 禁止在默认 user-data-dir 上开调试端口**：
   `msedge.exe --user-data-dir=<临时目录> --remote-debugging-port=9222 --remote-allow-origins=*`
2. 复制默认配置到临时目录**不会带登录态**（Cookie 应用绑定加密，路径变了解不开）。
   让用户在弹窗里扫码登录一次，profile 留在临时目录可长期复用。
3. Windows 上 GUI 子进程会随工具调用结束被回收：必须用**常驻后台 Node 进程**持有浏览器
   （launch 后 sleep 循环），并保证至少留 1 个 page target（全关掉浏览器会退出）。
   不要反复 shutdown/restart，用户会看到「一直闪退」。
4. **路径含空格时必须用参数数组，不要拼 shell 字符串。**
   工作区常叫 `D:\workbuddy data\...`，写成字符串会被空白切分：profile 变成 `D:\workbuddy`（安装目录），
   剩下 `data\x\.profile` 当 URL 解析 → 长出一整套 Chromium 档案，触发 WorkBuddy 的 install-dir-guard，
   用户会一直收到「无法安装必要的更新」。用 `spawn(cmd, [args])`。`launch-edge.mjs` 已内置该 guard。
5. `curl` 走代理连不上 `127.0.0.1`，用 `curl --noproxy '*'` 或 Node 的 `fetch`。

```bash
node scripts/launch-edge.mjs                                          # 起浏览器并常驻，首次扫码登录（profile 存 .yb-profile/）
SITE=https://xidianyjs.yuketang.cn node scripts/collect-courses.mjs   # 生成 out/courses.json
```

`launch-edge.mjs` 自动探测 Edge/Chrome 路径，支持 `BROWSER_PATH` / `PROFILE_DIR` / `PORT` / `START_URL` 覆盖。

## CDP 客户端

`scripts/cdp.mjs`（无依赖，Node 22 内置 fetch + WebSocket）。导出：
`sleep / listTargets / listPages / closeTarget / connectPage(match?) / evalJs / waitReady / navigate / screenshot`。

`connectPage('forum/')` 按 URL 子串选 tab —— 雨课堂每个任务都新开 tab，这是整套流程的关键。
页面选择器与 Vuex 结构见 `references/page-structure.md`。

## 任务一：图文浏览

1. 逐课进入 `/studycontent`，等目录渲染（**≥ 3s**；SPA 慢，别用固定 1s 判断为空）。
2. 收集 `icon--tuwen` 条目；已完成的不会出现在未完成列表里，天然跳过。
3. 逐条：`scrollIntoView` → `click` → 等新 tab → 停留 N 秒（默认 2000ms）→ `Target.closeTarget` 关掉 → 下一条。
4. 每张写一行 JSONL；一课程做完再切下一门。
5. 统计口径：**需浏览 = 已完成记录数 + 当前剩余**，剩余恒为 0 才算跑完。

## 任务二：讨论发言

```bash
DISC_OUT=./out MY_NAME=你的昵称 ONLY=0,3 node scripts/discussion.mjs
```

`MY_NAME` 必填（「是否已有我的发言」防护，不填会重复发表）；`ONLY` 课程下标；`MAX` 每门课尝试次数上限。

1. 收集 `.leaf-detail`（**带 DOM 索引**）→ 筛「未发言」→ 按索引点击 → `connectPage('forum/')`
2. 读题目 `.main-text-attachment`、评论区 `.comment-text`，过滤过短评论（< 60 字）
3. **防御**：评论区已有本人昵称 → 其实已完成，跳过
4. 随机填一条评论 → 点 `.prompt-send-btn` → 成功判据：toast 出现 **且**输入框被清空
5. 关 tab → reload 目录页 → 重新收集 → 循环

**两个会导致重复发表的坑**：

- **同名讨论题**：每章都有「讨论题1」，按标题 `find` 永远命中第一条。必须用 `.leaf-detail` 的 DOM 索引，去重表也用索引当 key。
- **状态不自动刷新**：SPA 内「未发言 → 已发言」不变，不 reload 会死循环重复发。

输入框是 Vue `v-model`，要原生 setter + `dispatchEvent('input')`；虚拟列表恒定只渲染 10 条，不能数条数判断。
误发清理、`.del` 选择器、纯文本兜底判断见 `references/discussion.md`。

## 任务三：习题作答 + 交卷

题干有**字体反爬**：`span.xuetangx-com-encrypted-font`，DOM 存随机汉字、字体重绘真字形。
**复制粘贴拿到的是乱码，肉眼读题必须截图；要批量导出成文字则走任务四。**
机制与解法见 `font-obfuscation-decode` 技能，本站点参数见 `references/font-deobfuscation.md`。

### 关键坑

1. **侧栏 / 「下一题」点了不换题**：被 `ProblemChangeGuard` 静默拦掉（事件到了、就是不动）。
   → 直接走 Vuex：`t.$store.dispatch('cloud/setProblem', ...)`，`t` 的找法见 `references/page-structure.md`。
2. **选项必须用真实鼠标事件**（CDP `Input.dispatchMouseEvent`），`el.click()` 状态易被回滚。
   坐标取 `getBoundingClientRect()` 中心，注意是 **CSS px**（本机 DPR=1.5，别拿截图像素当坐标）。
3. 交卷后按钮变「已提交」，**没有重做入口**，提交前一定确认每题都答了。
4. **提交必弹拖动式「请完成安全校验」**（起→1→2→3→终），每套卷一次，不解就交不上。
   流程与参数见 `references/captcha-shadow.md`。
5. **弹窗按钮是 `div.rain-btn.pointer`，不是 `<button>`**；**弹窗出现时 iframe rect 会谎报成 (0,0,整窗)**。
   两件事都在 `references/captcha-shadow.md`。
6. 换卷入口在父页左侧目录 `.leaf-item-title`。目录项在视口外时先 `scrollIntoView({block:'center'})` 再测量。

### 流程

1. 复用已登录 profile 起浏览器，打开父页 exercise URL。
2. 截图逐题读题（点 `.subject-item` 失效就直接 `cloud/setProblem` 切题）。
3. 逐题作答：切题 → 真实鼠标点选项 → 校验 `problems[i]._answer` 与 `_submitStatus === true`。
   一次不中要重试（首次批量跑必有一两题坐标错位漏点）。
4. 交卷：`iframe.contentDocument` 里点「提交」→「帮我提交」→ 过安全校验 → 等 `.el-message` 出现「提交成功」。
5. 结果核对：逐题切题读「本题得分：x」/「正确答案：X」累加（`problems[i].score` 提交后不一定刷新，别依赖）。

> 更省事的跑法（实测 10 题一次过）：**全程待在父页**，用
> `document.querySelector('iframe').contentDocument.querySelector('#app').__vue__` 直接操作 iframe 内 store ——
> 切题、读 `_answer`、按同一次 eval 取的 iframe rect 派发 CDP 点击。答完同一页就能交卷，
> 截图用 `Page.captureScreenshot` 的 `clip` 裁到 iframe 区域。

## 任务四：题库导出

> 要的不是「答对」，而是把题目本身导成文字。

**字体解码的算法已抽成独立技能 `font-obfuscation-decode`**（`~/.workbuddy/skills/font-obfuscation-decode/`）。
本站点只做「采集」和「出库」两件事，中间的解码交给通用技能：

```bash
SKILL=~/.workbuddy/skills/font-obfuscation-decode/scripts
export YUKETANG_BASE=$(pwd)          # 采集/解码/出库都读它，也可以逐条传 --base
```

1. **采集（必须同时记字体）**：`node scripts/collect.mjs` —— 点目录打开每套卷 → **立刻**读 `@font-face` 的 `src` 存进 `fontSrc`
   （每套卷是独立随机字体，采集完再回头找是找不到的）→ 逐题抓 `content.Body` / `Options` / `Type` / `Score` / 正确答案。
   产物 `collector.json`。
2. **解映射**：`python $SKILL/probe.py <ttf>` 找同源字体 → `python $SKILL/solve.py --target <ttf> --candidate <参照字体> --out font`
   → 产物 `font/map_<key>.json`。
3. **解码 + 出库**：`python scripts/build_bank2.py`（只解 `span` 内部字符，span 外原样保留，产物 `题库_初稿.json`）
   → `python scripts/make_bank.py --name 课程名_测试题库 --course "2026 秋 · 某某课"`（产物 `<name>.xlsx` / `.md` / `.json`）。

> `--name` 决定输出文件名，不传就是 `测试题库.*`；`--course` / `--source` 只影响 xlsx「说明」页。
> 脚本里没有课程名、试卷名之类的站点数据硬编码，换课程直接重跑三步即可。

本站点参数（span class、882 码位、参照字体 `NotoSansSC-VF`、avgSim 基准）见
`references/font-deobfuscation.md`；解码原理与调参见通用技能的 `SKILL.md` 与 `references/algorithm.md`。

**必做校验**：用 `$SKILL/verify.py` 做双映射交叉比对；**原文疑误不要擅自改**，加「备注」列说明，不替出题人改字。

## 坑位速查

| 现象 | 原因 | 解法 |
|---|---|---|
| 点题号/下一题没反应 | `ProblemChangeGuard` 拦截 | 走 `cloud/setProblem` |
| 弹窗按钮点不到 | 是 `div.rain-btn` 不是 button | 按 `textContent` 找外层 div |
| 点选项位置偏 | 弹窗时 iframe rect 报 (0,0,整窗) | 同一次 eval 里取两个 rect 相加 |
| 交卷卡在安全校验 | shadowRoot 里的 canvas | 像素聚簇 + 真实拖拽 |
| 复制题干是乱码 | 字体反爬 | 截图读 / 解字体映射 |
| 同一讨论被重复发 | 按标题匹配命中了第一条 | 用 DOM 索引 |
| 评论数不变以为失败 | 虚拟列表恒定 10 条 | 看 toast + 输入框清空 |

## 参考文档

| 文件 | 内容 |
|---|---|
| `references/page-structure.md` | DOM 选择器全量清单、Vuex 结构 |
| `references/discussion.md` | 讨论任务的判断逻辑、误发清理、Vue 输入框 |
| `references/font-deobfuscation.md` | 题库导出的站点参数（算法见 `font-obfuscation-decode` 技能） |
| `references/captcha-shadow.md` | 拖动验证码、坐标陷阱、DPR |

只在需要时读。日常跑任务读主文件即可。

> 字体解码属于通用能力，已独立为 `font-obfuscation-decode` 技能，本技能不重复实现。
> 走任务四之前先确认那个技能可用。

## 注意

- 关标签前后对比 target id 集合，别误关目录页；每次循环重新收集，别缓存旧 DOM。
- 生成报告时把「无未完成项」和「老师未发布内容」区分开，避免被当成漏跑。
- 发言内容来自评论区他人原文，属于用户明确要求的操作；若要求"不要太雷同"，取一条后加一句自己的话。
