#!/usr/bin/env python3
"""Ingesta RSS/Atom de Pulso Comex (sin dependencias externas).

Qué hace en cada ejecución:
- Lee las fuentes habilitadas en sources.json (una fuente caída no frena a las demás).
- Filtra por relevancia COMEX y descarta notas viejas o casi duplicadas.
- Deduplica por enlace original normalizado: una noticia = una entrada, siempre.
- Conserva el ID (URL), la fecha y la imagen de las notas ya conocidas.
  Si la fuente no informa fecha, se usa la de la primera vez que se vio la nota (no se "renueva").
- Detecta países, categorías y si la nota menciona a Argentina.
- Toma la imagen que publica la propia fuente (RSS o etiqueta og:image), con crédito.
- Guarda todo en data/news.json y el estado de cada fuente en data/sources-status.json.

Las páginas, el sitemap y el RSS del sitio se generan después con scripts/build_pages.py.
"""
from __future__ import annotations

import email.utils
import html
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
NEWS = DATA / 'news.json'
STATUS = DATA / 'sources-status.json'
TZ = timezone(timedelta(hours=-3))
NOW = datetime.now(timezone.utc)
UA = 'Mozilla/5.0 (compatible; PulsoComexBot/1.1; +https://pulsocomex.com.ar)'

MAX_AGE_DAYS = 21          # al ingresar, ignorar notas más viejas que esto
ARCHIVE_DAYS = 365         # las notas automáticas se conservan un año
MAX_AUTO_ITEMS = 3000      # tope de notas automáticas en el archivo
MAX_OG_FETCH = 12          # páginas consultadas por fuente y corrida para buscar la imagen

# Taxonomía: debe coincidir con TOPICS en assets/app.js
TOPICS = ['Argentina', 'Latinoamérica', 'Estados Unidos', 'Europa', 'Asia', 'China', 'Mercosur', 'Importaciones',
          'Exportaciones', 'Aduanas', 'Aranceles', 'Impuestos', 'Tratados y acuerdos', 'Logística', 'Transporte marítimo',
          'Transporte aéreo', 'Puertos', 'Economía internacional', 'Geopolítica y comercio', 'Empresas', 'Regulaciones',
          'Tecnología COMEX']

RELEVANCE = ['comercio exterior', 'comercio internacional', 'comex', 'trade', 'export', 'import', 'arancel', 'tariff',
             'aduana', 'customs', 'mercosur', 'omc', 'wto', 'acuerdo comercial', 'free trade', 'tratado', 'logistic',
             'logistica', 'flete', 'freight', 'shipping', 'puerto', 'port ', 'contenedor', 'container', 'antidumping',
             'anti-dumping', 'salvaguardia', 'safeguard', 'cupo', 'cuota', 'balanza comercial', 'trade balance',
             'despachante', 'carga aerea', 'air cargo', 'naviera', 'supply chain', 'cadena de suministro', 'sanciones']

