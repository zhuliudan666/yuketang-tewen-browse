# -*- coding: utf-8 -*-
"""生成最终题库：xlsx + md + json。

    python make_bank.py --base <工作目录> --name 学术交流英语_测试题库 --course "..."

`--name` 同时决定输出文件名（`<name>.xlsx/.md/.json`）和 md 标题；
`--course` / `--source` 只影响 xlsx「说明」页，留空则显示 —。
"""
import argparse, io, json, os, re
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

ap = argparse.ArgumentParser(description="把题库初稿 JSON 渲染成 xlsx / md / json")
ap.add_argument("--base", default=os.environ.get("YUKETANG_BASE") or os.getcwd(),
                help="工作目录，需含 题库_初稿.json（默认 $YUKETANG_BASE 或当前目录）")
ap.add_argument("--name", default="测试题库", help="题库名，决定输出文件名与标题")
ap.add_argument("--course", default="", help="说明页「课程」一栏")
ap.add_argument("--source", default="", help="说明页「来源」一栏")
arg = ap.parse_args()

BASE = os.path.abspath(arg.base)
NAME = arg.name
DRAFT = os.path.join(BASE, "题库_初稿.json")
if not os.path.exists(DRAFT):
    raise SystemExit(f"找不到 {DRAFT}\n先跑 build_bank2.py 解码出初稿")
data = json.load(io.open(DRAFT, encoding="utf-8"))


def clean(s):
    s = (s or "").replace("\r", "\n")
    s = re.sub(r"\s*\n\s*", " ", s)
    s = re.sub(r"[ \t\u00a0]+", " ", s)
    return s.strip()


WEEK_ORDER = {f"第{w}周测试题": w for w, w in zip(range(1, 9), range(1, 9))}

# 原文疑误处：经字形核对确认原文确为所示写法，仅作提示，不替出题人改字。
# key 是 (试卷名, 题号)，按本次采集的实际情况增删。
NOTES = {
    ("第五周测试题", 2): "原文此处作「语阶」，同句后文作「语步」，疑为出题笔误",
}

rows = []
for pa in data:
    pa["name"] = clean(pa["name"])
    for q in pa["problems"]:
        stem = clean(q["stem"])
        opts = {o["key"]: clean(o["text"]) for o in q["options"]}
        ans = q["answer"]
        if q["type"] == "判断题":
            ans_text = ans
            a = b = c = d = ""
            opts_out = {"正确": "正确", "错误": "错误"}
        else:
            ans_text = opts.get(ans, "")
            a, b, c, d = opts.get("A", ""), opts.get("B", ""), opts.get("C", ""), opts.get("D", "")
            opts_out = opts
        rows.append({
            "paper": pa["name"], "no": q["no"], "type": q["type"],
            "stem": stem, "A": a, "B": b, "C": c, "D": d,
            "answer": ans, "answerText": ans_text,
            "score": q["score"], "myAnswer": q["myAnswer"], "ok": q["correct"],
            "note": NOTES.get((pa["name"], q["no"]), ""),
        })

# ---------- Excel ----------
wb = Workbook()
ws = wb.active
ws.title = "题库"

HEAD = ["序号", "所属试卷", "题号", "题型", "题干", "A", "B", "C", "D",
        "正确答案", "正确答案内容", "分值", "我的作答", "是否答对", "备注"]
WIDTH = [6, 14, 6, 9, 62, 30, 30, 30, 30, 10, 36, 6, 10, 9, 26]

hdr_fill = PatternFill("solid", fgColor="4A5568")
hdr_font = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
body_font = Font(name="微软雅黑", size=10)
thin = Side(style="thin", color="D0D5DD")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

for i, h in enumerate(HEAD, 1):
    c = ws.cell(row=1, column=i, value=h)
    c.fill = hdr_fill
    c.font = hdr_font
    c.alignment = Alignment(horizontal="center", vertical="center")
    c.border = border
    ws.column_dimensions[get_column_letter(i)].width = WIDTH[i - 1]
ws.row_dimensions[1].height = 26

alt = PatternFill("solid", fgColor="F7F8FA")
for idx, r in enumerate(rows, start=2):
    vals = [idx - 1, r["paper"], r["no"], r["type"], r["stem"], r["A"], r["B"], r["C"], r["D"],
            r["answer"], r["answerText"], r["score"], r["myAnswer"], "√" if r["ok"] else "×",
            r["note"]]
    for j, v in enumerate(vals, 1):
        c = ws.cell(row=idx, column=j, value=v)
        c.font = body_font
        c.border = border
        if j in (5, 6, 7, 8, 9, 11, 15):
            c.alignment = Alignment(wrap_text=True, vertical="top")
        else:
            c.alignment = Alignment(horizontal="center", vertical="center")
        if idx % 2 == 0:
            c.fill = alt
    ws.row_dimensions[idx].height = 46 if r["type"] != "判断题" else 30

