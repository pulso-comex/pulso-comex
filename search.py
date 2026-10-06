# Prueba de descarga: usa fetch_photos.fetch_variant con las fotos nuevas y arma una hoja de contacto.
import json, io, sys
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, '.')
import fetch_photos as fp
bank = json.load(open('photos.json'))
rows, tiles = [], []
for cat, lst in bank.items():
    for p in lst:
        if not p['id'].startswith('wm-'):
            continue
        try:
            data = fp.fetch_variant(p, 800)
            im = Image.open(io.BytesIO(data)); rows.append(f"OK {cat} {p['id']} {im.size} {len(data)//1024}KB")
            t = im.copy(); t.thumbnail((360, 240)); tiles.append((f"{cat}:{p['id'][3:9]}", t))
        except Exception as e:
            rows.append(f"FAIL {cat} {p['id']} {e}")
open('download-report.txt', 'w').write('\n'.join(rows) + '\n')
sheet = Image.new('RGB', (6 * 370, ((len(tiles) + 5) // 6) * 270), 'white'); d = ImageDraw.Draw(sheet)
for k, (lab, t) in enumerate(tiles):
    x, y = (k % 6) * 370 + 5, (k // 6) * 270 + 5
    sheet.paste(t, (x, y + 22)); d.text((x, y), lab, fill='red')
sheet.save('sheet-final.jpg', quality=80)
