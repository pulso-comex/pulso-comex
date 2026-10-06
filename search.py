"""Busca en Wikimedia Commons fotos de dominio público o CC0 (sin restricciones) y arma hojas de contacto para revisar."""
import io, json, re, sys, time, urllib.parse
from urllib.request import Request, urlopen
from PIL import Image, ImageDraw, ImageFont

UA = 'PulsoComexPhotoSearch/1.0 (https://pulso-comex.github.io; pulso.comex26@gmail.com)'
API = 'https://commons.wikimedia.org/w/api.php'
QUERIES = {
  'customs': ['customs cargo inspection container', 'cargo x-ray scanner container', 'trucks border crossing freight', 'customs officer inspecting shipment', 'warehouse pallets forklift', 'freight trucks queue border'],
  'treaty': ['flags of the world row', 'Mercosur flags', 'World Trade Organization headquarters Geneva', 'flags of South American countries'],
  'port': ['container terminal gantry cranes', 'port of Buenos Aires containers', 'container port aerial', 'port of Santos', 'container cranes port night'],
  'agro': ['grain elevator ship loading', 'soybean harvest combine', 'soybeans close', 'wheat harvest combine', 'grain terminal port', 'corn harvest field'],
  'mining': ['lithium brine evaporation ponds', 'open pit copper mine', 'salar lithium', 'mining trucks open pit'],
  'globe': ['Earth from space Americas', 'Earth night lights from space', 'globe Earth blue marble'],
  'ship': ['container ship at sea', 'cargo ship underway', 'bulk carrier at sea'],
  'container': ['shipping containers stacked', 'intermodal containers yard', 'container train'],
  'tanker': ['oil tanker underway', 'LNG carrier ship', 'crude oil tanker'],
  'plane': ['cargo aircraft loading airport', 'air cargo pallets airport', 'freighter aircraft'],
  'steel': ['steel coils', 'steel mill hot rolling', 'aluminium ingots'],
  'chart': ['stock exchange trading floor', 'financial charts screen'],
}
PD_FILTERS = ['haswbstatement:P6216=Q19652', 'haswbstatement:P275=Q6938433']
BAD_RESTR = re.compile(r'personality|trademark|insignia|ngo|costume|currency|statue|design', re.I)

def api(params):
    params = {**params, 'format': 'json', 'formatversion': '2'}
    req = Request(API + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for i in range(3):
        try:
            with urlopen(req, timeout=40) as r:
                return json.load(r)
        except Exception as e:
            time.sleep(3 * (i + 1)); err = e
    raise err

def license_ok(m):
    lic = (m.get('LicenseShortName', {}).get('value') or '').strip()
    l = lic.lower()
    ok = l.startswith('public domain') or l.startswith('pd') or l == 'cc0' or l.startswith('cc0') or 'cc-zero' in l
    restr = m.get('Restrictions', {}).get('value') or ''
    nonfree = (m.get('NonFree', {}).get('value') or '').lower() == 'true'
    return ok and not nonfree and not BAD_RESTR.search(restr), lic, restr

def strip(h):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', h or '')).strip()

out = {}
seen = set()
for cat, qs in QUERIES.items():
    found = []
    for q in qs:
        for f in PD_FILTERS:
            try:
                d = api({'action': 'query', 'generator': 'search', 'gsrnamespace': 6, 'gsrsearch': f'{q} filetype:bitmap {f}',
                         'gsrlimit': 20, 'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata|mime', 'iiurlwidth': 480})
            except Exception as e:
                print('error', q, e, file=sys.stderr); continue
            for p in (d.get('query') or {}).get('pages', []):
                ii = (p.get('imageinfo') or [{}])[0]
                t = p['title']
                if t in seen or ii.get('mime') not in ('image/jpeg', 'image/png'):
                    continue
                w, h = ii.get('width', 0), ii.get('height', 0)
                if w < 1600 or w < h * 1.25:
                    continue
                ok, lic, restr = license_ok(ii.get('extmetadata') or {})
                if not ok:
                    continue
                m = ii['extmetadata']
                seen.add(t)
                found.append({'title': t, 'thumb': ii.get('thumburl'), 'url': ii.get('url'), 'page': ii.get('descriptionurl'),
                              'w': w, 'h': h, 'license': lic, 'restrictions': restr,
                              'artist': strip(m.get('Artist', {}).get('value'))[:120],
                              'credit': strip(m.get('Credit', {}).get('value'))[:160],
                              'desc': strip(m.get('ImageDescription', {}).get('value'))[:300],
                              'categories': strip(m.get('Categories', {}).get('value'))[:300], 'q': q})
            time.sleep(0.5)
    out[cat] = found[:30]
    print(cat, len(found))

json.dump(out, open('candidates.json', 'w'), ensure_ascii=False, indent=1)

# Hojas de contacto: 4 columnas x 3 filas por hoja, numeradas
font = ImageFont.load_default(size=22) if hasattr(ImageFont, 'load_default') else None
for cat, lst in out.items():
    tiles = []
    for i, c in enumerate(lst):
        try:
            req = Request(c['thumb'], headers={'User-Agent': UA})
            im = Image.open(io.BytesIO(urlopen(req, timeout=40).read())).convert('RGB')
            im.thumbnail((480, 300)); tiles.append((i, im))
        except Exception as e:
            print('thumb error', c['title'], e, file=sys.stderr)
        time.sleep(0.3)
    for s in range(0, len(tiles), 12):
        chunk = tiles[s:s + 12]
        sheet = Image.new('RGB', (4 * 490, 3 * 340), 'white'); d = ImageDraw.Draw(sheet)
        for k, (i, im) in enumerate(chunk):
            x, y = (k % 4) * 490 + 5, (k // 4) * 340 + 5
            sheet.paste(im, (x, y + 30)); d.text((x, y), f'#{i}', fill='red', font=font)
        sheet.save(f'sheet-{cat}-{s // 12}.jpg', quality=80)
