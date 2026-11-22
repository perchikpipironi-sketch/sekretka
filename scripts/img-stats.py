"""Анализ картинок-кандидатов: яркость, фон, «смотрибельность» на тёмной теме.

Считаем:
  mean      — средняя яркость (0-255)
  dark%     — доля тёмных пикселей (luma < 90)
  corners   — яркость углов (понять, белый ли фон)
  center    — яркость центральной трети (там персонаж/объект)
  leftEdge  — яркость левой полосы (там будет текст на hero)
  sat       — средняя насыщенность
"""
import sys
from PIL import Image, ImageStat

paths = sys.argv[1:]
for p in paths:
    try:
        im = Image.open(p).convert("RGB")
    except Exception as e:  # noqa: BLE001
        print(f"{p}: OPEN FAIL {e}")
        continue
    w, h = im.size
    small = im.resize((160, max(1, int(160 * h / w))))
    sw, sh = small.size
    px = small.load()
    lumas, sats = [], []
    dark = 0
    for y in range(sh):
        for x in range(sw):
            r, g, b = px[x, y]
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            lumas.append(luma)
            mx, mn = max(r, g, b), min(r, g, b)
            sats.append(0 if mx == 0 else (mx - mn) / mx)
            if luma < 90:
                dark += 1
    mean = sum(lumas) / len(lumas)
    sat = sum(sats) / len(sats)

    def box(x0f, y0f, x1f, y1f):
        x0, x1 = int(sw * x0f), max(1, int(sw * x1f))
        y0, y1 = int(sh * y0f), max(1, int(sh * y1f))
        vals = [px[x, y][0] * .2126 + px[x, y][1] * .7152 + px[x, y][2] * .0722
                for y in range(y0, y1) for x in range(x0, x1)]
        return sum(vals) / len(vals) if vals else 0

    print(f"{p}")
    print(f"  size {w}x{h}  mean={mean:6.1f}  dark%={100*dark/len(lumas):5.1f}  sat={sat:.3f}")
    print(f"  corners TL={box(0,0,.12,.12):5.1f} TR={box(.88,0,1,.12):5.1f} "
          f"BL={box(0,.88,.12,1):5.1f} BR={box(.88,.88,1,1):5.1f}")
    print(f"  left-strip={box(0,0,.22,1):5.1f}  center={box(.36,.2,.66,.8):5.1f}  right={box(.74,0,1,1):5.1f}")
