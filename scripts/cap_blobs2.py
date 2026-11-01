import sys, zlib, struct, json

path, ox, oy, div = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
data = open(path, 'rb').read()
pos = 8
idat = b''
w = h = colortype = None
while pos < len(data):
    ln = struct.unpack('>I', data[pos:pos+4])[0]
    typ = data[pos+4:pos+8]
    chunk = data[pos+8:pos+8+ln]
    if typ == b'IHDR':
        w, h, _, colortype = struct.unpack('>IIBB', chunk[:10])
    elif typ == b'IDAT':
        idat += chunk
    elif typ == b'IEND':
        break
    pos += 12 + ln

raw = zlib.decompress(idat)
nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
stride = w * nch
rows = []
prev = bytearray(stride)
o = 0
for y in range(h):
    ft = raw[o]; o += 1
    line = bytearray(raw[o:o+stride]); o += stride
    if ft == 1:
        for i in range(nch, stride):
            line[i] = (line[i] + line[i-nch]) & 255
    elif ft == 2:
        for i in range(stride):
            line[i] = (line[i] + prev[i]) & 255
    elif ft == 3:
        for i in range(stride):
            a = line[i-nch] if i >= nch else 0
            line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
    elif ft == 4:
        for i in range(stride):
            a = line[i-nch] if i >= nch else 0
            b = prev[i]
            c = prev[i-nch] if i >= nch else 0
            p = a + b - c
            pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
            pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[i] = (line[i] + pr) & 255
    rows.append(line)
    prev = line

cells = {}
for y in range(h):
    line = rows[y]
    for x in range(w):
        r = line[x*nch]; g = line[x*nch+1]; b = line[x*nch+2]
        mx, mn = max(r, g, b), min(r, g, b)
        if mx - mn > 60 and mx > 90:
            cells.setdefault((x // 8, y // 8), []).append((x, y, r, g, b))

keys = list(cells)
idx = {k: i for i, k in enumerate(keys)}
parent = list(range(len(keys)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra
for k in keys:
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            nk = (k[0]+dx, k[1]+dy)
            if nk in idx: union(idx[k], idx[nk])
groups = {}
for k in keys:
    groups.setdefault(find(idx[k]), []).extend(cells[k])

out = []
for g in groups.values():
    if len(g) < 300: continue
    sx = sum(p[0] for p in g) / len(g); sy = sum(p[1] for p in g) / len(g)
    cr = sum(p[2] for p in g)/len(g); cg = sum(p[3] for p in g)/len(g); cb = sum(p[4] for p in g)/len(g)
    kind = 'green' if cg >= max(cr, cb) - 5 else ('blue' if cb - cr > 80 else 'purple')
    out.append({'kind': kind, 'x': round(ox + sx / div, 1), 'y': round(oy + sy / div, 1), 'rgb': [round(cr), round(cg), round(cb)]})
out.sort(key=lambda d: d['x'])
print(json.dumps(out, ensure_ascii=False))
