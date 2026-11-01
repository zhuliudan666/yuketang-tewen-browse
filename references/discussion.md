# 讨论任务细节（任务二）

主 `SKILL.md` 里只有五步流程。这里是判断逻辑、边界情况、和出事之后的补救。

## 一、判断「成功了没有」的唯一可信信号

| 信号 | 可信 | 说明 |
|---|---|---|
| 出现「评论成功」toast | ✅ | 主判据 |
| `textarea.value.length === 0` | ✅ | 辅助判据，发送后 Vue 会清空 |
| 评论条数变多 | ❌ | 虚拟列表**恒定只渲染 10 条**，条数永远不变 |
| 讨论数（「讨论区 920」） | ❌ | 是课程级统计，不反映单条状态 |
| 目录里状态变「已发言」 | ❌ | SPA 不自动刷新，必须 reload 才更新 |

**两个条件同时满足才算成功**：toast 出现 **且** 输入框被清空。
只满足一个通常意味着：按钮点到了但请求被拒（限流 / 内容重复 / 网络断）。

## 二、必须 reload 的原因

目录页的「未发言 → 已发言」状态**在 SPA 内不会自动更新**。

后果：如果不 reload 就进入下一轮收集，同一条讨论仍然显示「未发言」→ 被再次选中 → 再发一遍。
实测会陷入死循环，同一讨论堆积几十条相同评论。

正确循环：**关 tab → `location.reload()` 目录页 → 等渲染 → 重新收集 `.leaf-detail` → 再筛**。
索引在 reload 后保持稳定，可以放心复用 `tried` 表。

## 三、同名题的坑（最容易出事故）

不同讲次里几乎都有同名讨论：每章都有「讨论题」「讨论题1」「讨论题2」。

```js
// 错：永远命中列表里第一个同名项
const item = items.find(el => el.textContent.includes('讨论题1'));

// 对：用 DOM 索引定位
const idx = items.findIndex(el => el.textContent.includes('讨论题1') && el.textContent.includes('未发言'));
items[idx].click();
```

- `tried` 去重表**也必须以索引为 key**，用标题做 key 等于没有去重。
- 索引在 reload 后稳定，这个前提实测成立。

## 四、输入框填不进去 / 按钮一直 disabled

输入框是 Vue `v-model`，直接 `ta.value = '...'` 不会触发响应式更新，
发送按钮会一直保持 `disabled` class。

```js
const ta = document.querySelector('textarea.el-textarea__inner');
const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
setter.call(ta, text);
ta.dispatchEvent(new Event('input', { bubbles: true }));
```

## 五、防御：先确认是不是已经发过了

进讨论页后先读评论区，**如果 `.comment-header` 首行出现本人昵称，说明其实已经完成**（上一轮发了但状态没刷新）。

此时直接跳过，不要再发。这是最后一道防重复的闸门，成本极低，一定要留。

## 六、误发之后怎么清理

本人评论的删除按钮 `.del` 是 hover 才显示（`display: none`），
但 Vue 事件已绑定，**不需要真的 hover，直接 `del.click()` 就行**。
随后 `.el-message-box` 里点「确定」。

⚠️ **只对本人 `.forum-item` 内的 `.del` 操作**。
其他人的评论项里也有同名 `.del`，误点就是删别人的发言——这比多发一条严重得多。

```js
const mine = [...document.querySelectorAll('.forum-item')]
  .filter(it => it.querySelector('.comment-header')?.textContent.includes(MY_NAME));
mine.forEach(it => it.querySelector('.del')?.click());
```

## 七、发言内容的选择

- 默认：随机取评论区一条他人原文（用户明确要求的操作）。
- 若用户说「不要太雷同」/「别照抄」：取一条后追加一句自己的话，或改写首尾。
- 过滤 `< 60` 字的长评论：过短的多是「同意」「说得好」，复制过去容易被识别为灌水。
