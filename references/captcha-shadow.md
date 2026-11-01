# 拖动式安全校验 + 习题页坐标陷阱

交卷必经的两道坎：**拖动式「请完成安全校验」** 和 **弹窗出现时 iframe rect 谎报**。
两者都实测踩过，照下面做能一次过。

## 一、拖动式安全校验

### 触发条件

点「提交」→ 弹「N 道已作答习题未提交，需要一起提交吗」→ 点「帮我提交」→
弹出「请完成安全校验」（按顺序连 **起 → 1 → 2 → 3 → 终**）。

- **每套卷子必弹一次**，不解决就交不上卷（脚本里重试 5 次全是 `no success`）。
- 顺序点错或轨迹没被判定经过，圆点会**重新随机布局**，必须重新 grab，不能重用旧坐标。

### 它在哪（先别浪费时间找选择器）

它画在 iframe 内**某个 div 的 shadowRoot 里的 `<canvas>`** 上：

- 尺寸约 **341 × 221 CSS px**
- 位置基本固定在 **(568, 309)** 附近
- `document.querySelectorAll` / `contentDocument` 都**查不到任何文字**——它压根没有文本节点

→ 正确做法是**像素分析**，不是找 DOM。

### 解法（脚本已备好）

```bash
node scripts/cap_grab.mjs     # 定位 canvas → 按 scale=3 截取 → 输出圆点 CSS 坐标+颜色，存 cap_crop.png
node scripts/cap_drag.mjs     # PTS='[[x,y],...]' 按 起/1/2/3/终 顺序拖过去
```

1. `cap_grab.mjs` 抠图 → 调 `cap_blobs2.py`（纯标准库解析 PNG，不需要 PIL）按颜色聚簇算圆心。
2. **看一眼 `cap_crop.png` 确认 1/2/3 的先后**（编号是画在图上的，机器读不出数字）。
3. `cap_drag.mjs` 用 CDP 鼠标按住沿顺序拖过去。

可用 `PYTHON` / `CAP_PNG` 环境变量覆盖路径。

### 拖拽参数（改小就失败）

- 每段插值 **≥ 18 步**
- 每到一个点**停顿 260ms** 再走下一段（停顿太短会被判定"没经过"）
- 起点要先 `mouseMoved` 悬停，再 `mousePressed`
- 最后在「终」上 `mouseReleased`

### 颜色区分

| 角色 | 颜色 | RGB 约值 |
|---|---|---|
| 起 | 蓝 | (79, 131, 247) |
| 中间点 | 紫 | (115, 61, 203) |
| 终 | 绿 | (92, 160, 56) |

### 成功判据

`canvasVisible === false` —— canvas 从 shadowRoot 消失。
不是"弹窗关了"，可能只是你点歪了把弹窗点掉。

### 曾经踩的坑

首次找不到 DOM 时误判成"浏览器层面绘制的图，抓不到"，
绕了一大圈才发现是 iframe 内 shadowRoot 里的 canvas。**先想到 shadow DOM。**

## 二、弹窗出现时 iframe rect 会谎报

正常时 iframe 在 `(368, 138, 1086, 652)`。
**弹窗一出现，`iframe.getBoundingClientRect()` 会报成 `(0, 0, 整窗)`。**

- 千万**不要人为加偏移**——加多少点偏多少。
- 正确做法：**在同一次 eval 里**同时取「目标元素 rect」和「iframe rect」，按浏览器报的值相加。
  分两次取一定会错位。

```js
// 同一次 eval 内完成，别拆成两次
const fr = iframe.getBoundingClientRect();
const r  = target.getBoundingClientRect();
return { x: fr.x + r.x + r.width/2, y: fr.y + r.y + r.height/2 };
```

## 三、坐标与 DPR

- CDP `Input.dispatchMouseEvent` 的坐标是 **CSS px**。
- 本机 DPR = **1.5**，`Page.captureScreenshot` 出来的图会被放大。
  **别拿截图像素当坐标**，一定用 `getBoundingClientRect()`。
- 选项必须用真实鼠标事件（`mouseMoved` → `mousePressed` → `mouseReleased`），
  `el.click()` 只在部分场景生效且状态易被回滚。
