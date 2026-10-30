---
name: yuketang-tewen-browse
description: 雨课堂/学堂在线系（如 xidianyjs.yuketang.cn）批量任务工具集。任务一：把课程里的「图文」逐个点开停留 N 秒刷学习记录；任务二：把课程里「未发言」的讨论逐个进入，随机复制评论区一条评论作为本人观点发表。触发词：雨课堂、图文任务、未完成图文、批量浏览课程内容、讨论区发言、刷讨论、课程待办清零。
agent_created: true
---

# 雨课堂批量任务（图文浏览 / 讨论发言）

## 何时用

在一个**已登录**的雨课堂站点（研究生版 `/pro`）上批量处理两类课程任务：

1. **图文浏览**：把多门课里的「图文」挨个打开、停留 N 秒，消除未完成。
2. **讨论发言**：把每门课里「未发言」的讨论逐个进入，随机复制评论区一条已有评论，粘贴发布为自己的观点。

## 前置：拿到一个可调试的浏览器

1. 自动化只能通过 CDP 接入，且**新版 Edge/Chrome 禁止在默认 user-data-dir 上开调试端口**。
2. 因此必须：`msedge.exe --user-data-dir=<临时目录> --remote-debugging-port=9222 --remote-allow-origins=*`。
3. 复制用户默认配置到临时目录**不会带登录态**（Cookie 是应用绑定加密，路径变了解不开）。让用户在弹窗里扫码/登录一次，profile 留在临时目录可长期复用。
4. Windows 上 GUI 子进程会随工具调用结束被回收：必须用**常驻后台 Node 进程**持有浏览器（launch 后 sleep 循环），并保证至少保留 1 个 page target，把 page 全关掉浏览器会退出。
5. 不要反复 shutdown/restart 浏览器——用户会看到「一直闪退」。
6. `curl` 走代理会连不上 127.0.0.1，用 `curl --noproxy '*'` 或 Node 的 `fetch`。

### 现成脚本（优先用，别重复造）

```bash
node scripts/launch-edge.mjs          # 起浏览器并常驻；首次在窗口里扫码登录（profile 存 .yb-profile/）
SITE=https://xidianyjs.yuketang.cn node scripts/collect-courses.mjs   # 生成 out/courses.json
```

`launch-edge.mjs` 会自动探测 Edge/Chrome 路径，支持 `BROWSER_PATH` / `PROFILE_DIR` / `PORT` / `START_URL` 覆盖。

## CDP 客户端

`scripts/cdp.mjs`（无依赖，Node 22 内置 fetch + WebSocket）。导出：
`sleep / listTargets / listPages / closeTarget / connectPage(match?) / evalJs / waitReady / navigate / screenshot`。
`connectPage('forum/')` 按 URL 子串选 tab，是这套流程的关键——雨课堂每个任务都新开一个 tab。

## 页面结构（雨课堂研究生版 /pro）

- 课程列表：`/pro/courselist`，卡片 `.lesson-cardS`（会重复匹配，按名字去重）
- 课程内页：`/pro/lms/<cid>/<rid>/studycontent`（目录）、`/unfinished`（待办列表）
- **目录条目**：`.leaf-detail`，首行是条目名（如「第一讲 讨论1」），类型靠图标 class：`icon--tuwen` / `icon--shipin` / `icon--zhibo`，讨论条目文本内含「未发言」「已发言」
- 待办列表行：`.unfinished-study__item`，首行是类型（图文/视频/讨论/作业/直播），标题在 `.unfinished-study__item-title`
- 点击目录条目 → **新开 tab**：
  - 图文/视频：`/ai-workspace/lms-graph/<rid>/...`
  - 讨论：`/ai-workspace/lms-graph/<rid>/forum/<forumId>?fromProIframe=1...`
- 讨论页 DOM：
  - 题目：`.main-text-attachment`
  - 现有评论正文：`.comment-text`（一条一个，前面是 `.comment-header` 昵称时间）
  - 输入框：`textarea.el-textarea__inner`（placeholder「发表你的观点...」）
  - 发送按钮：`.prompt-send-btn`，空内容时带 `disabled` class