# País -> patrones (texto ya normalizado: minúsculas y sin acentos)
COUNTRIES = {
    'Argentina': [r'argentin', r'\barca\b', r'\bafip\b', r'\bindec\b', r'buenos aires', r'rosario', r'casa rosada', r'milei', r'caputo'],
    'Brasil': [r'brasil', r'brazil', r'brasilen', r'brazilian', r'lula\b', r'itamaraty'],
    'Uruguay': [r'uruguay'], 'Paraguay': [r'paraguay'], 'Chile': [r'\bchile'], 'Bolivia': [r'bolivia'],
    'Perú': [r'\bperu'], 'Colombia': [r'colombia'], 'México': [r'mexic'], 'Panamá': [r'panama'],
    'Estados Unidos': [r'estados unidos', r'eeuu', r'ee\.uu', r'united states', r'\bu\.s\.', r'washington', r'trump', r'\bustr\b', r'casa blanca', r'white house'],
    'Canadá': [r'canad'], 'China': [r'\bchina\b', r'chinese', r'chino', r'beijing', r'pekin', r'shanghai'],
    'Japón': [r'japon', r'japan'], 'India': [r'\bindia\b', r'indian'], 'Corea del Sur': [r'corea del sur', r'south korea', r'surcorean'],
    'Vietnam': [r'vietnam'], 'Indonesia': [r'indonesia'], 'Singapur': [r'singap'],
    'Unión Europea': [r'union europea', r'european union', r'\bue\b', r'\beu\b', r'comision europea', r'european commission', r'bruselas', r'brussels'],
    'Alemania': [r'alemania', r'german'], 'España': [r'espana', r'\bspain'], 'Francia': [r'francia', r'\bfrance', r'french'],
    'Italia': [r'italia', r'\bital'], 'Reino Unido': [r'reino unido', r'united kingdom', r'\buk\b', r'britan'],
    'Rusia': [r'rusia', r'russia'], 'Ucrania': [r'ucrania', r'ukrain'], 'Turquía': [r'turquia', r'turkey', r'turkiye'],
    'Arabia Saudita': [r'arabia saudita', r'saudi'], 'Emiratos Árabes Unidos': [r'emiratos', r'\buae\b', r'dubai'],
    'Irán': [r'\biran'], 'Sudáfrica': [r'sudafrica', r'south africa'], 'Australia': [r'australia'],
}
LATAM = {'Argentina', 'Brasil', 'Uruguay', 'Paraguay', 'Chile', 'Bolivia', 'Perú', 'Colombia', 'México', 'Panamá'}
EUROPE = {'Unión Europea', 'Alemania', 'España', 'Francia', 'Italia', 'Reino Unido', 'Rusia', 'Ucrania', 'Turquía'}
ASIA = {'China', 'Japón', 'India', 'Corea del Sur', 'Vietnam', 'Indonesia', 'Singapur'}

TOPIC_RULES = [
    ('Importaciones', [r'importa', r'\bimport']),
    ('Exportaciones', [r'exporta', r'\bexport']),
    ('Aduanas', [r'aduan', r'customs', r'despachante', r'\barca\b', r'\bsim\b', r'ventanilla unica']),
    ('Aranceles', [r'arancel', r'tariff', r'antidumping', r'anti-dumping', r'salvaguard', r'safeguard', r'derechos de exportacion', r'retenciones', r'represalia']),
    ('Impuestos', [r'impuesto', r'\biva\b', r'percepcion', r'tributo', r'\btax']),
    ('Tratados y acuerdos', [r'acuerdo', r'tratado', r'agreement', r'\bfta\b', r'negociacion', r'cupo', r'cuota']),
    ('Logística', [r'logistic', r'supply chain', r'cadena de suministro', r'flete', r'freight']),
    ('Transporte marítimo', [r'maritim', r'naviera', r'shipping', r'buque', r'vessel', r'contenedor', r'container', r'hidrovia', r'canal de panama', r'suez', r'ormuz']),
    ('Transporte aéreo', [r'carga aerea', r'air cargo', r'aereo', r'airline', r'\biata\b']),
    ('Puertos', [r'puerto', r'\bport\b', r'portuari', r'terminal']),
    ('Regulaciones', [r'resolucion', r'decreto', r'normativa', r'regulation', r'reglamento', r'boletin oficial', r'\brg\b']),
    ('Geopolítica y comercio', [r'sancion', r'sanction', r'guerra comercial', r'trade war', r'conflicto', r'geopolit']),
    ('Economía internacional', [r'\bomc\b', r'\bwto\b', r'comercio mundial', r'world trade', r'balanza', r'trade balance', r'\bpbi\b', r'\bgdp\b', r'\bfmi\b', r'\bimf\b']),
    ('Tecnología COMEX', [r'digitaliz', r'blockchain', r'inteligencia artificial', r'\bia\b', r'software']),
]
VISUAL_RULES = [
    ('plane', [r'carga aerea', r'air cargo', r'aereo', r'airline', r'\biata\b', r'aeropuerto']),
    ('tanker', [r'petrol', r'\boil\b', r'crudo', r'tanker', r'\bgnl\b', r'\blng\b', r'ormuz']),
    ('steel', [r'acero', r'steel', r'aluminio', r'aluminium', r'aluminum']),
    ('court', [r'tribunal', r'court', r'corte', r'justicia', r'fallo']),
    ('port', [r'puerto', r'\bport\b', r'terminal']),
    ('container', [r'contenedor', r'container', r'\bteu\b', r'\bfeu\b']),
    ('ship', [r'maritim', r'shipping', r'buque', r'vessel', r'naviera', r'flete']),
    ('customs', [r'aduan', r'customs', r'arancel', r'tariff', r'import', r'export']),
    ('treaty', [r'acuerdo', r'tratado', r'agreement', r'mercosur', r'\bomc\b', r'\bwto\b']),
    ('chart', [r'balanza', r'estadistic', r'statistic', r'indice', r'index', r'crecimiento', r'growth']),
]


