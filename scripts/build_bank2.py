# -*- coding: utf-8 -*-
"""按每套卷各自的字体映射解码，输出题库 JSON；并给出可疑字形清单。

工作目录（需含 collector.json 与 font/）按 --base > $YUKETANG_BASE > 当前目录 解析，
所以换课程、换机器都不用改脚本。
"""
import argparse, io, json, os, re
from html.parser import HTMLParser

ENC = "xuetangx-com-encrypted-font"


def resolve_base():
    ap = argparse.ArgumentParser(description="解码采集结果，生成题库初稿 JSON")
    ap.add_argument("--base", default=os.environ.get("YUKETANG_BASE") or os.getcwd(),
                    help="工作目录，需含 collector.json 与 font/（默认 $YUKETANG_BASE 或当前目录）")
    return os.path.abspath(ap.parse_args().base)


BASE = resolve_base()
COLL_PATH = os.path.join(BASE, "collector.json")
if not os.path.exists(COLL_PATH):
    raise SystemExit(f"找不到 {COLL_PATH}\n用 --base 指定工作目录，或先用 collect.mjs 采集")
COLL = json.load(io.open(COLL_PATH, encoding="utf-8"))


def load_map(font_src):
    """映射表由 font-obfuscation-decode 技能的 solve.py 产出。
    兼容旧命名 map4_<key>.json 与新命名 map_<key>.json。"""
    key = os.path.basename(font_src).replace("exam_font_", "").replace(".ttf", "")[:8]
    for name in (f"map4_{key}.json", f"map_{key}.json"):
        p = os.path.join(BASE, "font", name)
        if os.path.exists(p):
            return json.load(io.open(p, encoding="utf-8")), key
    raise SystemExit(
        f"缺少映射表: font/map4_{key}.json 或 font/map_{key}.json\n"
        f"用 font-obfuscation-decode 技能生成：\n"
        f"  python <该技能>/scripts/solve.py --target font/exam_{key}.ttf \\\n"
        f"      --candidate C:/Windows/Fonts/NotoSansSC-VF.ttf --out font --key {key}")


def is_suspicious(e):
    """按 margin 判定，不看 agree。

    margin = 这个字拿到的相似度，比同一行里第二像的字高多少（见通用技能的
    fontlib.solve_mapping）。形近字的 margin 天然小，这才是需要人工看图的那批。

    不用 agree 是因为不同版本映射表的投票路数不同：旧表跑两个字重、agree 普遍是
    "1/2"，新表跑三路、多为 "3/3"；拿它当门槛会把整表都标成可疑（实测 2825 条噪音）。
    """
    return e.get("margin", 1) < 0.04


class Dec(HTMLParser):
    def __init__(self, M):
        super().__init__(convert_charrefs=True)
        self.M = M
        self.buf = []
        self.enc = 0
        self.susp = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "span" and ENC in a.get("class", ""):
            self.enc += 1
        if tag in ("p", "div", "br", "li"):
            if self.buf and not self.buf[-1].endswith("\n"):
                self.buf.append("\n")
        if tag == "img":
            self.buf.append("[图片]")

    def handle_endtag(self, tag):
        if tag == "span" and self.enc > 0:
            self.enc -= 1
        if tag in ("p", "div", "li"):
            if self.buf and not self.buf[-1].endswith("\n"):
                self.buf.append("\n")

    def handle_data(self, data):
        if self.enc > 0:
            out = []
            for ch in data:
                e = self.M.get(ch)
                if e:
                    out.append(e["to"])
                    if is_suspicious(e):
                        self.susp.append((ch, e["to"], e.get("alt", ""), e.get("margin"), e.get("agree")))
                else:
                    out.append(ch)
            self.buf.append("".join(out))
        else:
            self.buf.append(data)

    def text(self):
        s = "".join(self.buf)
        s = re.sub(r"[ \t\u00a0]+", " ", s)
        s = re.sub(r"\n\s*\n+", "\n", s)
        return s.strip()


def to_text(h, M):
    p = Dec(M)
    p.feed(h or "")
    p.close()
    return p.text(), p.susp


papers = []
all_susp = []
for paper in COLL:
    M, key = load_map(paper["fontSrc"])
    probs = []
    for p in paper["problems"]:
        stem, s1 = to_text(p["bodyHtml"], M)
        all_susp += [(paper["name"], p["no"]) + t for t in s1]
        opts = []
        for o in p["options"]:
            t, s2 = to_text(o["html"], M)
            all_susp += [(paper["name"], p["no"]) + x for x in s2]
            opts.append({"key": o["key"], "text": t})
        if p["type"] == "Judgement":
            nopts = [{"key": "正确", "text": "正确"}, {"key": "错误", "text": "错误"}]
            atext = p["correct"]
            mine = {"true": "正确", "false": "错误"}.get(p["myAnswer"], p["myAnswer"])
        else:
            nopts = opts
            atext = dict((o["key"], o["text"]) for o in opts).get(p["correct"], "")
            mine = p["myAnswer"]
        probs.append({
            "no": p["no"], "type": p["typeText"], "stem": stem,
            "options": nopts, "answer": p["correct"], "answerText": atext,
            "score": p["score"], "myAnswer": mine, "correct": mine == p["correct"],
        })
    papers.append({"name": paper["name"], "fontKey": key, "problems": probs})

json.dump(papers, io.open(os.path.join(BASE, "题库_初稿.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

print("papers:", len(papers), "| problems:", sum(len(p["problems"]) for p in papers))
print("suspicious glyph hits:", len(all_susp))
seen = set()
for s in all_susp:
    k = (s[2], s[3], s[4], s[5])
    if k in seen:
        continue
    seen.add(k)
    print("  ", s)
