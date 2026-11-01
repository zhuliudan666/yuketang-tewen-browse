# 雨课堂题型库导出：本站点如何套用通用解码流程

**算法本体不在这里。** 字体解码的通用方法论、脚本、调参，见独立技能
`font-obfuscation-decode`（`~/.workbuddy/skills/font-obfuscation-decode/`）。

本文件只记录**雨课堂特有的参数**：从哪拿字体、class 叫什么、码位多少、配上哪个参照字体、
以及本站点踩过的坑。

## 一、站点参数

| 项 | 值 |
|---|---|
| 加密容器 | `span.xuetangx-com-encrypted-font` |
| font-family | `exam-data-decrypt-font` |
| 字体地址 | `https://fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_<32位hash>.ttf` |
| 码位数 | 882（8 套卷全部一致） |
| 原始字体 | Source Han Sans SC VF（思源黑体）ExtraLight，v2.004 |
| 参照字体 | `C:\Windows\Fonts\NotoSansSC-VF.ttf` |
| 实测 avgSim | 2.83（默认字重）/ 2.61（wght=200） |
| 字体变化 | **每套卷一个独立字体**，同卷内固定 |

`name` 表没被清空，`probe.py` 能直接读出家族名 —— 这也是当初能定位到「思源黑体」的关键。

## 二、流程

```bash
SKILL=~/.workbuddy/skills/font-obfuscation-decode/scripts
export YUKETANG_BASE=$(pwd)                 # 三步共用工作目录，也可逐条传 --base

# 1. 采集（必须边开卷边记字体 URL）
node scripts/collect.mjs                    # 输出 collector.json，含每套卷的 fontSrc

# 2. 对 collector.json 里每个 fontSrc 依次求解
python $SKILL/probe.py font/exam_<hash>.ttf --candidate C:/Windows/Fonts/NotoSansSC-VF.ttf
python $SKILL/solve.py --target font/exam_<hash>.ttf \
    --candidate C:/Windows/Fonts/NotoSansSC-VF.ttf --out font --key <hash>

# 3. 解码 HTML（只解 span 内部）
python scripts/build_bank2.py               # 输出 题库_初稿.json

# 4. 出库
python scripts/make_bank.py --name 课程名_测试题库 --course "2026 秋 · 课程名"
```

### 采集这一步的顺序不能错

`collect.mjs` 打开每套卷后**立刻**读 `@font-face` 的 `src` 存进 `fontSrc`，然后再逐题抓内容。

原因：换卷后 `@font-face` 就指向新字体了，回头再找已经拿不到旧的那一个。
第一次做的时候没记，整个重采了一遍。

题目正文从 store 的 `content.Body`（HTML）拿，选项在 `content.Options[].value`；
判断题 `Type === 'Judgement'`，`Options` 只有 true/false 且 value 为空，答案就是「正确 / 错误」。

### 解码的边界

`build_bank2.py` 只对 `span.xuetangx-com-encrypted-font` **内部**的字符做替换，
span 外原样保留。

原因：本站点**只有汉字被替换**，英文（`Powerpoint`）、数字、标点、「正确答案：C」、
「判断题」都是明文，而这些明文汉字的码位也在映射表的键域里 —— 整段逐字替换会误伤。

## 三、本站点特有的坑

### 1. 复制出来是乱码，别怀疑自己

页面文字可以正常选中高亮，但 `Ctrl+C` 之后剪贴板里是另一套字：

| 屏幕 | 剪贴板 |
|---|---|
| 以下哪一项不是使用 Powerpoint 等视觉辅助软件工具的目的？ | 保引完减更动社区床Powerpoint室特型辅出限德结老也哪也？ |

字数一致、英文没变、汉字全变。所以：**肉眼读题请截图；要文字资产才解字体**。

### 2. 每套卷独立字体

8 套卷 8 个 hash。不能拿第一周的解码表去解第二周，会得到通顺但完全错误的句子。
必须按 `fontSrc` 分别求解，`build_bank2.py` 会按 `fontSrc` 自动找对应的映射表。

### 3. 原题错字不要改

第五周第 2 题还原出「以下哪一**语阶**属于……这一**语步**？」。
字形与原图双重确认后，判定**原题本身写错了**（两个密文字符不同，不是解码问题）。

处理方式：在题库里加「备注」列说明，**不替出题人改字**。

### 4. 校验

跑通用技能的交叉校验，拿「同源字体版」对「系统黑体版」：

```bash
python $SKILL/verify.py \
  --a font/map_<hash>.json --b font/map_<hash>_sys.json \
  --label-a "同源Noto" --label-b "系统黑体"
```

实测 80 题只剩 2 处分歧（令→儿/几、批→学/空），都是同源版正确，
系统版还出现了非双射。这个对照就是「必须用同源字体」的证据。

## 四、历史产物

工作目录（`$YUKETANG_BASE`）下：

- `collector.json` —— 8 套卷 80 题的原始采集
- `font/exam_<hash>.ttf` × 8 —— 各卷混淆字体
- `font/map4_<hash>.json` × 8 —— 已解好的映射（旧命名，`build_bank2.py` 兼容）
- `<题库名>.xlsx` / `.md` / `.json` —— 成品

成绩记录：W1 6/10、W2 10/10、W3 7/10、W4 10/10、W5 8/10、W6 9/10、W7 10/10、W8 9/10，合计 69/80。
错题集中在「计数类」单选与「绝对化表述」判断题。