# Imágenes que no son fotos de la nota: logos, imágenes por defecto, íconos.
BAD_IMAGE = re.compile(r'(logo|avatar|gravatar|pixel|spacer|1x1|blank|placeholder|fallback|default[-_.]|sprite|icon|favicon)', re.I)

# Términos fuertes: una nota de un agregador (Google Noticias) debe tener al menos uno.
# Evita falsos positivos como "contenedores de basura" o "puerto" en sentido no comercial.
STRONG = [r'comercio exterior', r'comercio internacional', r'\bcomex\b', r'exporta', r'importa', r'arancel', r'aduan',
          r'mercosur', r'\bomc\b', r'acuerdo comercial', r'tratado de libre comercio', r'balanza comercial', r'flete',
          r'naviera', r'transporte maritimo', r'carga aerea', r'logistica internacional', r'antidumping', r'salvaguardia',
          r'guerra comercial', r'cadena de suministro', r'portacontenedores', r'contenedores maritimos', r'\bteu\b',
          r'logistic', r'transito de (contenedores|mercaderia|carga)', r'(etapa|relacion|intercambio|socio|apertura) comercial']

# Etiquetas propias detectadas en el texto (las categorías de los feeds traían ruido: "inter", "ig", "Titulares"…)
TAG_RULES = [
    ('ARCA', [r'\barca\b']), ('Mercosur', [r'mercosur']), ('UE-Mercosur', [r'(ue|union europea)[- ]mercosur']),
    ('OMC', [r'\bomc\b', r'\bwto\b']), ('Fletes', [r'flete', r'freight']), ('Contenedores', [r'portacontenedores', r'contenedores maritimos', r'\bteu\b', r'\bfeu\b']),
    ('Acero', [r'acero', r'siderurg']), ('Aluminio', [r'aluminio']), ('Soja', [r'\bsoja']), ('Carne', [r'\bcarne']),
    ('Minería', [r'miner', r'\blitio', r'cobre']), ('Energía', [r'vaca muerta', r'petrol', r'\bgnl\b', r'\bgas\b']),
    ('Autos', [r'\bautos?\b', r'vehicul', r'automotr']), ('Agro', [r'agro', r'granos', r'cereal']),
    ('Cruceros', [r'crucer']), ('Puertos', [r'\bpuerto']), ('Medidas comerciales', [r'antidumping', r'salvaguard', r'represalia']),
    ('Aranceles', [r'arancel']), ('Estados Unidos', [r'estados unidos', r'eeuu', r'trump']), ('China', [r'\bchina\b']),
]


# ---------------------------------------------------------------- utilidades
def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


def clean_text(s: str) -> str:
    s = html.unescape(s or '')
    s = re.sub(r'<(script|style)[\s\S]*?</\1>', ' ', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()


def trim(s: str, n: int) -> str:
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(' ', 1)[0].rstrip(' ,.;:')
    return cut + '…'


def slug(s: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '-', norm(clean_text(s))).strip('-')
    return s[:80].rstrip('-') or 'nota'


def canonical_url(u: str) -> str:
    """Normaliza la URL para deduplicar: sin fragmento ni parámetros de seguimiento."""
    try:
        p = urlparse((u or '').strip())
    except ValueError:
        return (u or '').strip()
    if not p.scheme:
        return (u or '').strip()
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
         if not k.lower().startswith(('utm_', 'fbclid', 'gclid', 'mc_')) and k.lower() not in ('ref', 'source', 'oc')]
    path = p.path.rstrip('/') or '/'
    return urlunparse((p.scheme.lower(), p.netloc.lower(), path, '', urlencode(q), ''))


