#!/usr/bin/env python3
"""Genera el sitio estático de Pulso Comex a partir de templates/page.html y data/news.json.

Salidas:
- index.html                 portada (con las últimas notas embebidas como respaldo)
- noticias/<id>/index.html   una página liviana por nota, con su propio título, descripción,
                             imagen para redes (Open Graph) y texto visible sin JavaScript
- data/latest.json           feed que lee la página (notas recientes, con tope de tamaño)
- sitemap.xml, news-sitemap.xml, feed.xml
También borra las carpetas de /noticias/ cuyas notas ya no están en el archivo.

Para cambiar el diseño o la estructura, editá templates/page.html, assets/app.css o assets/app.js
y volvé a ejecutar este script (el workflow lo hace solo). No edites index.html a mano.
"""
from __future__ import annotations

import email.utils
import hashlib
import html
import json
import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Dirección pública del sitio. El workflow la detecta sola desde GitHub Pages (github.io o dominio propio).
def detect_site() -> str:
    """Dirección pública del sitio, sin configurar nada:
    1) SITE_URL si el workflow la pasa; 2) dominio propio del archivo CNAME;
    3) la dirección de GitHub Pages según el repositorio (usuario.github.io o usuario.github.io/repo)."""
    if os.environ.get('SITE_URL'):
        return os.environ['SITE_URL']
    cname = ROOT / 'CNAME'
    if cname.exists() and cname.read_text(encoding='utf-8').strip():
        return 'https://' + cname.read_text(encoding='utf-8').strip().split()[0]
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    if '/' in repo:
        owner, name = repo.split('/', 1)
        owner = owner.lower()
        return f'https://{owner}.github.io' if name.lower() == f'{owner}.github.io' else f'https://{owner}.github.io/{name}'
    return 'https://pulso-comex.github.io'


SITE = detect_site().rstrip('/')
SITE_NAME = 'Pulso Comex'
TZ = timezone(timedelta(hours=-3))
NOW = datetime.now(timezone.utc)
INDEX_AUTOMATIC = False   # las notas automáticas (solo enlazan a otro medio) no se indexan en buscadores
LATEST_MAX = 400          # notas incluidas en data/latest.json
INLINE_MAX = 40           # notas embebidas en la portada como respaldo
HOME_TITLE = 'Pulso Comex · Noticias de Comercio Exterior'
HOME_DESC = ('Portal de noticias de comercio exterior: aranceles, aduanas, acuerdos comerciales, logística, puertos e '
             'indicadores, con foco en Argentina y el Mercosur. Cada nota enlaza a su fuente original.')
OG_DEFAULT = f'{SITE}/og-default.png'

esc = lambda s: html.escape(str(s or ''), quote=True)


def load_site_config():
    """site.json: correo, responsable, Google Analytics, verificación de Search Console, newsletter y redes."""
    f = ROOT / 'site.json'
    try:
        cfg = json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}
    except ValueError as e:
        print(f'Aviso: site.json tiene un error de formato y se ignora ({e}).')
        cfg = {}
    cfg.pop('_ayuda', None)
    email = str(cfg.get('contactEmail') or '').strip()
    cfg['contactEmail'] = email if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email) else ''
    ga = str(cfg.get('googleAnalyticsId') or '').strip().upper()
    cfg['googleAnalyticsId'] = ga if re.fullmatch(r'G-[A-Z0-9]{4,20}', ga) else ''
    ver = str(cfg.get('googleSiteVerification') or '').strip()
    m = re.search(r'content=["\']([^"\']+)["\']', ver)   # acepta la etiqueta completa o solo el código
    cfg['googleSiteVerification'] = re.sub(r'[^A-Za-z0-9_\-]', '', m.group(1) if m else ver)
    nl = cfg.get('newsletter') or {}
    cfg['newsletter'] = {k: str(nl.get(k) or '').strip() for k in ('formAction', 'url')
                         if str(nl.get(k) or '').strip().startswith('https://')}
    cfg['redes'] = [r for r in (cfg.get('redes') or []) if str(r.get('url') or '').startswith('https://')]
    resp = cfg.get('responsable') or {}
    cfg['responsable'] = {k: str(resp.get(k) or '').strip() for k in ('nombre', 'rol', 'descripcion', 'linkedin')}
    return cfg


