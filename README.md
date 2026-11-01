# 雨课堂批量任务助手

一个 [WorkBuddy](https://www.workbuddy.cn) 技能（Skill），用于在**已登录**的雨课堂 / 学堂在线（研究生版 `/pro`）站点上批量处理课程任务：

| 任务 | 做什么 |
|---|---|
| **图文浏览** | 把课程里未完成的「图文」逐个点开、停留 N 秒，消除未完成记录 |
| **讨论发言** | 把「未发言」的讨论逐个进入，随机复制评论区一条已有评论，发表为自己的观点 |
| **习题作答** | 在「测试题 / 习题」页读题作答并交卷，含拖动式安全校验的自动通过 |
| **题库导出** | 破解题干的字体混淆，把题干与选项还原成正常文字，导出 xlsx / md / json |

适用于 `xidianyjs.yuketang.cn` 这类使用雨课堂 `/pro` 前端的站点。其他学校若前端一致，把 `SITE` 换成自己的域名即可。

> 全部流程通过 CDP（Chrome DevTools Protocol）驱动真实浏览器，**不使用任何私有接口、不模拟登录**。脚本不含任何账号凭据。

---

## 特性

- **零依赖**：只用 Node.js 22+ 内置的 `fetch` / `WebSocket`，不需要 puppeteer、playwright
- **只做未完成**：状态为「已发言 / 已完成」的条目自动跳过，不会重复进入
- **幂等防护**：同名讨论题按 DOM 索引定位；发表前检查评论区是否已有本人昵称，避免重复发言
- **单标签页**：每个任务用完即关，全程只保留 1 个页面，不会开出一堆标签
- **逐条留痕**：每次浏览 / 发言都写 JSONL 记录，方便事后统计与复核
- **题库 100% 还原**：字体解码用同源字体 + 匈牙利算法求一一置换，实测 80 题零错字（算法见 [`font-obfuscation-decode`](https://github.com/zhuliudan666/font-obfuscation-decode)）

---

## 目录结构

```
yuketang-tewen-browse/
├── SKILL.md                      四任务骨架 + 坑位速查（先读这个）
├── README.md                     本文件：安装与上手
├── references/
│   ├── page-structure.md         DOM 选择器全量清单、Vuex 结构
│   ├── discussion.md             讨论任务的判断逻辑、误发清理
│   ├── font-deobfuscation.md     题库导出的站点参数与踩坑
│   └── captcha-shadow.md         拖动验证码、坐标陷阱、DPR
└── scripts/                      可直接运行的脚本
```

任务四的字体解码算法在独立技能 **`font-obfuscation-decode`** 里，本仓库只负责采集与出库。

---

## 前置要求

- Windows / macOS / Linux
- Node.js **≥ 22**（依赖内置 WebSocket）
- 本机已安装 Edge 或 Chrome
- 一个能正常登录的雨课堂账号
- 只用任务四时需要 Python 3.9+（`fontTools` / `numpy` / `scipy` / `Pillow` / `openpyxl`）

---

## 安装

### 方式 A：装成 WorkBuddy 技能（推荐）

把本仓库克隆到技能目录：

```bash
git clone https://github.com/zhuliudan666/yuketang-tewen-browse.git \
  ~/.workbuddy/skills/yuketang-tewen-browse
```

Windows 默认路径：`C:\Users\<你的用户名>\.workbuddy\skills\yuketang-tewen-browse`

或者：WorkBuddy 左侧「技能」面板 → 右上角「添加技能」→「导入技能」→ 选中仓库 zip。

装好后**新开一个对话**（技能在会话启动时扫描），说一句「雨课堂」即可触发。

### 方式 B：只当脚本用

```bash
git clone https://github.com/zhuliudan666/yuketang-tewen-browse.git
cd yuketang-tewen-browse
node scripts/launch-edge.mjs
```

不装技能也能直接跑脚本，`SKILL.md` 里写了每一步的页面选择器和踩坑记录。

---

## 快速开始

### 1. 起一个能被接管的浏览器

```bash
node scripts/launch-edge.mjs
```

为什么必须这样起：自动化只能走 CDP，而新版 Edge/Chrome **禁止在默认用户目录上开调试端口**，所以脚本会用独立目录 `.yb-profile/` 启动浏览器。

窗口弹出后**手动扫码登录一次**，登录态保存在 `.yb-profile/`，以后不用再登。

> 这个命令要一直开着——它就是浏览器宿主进程。关掉它浏览器就退出了。

可用环境变量覆盖：

| 变量 | 说明 | 默认 |
|---|---|---|
| `BROWSER_PATH` | Edge/Chrome 可执行文件路径 | 自动探测 |
| `PROFILE_DIR` | 独立配置目录 | `./.yb-profile` |
| `PORT` | 调试端口 | `9222` |
| `START_URL` | 启动后打开的页面 | `https://xidianyjs.yuketang.cn/pro/courselist` |

### 2. 生成本校课程清单

```bash
SITE=https://xidianyjs.yuketang.cn node scripts/collect-courses.mjs
```

产出 `out/courses.json`：`[{ "name": "...", "cid": "...", "rid": "..." }, ...]`

### 3. 跑任务

```bash
# 讨论发言：ONLY 指定课程下标（不填=全部课程），MY_NAME 必填你的昵称
DISC_OUT=./out MY_NAME=你的昵称 ONLY=0,3 node scripts/discussion.mjs
```

`MY_NAME` 一定要填对（要和评论区显示的名字一致），它用于「这条讨论我是不是已经发过」的防护。

图文浏览的流程在 `SKILL.md`「任务一」，思路相同：点开 → 停留 → 关标签。

### 4. 习题作答 / 题库导出

这两个任务没有一键脚本，按 `SKILL.md`「任务三 / 任务四」的流程走：

```bash
export YUKETANG_BASE=$(pwd)        # 采集、解码、出库共用同一个工作目录
node scripts/check_font_src.js     # 读当前习题页生效的加密字体地址
node scripts/collect.mjs           # 采集题目（同时记录每套卷的字体 URL）→ collector.json
python scripts/build_bank2.py      # 解码题干与选项 → 题库_初稿.json
python scripts/make_bank.py --name 课程名_测试题库 --course "2026 秋 · 课程名"
                                   # → <name>.xlsx / <name>.md / <name>.json
```

中间的解映射由 `font-obfuscation-decode` 技能完成：

```bash
SKILL=~/.workbuddy/skills/font-obfuscation-decode/scripts
python $SKILL/probe.py font/exam_<hash>.ttf          # 自动找同源字体
python $SKILL/solve.py --target font/exam_<hash>.ttf \
    --candidate C:/Windows/Fonts/NotoSansSC-VF.ttf --out font --key <hash>
python $SKILL/verify.py --a font/map_<hash>.json --b font/map4_<hash>.json   # 交叉校验
```

交卷遇到拖动式安全校验时：

```bash
node scripts/cap_grab.mjs          # 抠出验证码 canvas，输出圆点坐标与颜色
PTS='[[x,y],...]' node scripts/cap_drag.mjs   # 按顺序拖过去
```

---

## 脚本说明

| 文件 | 作用 |
|---|---|
| `scripts/cdp.mjs` | 无依赖 CDP 客户端，导出 `sleep / listTargets / listPages / closeTarget / connectPage / evalJs / navigate / screenshot` |
| `scripts/launch-edge.mjs` | 探测浏览器、以独立 profile + 调试端口启动并常驻 |
| `scripts/collect-courses.mjs` | 抓课程列表，生成 `out/courses.json` |
| `scripts/discussion.mjs` | 讨论批量发言主流程 |
| `scripts/check_font_src.js` | 读当前习题页生效的 `@font-face` 地址 |
| `scripts/collect.mjs` | 采集每套卷的题目 HTML、答案与字体 URL → `collector.json` |
| `scripts/build_bank2.py` | 按每套卷各自的映射解码题干选项 → `题库_初稿.json` |
| `scripts/make_bank.py` | 渲染 xlsx（题库 / 统计 / 说明 三页）、md、json |
| `scripts/cap_grab.mjs` | 抠出 shadow DOM 里的验证码 canvas，聚簇求圆心 |
| `scripts/cap_drag.mjs` | 按坐标序列做真实鼠标拖拽 |
| `scripts/cap_blobs2.py` | `cap_grab` 的像素聚类后端 |

`connectPage('forum/')` 是这套流程的关键——雨课堂每个任务都会**新开一个 tab**，靠 URL 子串选中正确的那个。

---

## 页面结构备忘（雨课堂研究生版 /pro）

| 元素 | 选择器 |
|---|---|
| 课程卡片 | `.lesson-cardS`（会重复匹配，按名字去重） |
| 课程目录 | `/pro/lms/<cid>/<rid>/studycontent` |
| 目录条目 | `.leaf-detail`，首行为条目名；类型看图标 class `icon--tuwen` / `icon--shipin` / `icon--zhibo` |
| 待办列表行 | `.unfinished-study__item` + `.unfinished-study__item-title` |
| 讨论题目 | `.main-text-attachment` |
| 评论正文 | `.comment-text`（一条一个，前面 `.comment-header` 是昵称+时间） |
| 发言输入框 | `textarea.el-textarea__inner` |
| 发送按钮 | `.prompt-send-btn`（空内容带 `disabled` class） |
| 加密题干 | `span.xuetangx-com-encrypted-font`（字体反爬） |
| 弹窗按钮 | `div.rain-btn`（**不是** `<button>`） |

更全的选择器与 Vuex 结构见 `references/page-structure.md`。

---

## 已知坑（真踩过，别重踩）

1. **同名讨论题**：不同讲次常有同名题目（每章都有「讨论题1」）。按标题 `find` 会一直命中第一条，导致把内容重复发进同一个已完成的讨论。**必须用 `.leaf-detail` 的 DOM 索引定位**，索引在 `location.reload()` 后保持稳定，去重表也要用索引当 key。
2. **Vue v-model 不能直接赋值**：`ta.value = x` 不会触发组件更新，发送按钮一直灰。必须用原生 setter + `dispatchEvent(new Event('input', { bubbles: true }))`。
3. **评论条数不可信**：评论列表是虚拟列表，恒定只渲染 10 条。判断发表成功要看「输入框被清空」+「评论成功」toast，不能比较条数。
4. **状态要 reload 才刷新**：SPA 内不会自动把「未发言」变「已发言」，不 reload 会陷入死循环重复发。
5. **别反复重启浏览器**：Windows 上 GUI 子进程会随宿主进程结束被回收，必须用常驻 Node 进程持有；也不要把 page target 全关掉，浏览器会直接退出。
6. **代理会挡住 127.0.0.1**：`curl` 走代理连不上调试端口，用 `curl --noproxy '*'` 或 Node 的 `fetch`。
7. **路径含空格会被参数解析切碎**：工作区常叫 `D:\workbuddy data\...`，写成命令行参数会被空白分成两段，profile 变成安装目录。
8. **点题号 / 下一题没反应**：被前端 `ProblemChangeGuard` 静默拦截，改走 Vuex `cloud/setProblem` 切题。
9. **交卷弹窗点不到按钮**：是 `div.rain-btn` 不是 `<button>`，按 `textContent` 找外层 div。
10. **iframe 内点击坐标偏**：弹窗出现时 iframe `getBoundingClientRect()` 会报 (0,0,整窗)，必须在**同一次 eval 里**同时取父页与 iframe 的 rect 相加。
11. **复制题干是乱码，别怀疑自己**：页面文字能选中，但底层是字体反爬（DOM 存随机汉字、字体重绘真字形）。肉眼读题请截图；要文字资产走任务四。
12. **每套卷一个独立随机字体**：采集时必须「打开卷子 → 立刻记录 `@font-face` 的 `src` → 再抓题目」，事后补不回来。
13. **习题交卷后没有重做入口**，提交前确认每题都答了。

---

## 免责声明

- 本项目仅用于**个人学习记录管理**的自动化实验，代码按「现状」提供，不保证适配你所在学校的雨课堂版本。
- **「讨论发言」会用评论区他人原文作为你的发言内容**，这在多数高校属于学术不端行为，可能导致课程成绩作废或纪律处分。请自行评估风险，建议只把本项目当成 CDP 自动化练手，发言部分改为自己写。
- **「习题作答」是代做题**，「题库导出」绕过了平台的字体反爬保护；这两项用于研究与自查，是否合规取决于你所在学校的规定，**不建议在计分作业上使用**。
- 刷课、替他人发言等行为可能违反学校的教学管理规定与平台用户协议，**使用后果自负**。
- 仓库不含任何账号、Cookie 或个人信息；登录态在本地 `.yb-profile/`，已被 `.gitignore` 排除，请勿提交。

## License

[MIT](LICENSE)