- 空课程：显示「老师没有发布学习内容」，「全部待办 0」「已完成学习单元 0/--」

## 任务一：图文浏览

1. 逐课进入 `/studycontent`，等目录渲染（≥3s；SPA 慢，别用固定 1s 判断为空）。
2. 收集 `icon--tuwen` 条目；已完成的不会出现在未完成列表里，天然跳过。
3. 逐条：`scrollIntoView` → `click` → 等新 tab 出现 → 停留 N 秒（默认 2000ms）→ `Target.closeTarget` 关掉（等价「退回上一页」）→ 下一条。
4. 每张写一条 JSONL 记录；一课程做完再切下一门。
5. 统计口径：**需浏览 = 已完成记录数 + 当前剩余**，剩余恒为 0 才算跑完。

## 任务二：讨论发言（scripts/discussion.mjs）

```bash
# 课程清单 out/courses.json: [{name, cid, rid}]
DISC_OUT=./out MY_NAME=你的昵称 ONLY=0,3 node scripts/discussion.mjs
```

`MY_NAME` 必填（用于「该讨论是否已有我的发言」防护，不填会重复发表）；`ONLY` 是课程下标，不填跑全部；`MAX` 控制每门课最多尝试次数。

流程（脚本已实现，改逻辑前先读一遍）：

1. 打开 `/studycontent`，收集 `.leaf-detail`，**带 DOM 索引**，筛出状态含「未发言」的讨论条目（已发言直接跳过，不要重复进）。
2. 按**索引**点击条目（见下方致命坑），等 `/forum/` 新 tab → `connectPage('forum/')`。
3. 读 `.main-text-attachment` 得题目，读全部 `.comment-text` 得现有评论；过滤掉过短的（默认 <60 字）。
4. **防御**：若评论区已有本人昵称（`.comment-header` 首行），说明其实已完成，直接跳过不再发。
5. 随机取一条评论，填 `textarea.el-textarea__inner`（Vue v-model 必须用原生 setter + `dispatchEvent(new Event('input',{bubbles:true}))`，直接赋值 `ta.value=` 不生效，发送按钮一直 disabled）。
6. 点 `.prompt-send-btn`；成功判据：`textarea.value.length === 0` **且** 出现「评论成功」提示（或同文本评论数 ≥2）。**不要**用评论条数比较——虚拟列表恒定只渲染 10 条。
7. 关 tab → 重新 `location.reload()` 目录页 → 再收集 → 循环。

### 致命坑（实测踩过）

- **不同讲次里常有同名讨论题**（如每章都有「讨论题」「讨论题1」「讨论题2」）。按标题 `find` 点击会一直命中第一条，导致把内容重复发进同一个已完成的讨论。**必须用 `.leaf-detail` 的 DOM 索引定位**，索引在 reload 后保持稳定。同理 `tried` 去重表也要用索引当 key，不能用标题。
- 讨论数（如「讨论区 920」）与列表条数都不可靠，唯一可信信号是「评论成功」toast + 输入框被清空。
- 状态刷新必须 reload，SPA 内不会自动更新「未发言→已发言」，不刷新会陷入死循环重复发。

### 误发后如何清理

本人评论的 `.del` 是 hover 才显示（`display:none`），但 Vue 事件已绑定，直接 `del.click()` 即可；随后 `.el-message-box` 里点「确定」。
只对**本人** `.forum-item` 内的 `.del` 操作——其他人的 items 里也有同名 `.del`，误点就是删别人的发言。

## 注意

- 关标签前后对比 target id 集合，别误关目录页；每次循环重新收集，别缓存旧 DOM。
- 讨论页有时会加载出 `turing.captcha.gtimg.com` 的隐藏 iframe，正常现象，不影响发送。
- 发言内容来自评论区他人原文，属于用户明确要求的操作；若用户要求"不要太雷同"，改为取一条后加一句自己的话。
- 生成报告时把「无未完成项」和「老师未发布内容」区分开，避免被当成漏跑。