SITECFG = load_site_config()


def parse_date(v):
    if not v:
        return None
    v = str(v)
    try:
        dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(timezone.utc)


def item_dt(it):
    return parse_date(it.get('datetime')) or parse_date(it.get('date')) or NOW


def js_hash(s: str) -> int:
    """Mismo hash que assets/app.js, para que la foto de la página y la de redes coincidan."""
    h = 0
    for ch in s:
        cp = ord(ch)
        unit = cp if cp < 0x10000 else 0xD800 + ((cp - 0x10000) >> 10)  # c.charCodeAt(0) en JS
        h = (h * 31 + unit) & 0xFFFFFFFF
    if h >= 2 ** 31:
        h -= 2 ** 32
    return abs(h)


def json_script(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def load():
    news = json.loads((ROOT / 'data' / 'news.json').read_text(encoding='utf-8'))
    bank = json.loads((ROOT / 'data' / 'photos.json').read_text(encoding='utf-8'))
    status_f = ROOT / 'img' / 'stock' / 'status.json'
    status = json.loads(status_f.read_text(encoding='utf-8')) if status_f.exists() else {}
    front = {}
    for k, photos in bank.items():
        out = []
        for p in photos:
            if status.get(p['id']) == 'missing':
                continue
            q = {x: p[x] for x in ('src', 'by', 'page', 'alt')}
            big, small = ROOT / 'img/stock' / f"{p['id']}-1600.jpg", ROOT / 'img/stock' / f"{p['id']}-800.jpg"
            if big.exists() and small.exists():
                q['local'] = f"/img/stock/{p['id']}-1600.jpg"
                q['localSmall'] = f"/img/stock/{p['id']}-800.jpg"
            out.append(q)
        if out:
            front[k] = out
    return news, front


def photo_for(it, bank):
    p = it.get('photo') or {}
    if p.get('src'):
        return p['src'], p.get('alt') or it['title'], True
    photos = bank.get(it.get('visual')) or bank.get('globe') or []
    if not photos:
        return OG_DEFAULT, SITE_NAME, False
    q = photos[js_hash(it['id']) % len(photos)]
    src = SITE + q['local'] if q.get('local') else f"{q['src']}?auto=format&fit=crop&w=1200&h=630&q=70&fm=jpg"
    return src, q.get('alt', ''), False


def primary(it):
    srcs = it.get('sources') or [{}]
    return next((s for s in srcs if s.get('primary')), srcs[0])


def category(it):
    return next((t for t in it.get('topics', []) if t != 'Argentina'), (it.get('topics') or ['Comercio exterior'])[0])


def is_auto(it):
    return it.get('label') == 'Automática'


def meta_block(*, title, desc, url, image, image_alt, og_type='website', robots='index,follow,max-image-preview:large',
               ld=None, extra='', image_size=None, base=''):
    lines = [
        f'<title>{esc(title)}</title>',
        f'<meta name="description" content="{esc(desc)}">',
        f'<meta name="robots" content="{robots}">',
        '<meta name="author" content="Pulso Comex">',
        '<meta name="application-name" content="Pulso Comex">',
        '<meta name="referrer" content="strict-origin-when-cross-origin">',
        f'<link rel="icon" href="{base}favicon.svg" type="image/svg+xml">',
        f'<link rel="apple-touch-icon" href="{base}apple-touch-icon.png">',
        f'<link rel="alternate" type="application/rss+xml" title="Pulso Comex · Noticias" href="{base}feed.xml">',
        '<meta name="theme-color" content="#0B2545">',
        f'<link rel="canonical" id="canonical" href="{esc(url)}">',
        f'<meta property="og:type" content="{og_type}">',
        '<meta property="og:site_name" content="Pulso Comex">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        '<meta property="og:locale" content="es_AR">',
        f'<meta property="og:image" content="{esc(image)}">',
        f'<meta property="og:image:alt" content="{esc(image_alt)}">',
    ]
    if image_size:
        lines += [f'<meta property="og:image:width" content="{image_size[0]}">', f'<meta property="og:image:height" content="{image_size[1]}">']
    lines += [
        f'<meta property="og:url" content="{esc(url)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(title)}">',
        f'<meta name="twitter:description" content="{esc(desc)}">',
        f'<meta name="twitter:image" content="{esc(image)}">',
    ]
    if SITECFG.get('googleSiteVerification'):
        lines.append(f'<meta name="google-site-verification" content="{esc(SITECFG["googleSiteVerification"])}">')
    ga = SITECFG.get('googleAnalyticsId')
    if ga:  # las páginas vistas se envían desde assets/app.js en cada cambio de sección
        lines.append(f'<script async src="https://www.googletagmanager.com/gtag/js?id={ga}"></script>')
        lines.append("<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}"
                     f"gtag('js',new Date());gtag('config','{ga}',{{send_page_view:false}});</script>")
    if extra:
        lines.append(extra)
    lines.append(f'<script type="application/ld+json" id="ld">{json_script(ld or {})}</script>')
    return '\n'.join(lines)


def fmt_day(dt):
    meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    d = dt.astimezone(TZ)
    return f'{d.day} de {meses[d.month - 1]} de {d.year}'


def prerender_article(it, img, img_alt, source_img):
    p = primary(it)
    body = it.get('body') or [it.get('summary', '')]
    credit = f'Imagen: {esc(p.get("name"))}' if source_img else 'Foto de archivo ilustrativa'
    return f'''    <article class="pre-article">
      <p class="pre-meta"><a href="../../">Noticias</a> · {esc(category(it))} · <time datetime="{esc(it.get('datetime') or it.get('date'))}">{fmt_day(item_dt(it))}</time></p>
      <h1>{esc(it['title'])}</h1>
      <p class="lede">{esc(it.get('summary'))}</p>
      <p class="pre-meta">Fuente: <a href="{esc(p.get('url'))}" rel="noopener noreferrer">{esc(p.get('name'))}</a></p>
      <img src="{esc(img)}" alt="{esc(img_alt)}" width="1200" height="675"{' referrerpolicy="no-referrer"' if source_img else ''}>
      <p class="pre-meta">{credit}</p>
      {''.join(f'<p>{esc(x)}</p>' for x in body)}
      <p><a href="{esc(p.get('url'))}" rel="noopener noreferrer">Leer el original en {esc(p.get('name'))}</a></p>
    </article>
'''


def feed_payload(news, items):
    return {k: news.get(k) for k in ('schemaVersion', 'feedId', 'updatedAt', 'timezone', 'editorialNote', 'indicators', 'stories') if k in news} | {'items': items}


def render(template, *, meta, prerender, feed, bank, version, base=''):
    """prerender: función que recibe el contenido por defecto de <main> (el esqueleto de carga) y devuelve el final."""
    a, b = template.index('<!--meta:start-->'), template.index('<!--meta:end-->') + len('<!--meta:end-->')
    page = template[:a] + meta + template[b:]
    a, b = page.index('<!--mail:start-->'), page.index('<!--mail:end-->') + len('<!--mail:end-->')
    email = SITECFG.get('contactEmail')
    page = page[:a] + (page[a + 17:b - 15].replace('{{CONTACT_EMAIL}}', esc(email)) if email else '') + page[b:]
    start, end = '<!--prerender:start-->', '<!--prerender:end-->'
    a, b = page.index(start), page.index(end)
    page = page[:a] + prerender(page[a + len(start):b]) + page[b + len(end):]
    return (page.replace('{{PHOTO_BANK}}', json_script(bank))
                .replace('{{FEED}}', json_script(feed))
                .replace('{{ASSET_VERSION}}', version)
                .replace('{{BASE}}', base)
                .replace('{{SITE_CONFIG}}', json_script(SITECFG)))


def main():
    template = (ROOT / 'templates' / 'page.html').read_text(encoding='utf-8')
    news, bank = load()
    items = sorted([i for i in news.get('items', []) if i.get('id') and i.get('title')], key=item_dt, reverse=True)
    version = hashlib.sha1((ROOT / 'assets/app.js').read_bytes() + (ROOT / 'assets/app.css').read_bytes()).hexdigest()[:10]

    # Feed para la página: todas las curadas + las automáticas más recientes, con tope.
    curated = [i for i in items if not is_auto(i)]
    latest = sorted(curated + [i for i in items if is_auto(i)][:max(0, LATEST_MAX - len(curated))], key=item_dt, reverse=True)
    (ROOT / 'data' / 'latest.json').write_text(json.dumps(feed_payload(news, latest), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    # Portada
    org_ld = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'NewsMediaOrganization', '@id': f'{SITE}/#org', 'name': SITE_NAME, 'url': f'{SITE}/', 'logo': f'{SITE}/favicon.svg',
         'description': 'Portal de noticias, datos y análisis sobre comercio exterior, con foco en Argentina y Latinoamérica.', 'inLanguage': 'es-AR'},
        {'@type': 'WebSite', '@id': f'{SITE}/#web', 'name': SITE_NAME, 'url': f'{SITE}/', 'inLanguage': 'es-AR', 'publisher': {'@id': f'{SITE}/#org'},
         'potentialAction': {'@type': 'SearchAction', 'target': f'{SITE}/#buscar?q={{q}}', 'query-input': 'required name=q'}}]}
    headlines = ''.join(
        f'<li><a href="noticias/{esc(i["id"])}/">{esc(i["title"])}</a><small>{esc(primary(i).get("name"))} · {fmt_day(item_dt(i))}</small></li>'
        for i in items[:30])
    noscript = f'    <noscript><h2>Últimas noticias</h2><ul class="pre-list">{headlines}</ul></noscript>\n'
    home = render(template, meta=meta_block(title=HOME_TITLE, desc=HOME_DESC, url=f'{SITE}/', image=OG_DEFAULT,
                                            image_alt='Pulso Comex · Noticias de Comercio Exterior', ld=org_ld, image_size=(1200, 630)),
                  prerender=lambda inner: inner + noscript, feed=feed_payload(news, items[:INLINE_MAX]), bank=bank, version=version)
    # La portada lleva el CSS y el JS embebidos: así funciona sola, incluso abierta con doble clic
    # desde adentro del zip (Windows extrae solo ese archivo). Las páginas de notas usan /assets/.
    css = (ROOT / 'assets' / 'app.css').read_text(encoding='utf-8')
    js = (ROOT / 'assets' / 'app.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
    home = re.sub(r'<link rel="stylesheet" href="assets/app\.css\?v=[^"]*">', lambda _: f'<style>\n{css}</style>', home, count=1)
    home = re.sub(r'<script src="assets/app\.js\?v=[^"]*" defer></script>', lambda _: f'<script>\n{js}</script>', home, count=1)
    assert '<style>' in home and 'src="assets/app.js' not in home, 'no se pudo embeber CSS/JS en la portada'
    (ROOT / 'index.html').write_text(home, encoding='utf-8')

    # Una página por nota
    out_dir = ROOT / 'noticias'
    out_dir.mkdir(exist_ok=True)
    ids = set()
    for it in items:
        ids.add(it['id'])
        url = f'{SITE}/noticias/{it["id"]}/'
        img, img_alt, source_img = photo_for(it, bank)
        p = primary(it)
        robots = 'noindex,follow' if is_auto(it) and not INDEX_AUTOMATIC else 'index,follow,max-image-preview:large'
        ld = {'@context': 'https://schema.org', '@graph': [{
            '@type': 'NewsArticle', 'headline': it['title'][:110], 'description': it.get('summary', ''), 'image': [img],
            'datePublished': it.get('datetime') or it.get('date'), 'dateModified': it.get('updated') or it.get('datetime') or it.get('date'),
            'inLanguage': 'es-AR', 'mainEntityOfPage': url, 'articleSection': category(it),
            'keywords': ', '.join(it.get('tags', []) + it.get('topics', [])),
            'author': {'@type': 'Organization', 'name': f'{SITE_NAME} · Redacción', 'url': f'{SITE}/'},
            'publisher': {'@type': 'NewsMediaOrganization', 'name': SITE_NAME, 'logo': {'@type': 'ImageObject', 'url': f'{SITE}/favicon.svg'}},
            'isBasedOn': [{'@type': 'CreativeWork', 'url': s.get('url'), 'publisher': {'@type': 'Organization', 'name': s.get('name')}} for s in it.get('sources', [])],
        }]}
        extra = '\n'.join([f'<meta property="article:published_time" content="{esc(it.get("datetime") or it.get("date"))}">',
                           f'<meta property="article:section" content="{esc(category(it))}">'])
        meta = meta_block(title=f'{it["title"]} · {SITE_NAME}', desc=it.get('summary') or it['title'], url=url, image=img,
                          image_alt=img_alt, og_type='article', robots=robots, ld=ld, extra=extra, base='../../')
        pre = prerender_article(it, img, img_alt, source_img)
        page = render(template, meta=meta, prerender=lambda inner: pre,
                      feed=feed_payload(news, [it]), bank=bank, version=version, base='../../')
        d = out_dir / it['id']
        d.mkdir(parents=True, exist_ok=True)
        (d / 'index.html').write_text(page, encoding='utf-8')
    removed = 0
    for d in out_dir.iterdir():
        if d.is_dir() and d.name not in ids:
            shutil.rmtree(d)
            removed += 1

    # Sitemaps y RSS
    indexable = [i for i in items if INDEX_AUTOMATIC or not is_auto(i)]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          f'  <url><loc>{SITE}/</loc><lastmod>{esc(news.get("updatedAt") or NOW.isoformat())}</lastmod><changefreq>hourly</changefreq></url>']
    for it in indexable:
        sm.append(f'  <url><loc>{SITE}/noticias/{esc(it["id"])}/</loc><lastmod>{esc(it.get("updated") or it.get("datetime") or it.get("date"))}</lastmod></url>')
    sm.append('</urlset>')
    (ROOT / 'sitemap.xml').write_text('\n'.join(sm) + '\n', encoding='utf-8')

    ns = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">']
    for it in [i for i in indexable if item_dt(i) >= NOW - timedelta(days=2)][:1000]:
        ns.append(f'  <url><loc>{SITE}/noticias/{esc(it["id"])}/</loc><news:news><news:publication><news:name>{SITE_NAME}</news:name>'
                  f'<news:language>es</news:language></news:publication><news:publication_date>{item_dt(it).isoformat()}</news:publication_date>'
                  f'<news:title>{esc(it["title"])}</news:title></news:news></url>')
    ns.append('</urlset>')
    (ROOT / 'news-sitemap.xml').write_text('\n'.join(ns) + '\n', encoding='utf-8')

    rss = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
           f'<title>{SITE_NAME} · Noticias</title><link>{SITE}/</link><description>Noticias y actualidad del comercio exterior.</description>',
           f'<language>es-ar</language><lastBuildDate>{email.utils.format_datetime(NOW)}</lastBuildDate>',
           f'<atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml"/>']
    for it in items[:50]:
        u = f'{SITE}/noticias/{it["id"]}/'
        rss.append(f'<item><title>{esc(it["title"])}</title><link>{u}</link><guid isPermaLink="true">{u}</guid>'
                   f'<pubDate>{email.utils.format_datetime(item_dt(it))}</pubDate><source url="{esc(primary(it).get("url"))}">{esc(primary(it).get("name"))}</source>'
                   f'<description>{esc(it.get("summary", ""))}</description></item>')
    rss.append('</channel></rss>')
    (ROOT / 'feed.xml').write_text('\n'.join(rss) + '\n', encoding='utf-8')
    (ROOT / 'robots.txt').write_text(f'User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\nSitemap: {SITE}/news-sitemap.xml\n', encoding='utf-8')

    print(f'Páginas generadas: {len(items)} · carpetas viejas borradas: {removed} · en latest.json: {len(latest)} · '
          f'fotos de archivo locales: {sum(1 for v in bank.values() for p in v if p.get("local"))}')


if __name__ == '__main__':
    main()
