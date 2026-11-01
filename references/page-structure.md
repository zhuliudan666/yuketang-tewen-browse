# 雨课堂 `/pro` 页面结构清单

选择器与 DOM 事实的全量记录。主 `SKILL.md` 只留高频用到的，这里查细节。
站点：研究生版 `/pro`（如 `xidianyjs.yuketang.cn`）。其他学校若前端同源，改域名即可。

## 课程列表

- URL：`/pro/courselist`
- 卡片：`.lesson-cardS`
- **会重复匹配**（同一门课渲染多个卡片节点），按名字去重后再用。

## 课程内页

| 用途 | URL |
|---|---|
| 目录 | `/pro/lms/<cid>/<rid>/studycontent` |
| 待办 | `/pro/lms/<cid>/<rid>/unfinished` |

- 目录条目：`.leaf-detail`
  - 首行是条目名（如「第一讲 讨论1」）
  - 类型靠图标 class：`icon--tuwen` / `icon--shipin` / `icon--zhibo`
  - 讨论条目文本内含「未发言」「已发言」
- 待办列表行：`.unfinished-study__item`
  - 首行是类型（图文/视频/讨论/作业/直播）
  - 标题在 `.unfinished-study__item-title`
- 空课程：显示「老师没有发布学习内容」，「全部待办 0」「已完成学习单元 0/--」

点击目录条目 → **新开 tab**：

- 图文/视频：`/ai-workspace/lms-graph/<rid>/...`
- 讨论：`/ai-workspace/lms-graph/<rid>/forum/<forumId>?fromProIframe=1...`

## 讨论页

| 元素 | 选择器 |
|---|---|
| 题目 | `.main-text-attachment` |
| 现有评论正文 | `.comment-text`（一条一个） |
| 评论头（昵称+时间） | `.comment-header` |
| 输入框 | `textarea.el-textarea__inner`（placeholder「发表你的观点...」） |
| 发送按钮 | `.prompt-send-btn`（空内容时带 `disabled` class） |
| 本人评论的删除钮 | `.del`（hover 才显示，`display:none`） |
| 删除确认框 | `.el-message-box` |
| 单条评论容器 | `.forum-item` |

- 输入框是 Vue `v-model`，必须原生 setter + `dispatchEvent(new Event('input',{bubbles:true}))`，直接 `ta.value=` 不生效，按钮一直 disabled。
- 评论列表是**虚拟列表，恒定只渲染 10 条**，不能用条数变化判断成功。
- 页面里常驻一个 `turing.captcha.gtimg.com` 的隐藏 iframe，正常现象，不影响发送。

## 习题页

主体在**同源 iframe** 内：

```
/ai-workspace/lms-graph/<rid>/exercise/<exerciseId>?...
  └─ iframe: /v2/web/iframe-exercise/<rid>/<exerciseId>?noLeftMenu=1&...
```

单独打开 iframe URL 也能答题，但「提交」不生效（要 postMessage 给父页）。**交卷必须回到父页，在 iframe 里点提交。**

| 元素 | 选择器 |
|---|---|
| 左栏题号 | `.subject-item[data-order="i"]` |
| 单选题选项 | `ul.list-unstyled-radio label.el-radio`（value=A..D，4 个） |
| 判断题选项 | 同上，value=`true`/`false`，✓ 排在前 |
| 换卷入口 | 父页左侧「目录」的 `.leaf-item-title`（文本即卷名） |
| 提交按钮 | iframe 内「提交」 |
| 提交确认弹窗 | 「N 道已作答习题未提交，需要一起提交吗」→「帮我提交」/「仅提交本题」 |
| 成功提示 | `.el-message`（「提交成功」） |

- 弹窗按钮是 **`div.rain-btn.pointer`，不是 `<button>`**。`querySelectorAll('button')` 找不到。
  按 `textContent === '帮我提交'` 找，并取**外层那个 width≈97 的 div**（`.text` 子节点只有 56px 宽）。
- 页面上会注入 `data-automation-risk-decoys="true"` 的**屏外假元素**（假 E 选项、假「下一题」按钮）。
  按文本/坐标选元素时必须过滤可视区域：`getBoundingClientRect()` 的 width/height > 0 且坐标在视口内。

## Vuex 结构（解题关键）

题目正文不在 DOM 里抓，直接从 store 拿更干净：

- `#app.__vue__` 起遍历 `$children`，找到 `$data` 含 `defaultProblem` 的那个组件实例 `t`
- 切题：`t.$store.dispatch('cloud/setProblem', t.exerciseList.problems[i-1])`
- 题目列表：`t.exerciseList.problems`
- 单题：`content.Body`（HTML 题干）、`content.Options[].value`（选项 HTML）、`Type`、`Score`
- 作答状态：`problems[i]._answer`、`_submitStatus`
- 判断题 `Type === 'Judgement'`，`Options` 只有 true/false 且 `value` 为空，答案就是「正确 / 错误」

iframe 内取同一套：`document.querySelector('iframe').contentDocument.querySelector('#app').__vue__`

> 侧栏 `.subject-item` 和「下一题」按钮点击会被 `ProblemChangeGuard` 静默拦掉（事件到了、就是不动）。
> 别在这些元素上浪费时间，直接走 store。

## 结果判分

- 每题页面显示「本题得分：x」「正确答案：X」
- `problems[i].score` / `content_score` 提交后**不一定刷新**，别依赖，逐题切过去读页面文字累加。