def parse_date(value):
    if not value:
        return None
    value = str(value).strip()
    try:
        dt = email.utils.parsedate_to_datetime(value)
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, IndexError):
        pass
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ if len(value) <= 10 else timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def any_match(text: str, patterns) -> bool:
    return any(re.search(p, text) for p in patterns)


def fetch(url: str, limit: int = 4_000_000, accept: str = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1') -> bytes:
    req = Request(url, headers={'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'es-AR,es;q=0.9,en;q=0.6'})
    with urlopen(req, timeout=25) as r:
        return r.read(limit)


# ---------------------------------------------------------------- RSS / Atom
def local(tag: str) -> str:
    return tag.split('}')[-1].lower()


def child_text(el, names):
    for child in el:
        if local(child.tag) in names:
            txt = ''.join(child.itertext()).strip()
            if txt:
                return txt
    return ''


def child_link(el):
    for child in el:
        if local(child.tag) == 'link':
            rel = child.attrib.get('rel', 'alternate')
            href = child.attrib.get('href')
            if href and rel == 'alternate':
                return href.strip()
            if (child.text or '').strip():
                return child.text.strip()
    for child in el:
        if local(child.tag) == 'guid' and child.attrib.get('isPermaLink', 'true') != 'false' and (child.text or '').startswith('http'):
            return child.text.strip()
    return ''


def feed_image(el, base: str) -> str:
    """Imagen que la propia fuente publica en el feed (media:content, media:thumbnail, enclosure o <img>)."""
    best, best_w = '', -1
    for child in el.iter():
        name = local(child.tag)
        url = child.attrib.get('url') or child.attrib.get('href') or ''
        typ = child.attrib.get('type', '')
        medium = child.attrib.get('medium', '')
        if name in ('content', 'thumbnail') and url and (medium == 'image' or typ.startswith('image') or name == 'thumbnail'
                                                        or re.search(r'\.(jpe?g|png|webp)(\?|$)', url, re.I)):
            w = int(child.attrib.get('width') or 0)
            if w > best_w:
                best, best_w = url, w
        elif name == 'enclosure' and url and typ.startswith('image'):
            if best_w < 0:
                best, best_w = url, 0
    if not best:
        raw = ''.join(child_text(el, [n]) for n in ('encoded', 'content', 'description', 'summary'))
        m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html.unescape(raw), re.I)
        if m:
            best = m.group(1)
    return absolute_image(best, base)


def absolute_image(url: str, base: str) -> str:
    if not url:
        return ''
    url = urljoin(base, html.unescape(url.strip()))
    if url.startswith('http://'):
        url = 'https://' + url[7:]
    if not url.startswith('https://') or BAD_IMAGE.search(url):
        return ''
    return url


def og_image(page_url: str) -> str:
    """Busca la imagen principal (og:image / twitter:image) en la página original."""
    try:
        raw = fetch(page_url, limit=600_000, accept='text/html,application/xhtml+xml').decode('utf-8', 'ignore')
    except Exception:
        return ''
    for prop in ('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'):
        for pat in (rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]*content=["\']([^"\']+)["\']',
                    rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']{re.escape(prop)}["\']'):
            m = re.search(pat, raw, re.I)
            if m:
                img = absolute_image(m.group(1), page_url)
                if img:
                    return img
    return ''


def parse_feed(raw: bytes, source: dict):
    root = ET.fromstring(raw)
    nodes = [x for x in root.iter() if local(x.tag) in ('item', 'entry')]
    out = []
    for n in nodes:
        title = clean_text(child_text(n, ['title']))
        link = child_link(n)
        if not title or not link:
            continue
        desc_raw = child_text(n, ['description', 'summary', 'encoded', 'content'])
        desc = clean_text(desc_raw)
        origin = ''
        if source.get('aggregator'):
            # Google News: "Título - Medio" y <source url="…">Medio</source>
            for child in n:
                if local(child.tag) == 'source':
                    origin = (child.text or '').strip()
            if origin and title.endswith(' - ' + origin):
                title = title[: -len(origin) - 3].strip()
            desc = ''  # la descripción del agregador solo repite el título
        pub = parse_date(child_text(n, ['pubdate', 'published', 'updated', 'date', 'issued']))
        author = clean_text(child_text(n, ['creator', 'author']))
        cats = [clean_text(c.text or c.attrib.get('term', '')) for c in n if local(c.tag) == 'category']
        out.append({'title': title, 'url': link, 'desc': desc, 'pub': pub, 'author': author, 'origin': origin,
                    'categories': [c for c in cats if c][:6], 'image': '' if source.get('aggregator') else feed_image(n, link)})
    return out


# ---------------------------------------------------------------- clasificación
def classify(text: str, source: dict):
    t = norm(text)
    countries = [c for c, pats in COUNTRIES.items() if any_match(t, pats)]
    topics = [name for name, pats in TOPIC_RULES if any_match(t, pats)]
    if 'Argentina' in countries:
        topics.insert(0, 'Argentina')
    if any(c in LATAM for c in countries if c != 'Argentina'):
        topics.append('Latinoamérica')
    if 'mercosur' in t:
        topics.append('Mercosur')
    if 'Estados Unidos' in countries:
        topics.append('Estados Unidos')
    if 'China' in countries:
        topics.append('China')
    if any(c in ASIA for c in countries):
        topics.append('Asia')
    if any(c in EUROPE for c in countries):
        topics.append('Europa')
    if not topics:  # las categorías por defecto de la fuente solo se usan si no se detectó ninguna
        topics.extend(source.get('topics', []))
    seen, clean = set(), []
    for x in topics:
        if x in TOPICS and x not in seen:
            seen.add(x)
            clean.append(x)
    if not clean:
        clean = ['Economía internacional']
    if not countries:
        countries = list(source.get('countries') or ['Global'])
    visual = next((v for v, pats in VISUAL_RULES if any_match(t, pats)), 'globe')
    affects = 'Argentina' in countries or 'mercosur' in t
    impact = 2 if affects and any(x in clean for x in ('Aranceles', 'Regulaciones', 'Aduanas', 'Impuestos')) else 1
    return clean[:5], countries[:5], visual, affects, impact


def make_tags(text: str, source: dict) -> list:
    t = norm(text)
    tags = list(source.get('tags') or []) + [name for name, pats in TAG_RULES if any_match(t, pats)]
    return list(dict.fromkeys(tags))[:5]


def strong(text: str) -> bool:
    return any_match(norm(text), STRONG)


def relevance(text: str) -> int:
    t = norm(text)
    return sum(1 for k in RELEVANCE if norm(k) in t)


def title_key(title: str) -> set:
    words = [w for w in re.findall(r'[a-z0-9]+', norm(title)) if len(w) > 3]
    return set(words)


def near_duplicate(title: str, recent: list) -> bool:
    a = title_key(title)
    if len(a) < 4:
        return False
    for b in recent:
        if b and len(a & b) / len(a | b) >= 0.6:
            return True
    return False


# ---------------------------------------------------------------- archivo
def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        print(f'Aviso: no se pudo leer {path.name}; se usa un archivo vacío.', file=sys.stderr)
        return default


def primary_url(it: dict) -> str:
    srcs = it.get('sources') or [{}]
    p = next((s for s in srcs if s.get('primary')), srcs[0])
    return p.get('url', '')


def main():
    sources = load_json(ROOT / 'sources.json', [])
    store = load_json(NEWS, {})
    status = load_json(STATUS, {})
    items = store.get('items', [])

    # Índices del archivo. Clave única: URL original normalizada.
    by_url, ids = {}, set()
    for it in items:
        if not it.get('title'):
            continue
        key = canonical_url(primary_url(it)) or it.get('id')
        if key in by_url:  # limpia duplicados heredados de versiones anteriores
            continue
        by_url[key] = it
        ids.add(it.get('id'))
    recent_titles = [title_key(it['title']) for it in by_url.values()
                     if (parse_date(it.get('datetime') or it.get('date')) or NOW) > NOW - timedelta(days=4)]

    report = []
    for src in sources:
        if not src.get('enabled', True):
            continue
        name = src['name']
        entry = {'source': name, 'url': src['url']}
        try:
            parsed = parse_feed(fetch(src['url']), src)
        except Exception as e:  # una fuente caída no frena a las demás
            st = status.get(name, {})
            st.update({'ok': False, 'lastError': str(e)[:200], 'lastRun': iso(NOW), 'failures': st.get('failures', 0) + 1})
            status[name] = st
            entry.update({'ok': False, 'error': str(e)[:200]})
            report.append(entry)
            continue

        added = updated = skipped = og_used = 0
        max_new = int(src.get('max_new', 15))  # tope de notas nuevas por fuente y corrida
        parsed.sort(key=lambda x: x['pub'] or NOW, reverse=True)
        for p in parsed:
            key = canonical_url(p['url'])
            text = ' '.join([p['title'], p['desc'], ' '.join(p['categories'])])
            old = by_url.get(key)
            if old and old.get('label') != 'Automática':
                continue  # nunca pisar una nota curada a mano
            if not old:
                if p['pub'] and p['pub'] < NOW - timedelta(days=MAX_AGE_DAYS):
                    skipped += 1
                    continue
                if src.get('min_relevance', 0) and relevance(text) < src['min_relevance']:
                    skipped += 1
                    continue
                if src.get('aggregator') and not strong(p['title']):
                    skipped += 1
                    continue
                if near_duplicate(p['title'], recent_titles) or added >= max_new:
                    skipped += 1
                    continue

            first_seen = parse_date((old or {}).get('firstSeen')) or NOW
            pub = p['pub'] or parse_date((old or {}).get('datetime')) or first_seen
            if pub > NOW + timedelta(hours=1):
                pub = NOW
            topics, countries, visual, affects, impact = classify(text, src)

            if old:
                item_id = old['id']
            else:
                base = slug(p['title'])
                item_id, n = base, 2
                while item_id in ids:
                    item_id = f'{base[:76]}-{n}'
                    n += 1
                ids.add(item_id)

            source_name = p['origin'] or name
            photo = (old or {}).get('photo')
            if not photo and src.get('use_source_images', True):
                img = p['image']
                if not img and src.get('fetch_og') and og_used < MAX_OG_FETCH and not old:
                    og_used += 1
                    img = og_image(p['url'])
                if img:
                    photo = {'src': img, 'by': source_name, 'page': p['url'], 'alt': p['title'][:140]}

            summary = trim(p['desc'], 320) if p['desc'] else (
                f'Nota publicada por {source_name}. Abrí el artículo original para leer el texto completo.')
            item = {
                'id': item_id,
                'datetime': iso(pub),
                'date': pub.astimezone(TZ).date().isoformat(),
                'firstSeen': iso(first_seen),
                'title': trim(p['title'], 180),
                'summary': summary,
                'body': [trim(p['desc'], 900)] if len(p['desc']) > 320 else [],
                'keyData': [],
                'topics': topics,
                'countries': countries,
                'tags': make_tags(text, src),
                'visual': visual,
                'impact': impact,
                'affectsArgentina': affects,
                'kind': 'noticia',
                'label': 'Automática',
                'feed': name,
                'sources': [{
                    'name': source_name,
                    'type': src.get('type', 'Fuente externa') if not p['origin'] else f"Medio · vía {name.split('·')[0].strip()}",
                    'url': p['url'],
                    'primary': True,
                    'author': p['author'],
                }],
            }
            if photo:
                item['photo'] = photo
            if old:
                if old.get('title') != item['title']:
                    item['updated'] = iso(NOW)
                elif old.get('updated'):
                    item['updated'] = old['updated']
                if any(old.get(k) != item.get(k) for k in ('title', 'summary', 'datetime', 'photo')):
                    updated += 1
            else:
                added += 1
                recent_titles.append(title_key(p['title']))
            by_url[key] = item

        status[name] = {'ok': True, 'lastRun': iso(NOW), 'lastOk': iso(NOW), 'failures': 0,
                        'items': len(parsed), 'added': added}
        entry.update({'ok': True, 'items': len(parsed), 'added': added, 'updated': updated, 'skipped': skipped})
        report.append(entry)

    # Limpieza de notas automáticas ya guardadas (aplica las reglas actuales a lo que entró antes).
    disabled = {s['name'] for s in sources if not s.get('enabled', True)}
    aggregators = {s['name'] for s in sources if s.get('aggregator')}
    for key in list(by_url):
        it = by_url[key]
        if it.get('label') != 'Automática':
            continue
        feed = it.get('feed') or (it.get('sources') or [{}])[0].get('name', '')
        via_aggregator = feed in aggregators or 'vía Google Noticias' in (it.get('sources') or [{}])[0].get('type', '')
        if feed in disabled or (via_aggregator and not strong(it.get('title', ''))):
            del by_url[key]
            continue
        ph = it.get('photo') or {}
        if ph.get('src') and BAD_IMAGE.search(ph['src']):
            it.pop('photo', None)
        it['tags'] = make_tags(' '.join([it.get('title', ''), it.get('summary', '')]), {})

    # Archivo: notas automáticas hasta un año y con tope; las curadas no se borran.
    cutoff = NOW - timedelta(days=ARCHIVE_DAYS)
    kept = []
    for it in by_url.values():
        dt = parse_date(it.get('datetime') or it.get('date'))
        if it.get('label') == 'Automática' and dt and dt < cutoff:
            continue
        kept.append(it)
    kept.sort(key=lambda x: parse_date(x.get('datetime') or x.get('date')) or NOW, reverse=True)
    auto = [i for i in kept if i.get('label') == 'Automática']
    if len(auto) > MAX_AUTO_ITEMS:
        drop = {id(i) for i in auto[MAX_AUTO_ITEMS:]}
        kept = [i for i in kept if id(i) not in drop]

    before = json.dumps(items, ensure_ascii=False, sort_keys=True)
    after = json.dumps(kept, ensure_ascii=False, sort_keys=True)
    store.update({'schemaVersion': '2.1', 'feedId': 'pulso-comex', 'timezone': 'America/Argentina/Buenos_Aires', 'items': kept})
    if before != after or not store.get('updatedAt'):
        store['updatedAt'] = iso(NOW)
    store['ingestion'] = {'ranAt': iso(NOW), 'sources': report}
    NEWS.write_text(json.dumps(store, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    STATUS.write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    ok = sum(1 for r in report if r.get('ok'))
    new = sum(r.get('added', 0) for r in report)
    print(f'Fuentes OK: {ok}/{len(report)} · notas nuevas: {new} · total en archivo: {len(kept)}')
    for r in report:
        print(('  ✔ ' if r.get('ok') else '  ✘ ') + r['source'] + (f" · {r.get('items', 0)} leídas, {r.get('added', 0)} nuevas" if r.get('ok') else f" · {r.get('error')}"))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write(f'## Actualización de noticias\n\n**{new}** notas nuevas · **{ok}/{len(report)}** fuentes respondieron · {len(kept)} notas en el archivo\n\n')
            f.write('| Fuente | Estado | Leídas | Nuevas | Detalle |\n|---|---|---|---|---|\n')
            for r in report:
                f.write(f"| {r['source']} | {'✔' if r.get('ok') else '✘'} | {r.get('items', '')} | {r.get('added', '')} | {r.get('error', '') if not r.get('ok') else ''} |\n")


if __name__ == '__main__':
    main()