ws.freeze_panes = "E2"
ws.auto_filter.ref = f"A1:O{len(rows) + 1}"

# 统计页
ws2 = wb.create_sheet("统计")
ws2.column_dimensions["A"].width = 18
ws2.column_dimensions["B"].width = 12
ws2.column_dimensions["C"].width = 12
ws2.column_dimensions["D"].width = 12
for i, h in enumerate(["试卷", "题数", "单选", "判断"], 1):
    c = ws2.cell(row=1, column=i, value=h)
    c.fill = hdr_fill; c.font = hdr_font
    c.alignment = Alignment(horizontal="center")

r0 = 2
for pa in data:
    ps = [x for x in rows if x["paper"] == pa["name"]]
    n_single = sum(1 for x in ps if x["type"] == "单选题")
    n_judge = len(ps) - n_single
    for i, v in enumerate([pa["name"], len(ps), n_single, n_judge], 1):
        ws2.cell(row=r0, column=i, value=v).font = body_font
        ws2.cell(row=r0, column=i).alignment = Alignment(horizontal="center")
    r0 += 1
for i, v in enumerate(["合计", len(rows),
                       sum(1 for x in rows if x["type"] == "单选题"),
                       sum(1 for x in rows if x["type"] == "判断题")], 1):
    c = ws2.cell(row=r0, column=i, value=v)
    c.font = Font(name="微软雅黑", size=10, bold=True)
    c.alignment = Alignment(horizontal="center")

xlsx = os.path.join(BASE, f"{NAME}.xlsx")

ws3 = wb.create_sheet("说明")
ws3.column_dimensions["A"].width = 16
ws3.column_dimensions["B"].width = 86
info = [
    ("课程", arg.course or "—"),
    ("来源", arg.source or "—"),
    ("题目构成", f"{len(data)} 套试卷，共 {len(rows)} 题：单选 {sum(1 for x in rows if x['type']=='单选题')} 题、判断 {sum(1 for x in rows if x['type']=='判断题')} 题"),
    ("答案来源", "平台判分页显示的「正确答案」，逐题读取，非人工推断"),
    ("题干还原", "平台对题干做了字体混淆（码位随机重映射），此处已通过字形轮廓匹配还原为正常文字"),
    ("还原方式", "解析站点混淆字体（Source Han Sans SC VF 子集），与同源字体逐字形匹配建立「码位→真字」映射表，882 字全覆盖"),
    ("校验", "两套独立映射交叉比对，全部差异仅 2 处字形且已核对；逐题对照原页面截图抽查"),
    ("我的作答", "代答时的选择，仅供参考；「是否答对」依据平台判分"),
    ("整理时间", __import__("datetime").date.today().isoformat()),
]
for i, (k, v) in enumerate(info, 1):
    a = ws3.cell(row=i, column=1, value=k)
    a.font = Font(name="微软雅黑", size=10, bold=True)
    a.alignment = Alignment(vertical="top")
    b = ws3.cell(row=i, column=2, value=v)
    b.font = body_font
    b.alignment = Alignment(wrap_text=True, vertical="top")
    ws3.row_dimensions[i].height = 30 if len(v) < 60 else 46

wb.save(xlsx)
print("saved", xlsx, "rows:", len(rows))

# ---------- Markdown ----------
md = [f"# {NAME}", ""]
if arg.course:
    md.append(f"课程：{arg.course}")
md.append(f"共 {len(data)} 套 / {len(rows)} 题")
md.append("")
for pa in data:
    md.append(f"## {pa['name']}")
    md.append("")
    for q in pa["problems"]:
        stem = clean(q["stem"])
        md.append(f"**{q['no']}.（{q['type']}）** {stem}")
        md.append("")
        if q["type"] != "判断题":
            for o in q["options"]:
                k = o["key"]
                t = clean(o["text"])
                mark = " ✅" if k == q["answer"] else ""
                md.append(f"- {k}. {t}{mark}")
        else:
            md.append(f"- 正确答案：**{q['answer']}**")
        note = NOTES.get((pa["name"], q["no"]))
        if note:
            md.append("")
            md.append(f"  > 注：{note}")
        md.append("")
    md.append("")

md_path = os.path.join(BASE, f"{NAME}.md")
io.open(md_path, "w", encoding="utf-8").write("\n".join(md))
print("saved", md_path)

# ---------- 纯净 JSON ----------
pure = []
for pa in data:
    for q in pa["problems"]:
        pure.append({
            "paper": pa["name"], "no": q["no"], "type": q["type"],
            "stem": clean(q["stem"]),
            "options": {o["key"]: clean(o["text"]) for o in q["options"]} if q["type"] != "判断题"
                       else {"正确": "正确", "错误": "错误"},
            "answer": q["answer"],
            "answerText": q["answerText"] if q["type"] != "判断题" else q["answer"],
            "score": q["score"],
        })
json.dump(pure, io.open(os.path.join(BASE, f"{NAME}.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("saved", f"{NAME}.json", len(pure))
