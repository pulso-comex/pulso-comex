#!/usr/bin/env python3
"""Arma el newsletter semanal de Pulso Comex (HTML para correo) a partir de data/news.json.

Uso:  python scripts/newsletter.py [salida.html] [--dias 7]

Toma solo notas curadas (verificadas) de los últimos días, ordenadas por impacto; suma el bloque
«Qué cambia para Argentina», los indicadores, las próximas fechas y el patrocinio de site.json
(patrocinios.newsletter), siempre identificado como «Publicidad». El HTML usa tablas y estilos en línea
porque así lo exigen los clientes de correo (Gmail, Outlook). {$unsubscribe} es la etiqueta de baja de MailerLite.
"""
from __future__ import annotations

import html
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://pulso-comex.github.io'
TZ = timezone(timedelta(hours=-3))
MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
NAVY, ACCENT, INK, MUTED, LINE, BG = '#0B2140', '#1EC8B5', '#0E1B2C', '#5E6C80', '#DAE0E8', '#F2F4F7'
esc = lambda s: html.escape(str(s or ''), quote=True)


def fecha_larga(d: date) -> str:
    return f'{d.day} de {MESES[d.month - 1]} de {d.year}'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dias = int(sys.argv[sys.argv.index('--dias') + 1]) if '--dias' in sys.argv else 7
    out = Path(args[0]) if args else ROOT / 'newsletter.html'
    news = json.loads((ROOT / 'data' / 'news.json').read_text(encoding='utf-8'))
    site = json.loads((ROOT / 'site.json').read_text(encoding='utf-8'))
    hoy = datetime.now(TZ).date()
    desde = hoy - timedelta(days=dias)
    cur = [i for i in news['items'] if i.get('label') != 'Automática' and date.fromisoformat(i['date']) > desde]
    cur.sort(key=lambda i: (-(i.get('impact') or 1), not i.get('affectsArgentina'), -date.fromisoformat(i['date']).toordinal()))
    top, resto = cur[:5], cur[5:12]
    arg = [i for i in cur if i.get('affectsArgentina') and (i.get('argentinaImpact') or {}).get('change')][:4]
    inds = [d for d in news.get('indicators', []) if d.get('value')][:6]
    proximas = sorted(((dl['date'], dl['label'], i['id']) for i in news['items'] if i.get('label') != 'Automática'
                       for dl in i.get('deadlines') or [] if dl.get('date', '') >= hoy.isoformat()))[:4]
    pat = site.get('patrocinios') or {}
    sp = pat.get('newsletter') if pat.get('activo') else None

    link = lambda i: f'{SITE}/noticias/{i["id"]}/?utm_source=newsletter&utm_medium=email&utm_campaign=semanal-{hoy.isoformat()}'
    h2 = lambda t: f'<tr><td style="padding:28px 32px 8px"><div style="font:700 12px/1.2 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:{MUTED}">{esc(t)}</div></td></tr>'

    def nota(i, n):
        kd = (i.get('keyData') or [[None, None]])[0]
        dato = f'<div style="margin:8px 0 0;font:700 13px/1.4 Arial,sans-serif;color:{NAVY}">{esc(kd[0])}: {esc(kd[1])}</div>' if kd[0] else ''
        return (f'<tr><td style="padding:14px 32px;border-bottom:1px solid {LINE}">'
                f'<div style="font:700 11px/1.2 Arial,sans-serif;color:{MUTED};letter-spacing:.08em;text-transform:uppercase">{n} · {esc((i.get("topics") or [""])[0])}</div>'
                f'<a href="{esc(link(i))}" style="display:block;margin:6px 0 6px;font:700 19px/1.3 Georgia,serif;color:{INK};text-decoration:none">{esc(i["title"])}</a>'
                f'<div style="font:15px/1.55 Arial,sans-serif;color:#36465A">{esc(i.get("summary", ""))}</div>{dato}</td></tr>')

    filas = [
        f'<tr><td style="background:{NAVY};padding:24px 32px">'
        f'<div style="font:800 26px/1 Arial,sans-serif;color:#fff;letter-spacing:.02em">PULSO <span style="color:{ACCENT}">●</span></div>'
        f'<div style="font:600 11px/1.6 Arial,sans-serif;color:#AFC0D4;letter-spacing:.24em">COMEX · RESUMEN SEMANAL</div>'
        f'<div style="font:13px/1.4 Arial,sans-serif;color:#AFC0D4;margin-top:10px">{esc(fecha_larga(hoy))} · {len(cur)} notas verificadas en los últimos {dias} días</div></td></tr>',
        f'<tr><td style="padding:24px 32px 0;font:16px/1.6 Arial,sans-serif;color:{INK}">Hola: estas son las novedades de comercio exterior de la semana que más cambian costos, plazos y reglas. Cada una está verificada contra su fuente original.</td></tr>',
        h2('Lo más importante'),
        *[nota(i, n + 1) for n, i in enumerate(top)],
    ]
    if sp:
        filas.append(f'<tr><td style="padding:22px 32px"><table role="presentation" width="100%" style="border:1px dashed #C3CDDA;border-radius:8px"><tr><td style="padding:16px 18px">'
                     f'<div style="font:700 10px/1.2 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:{MUTED}">Publicidad · Este resumen llega gracias a</div>'
                     f'<div style="font:700 18px/1.3 Georgia,serif;color:{INK};margin:6px 0 4px">{esc(sp["marca"])}</div>'
                     f'<div style="font:14px/1.5 Arial,sans-serif;color:#36465A">{esc(sp.get("texto", ""))}</div>'
                     f'<a href="{esc(sp["url"])}" style="display:inline-block;margin-top:10px;font:700 13px Arial,sans-serif;color:{NAVY}">{esc(sp.get("cta") or "Conocer más")} →</a>'
                     f'</td></tr></table></td></tr>')
    if arg:
        filas += [h2('Qué cambia para Argentina')] + [
            f'<tr><td style="padding:6px 32px;font:15px/1.55 Arial,sans-serif;color:{INK}">▸ <b>{esc(i["argentinaImpact"]["change"])}</b>'
            f'<br><span style="color:{MUTED};font-size:13px">A quién le importa: {esc(i["argentinaImpact"].get("who", ""))} · <a href="{esc(link(i))}" style="color:{NAVY}">Leer</a></span></td></tr>' for i in arg]
    if resto:
        filas += [h2('También pasó')] + [
            f'<tr><td style="padding:5px 32px;font:15px/1.5 Arial,sans-serif"><a href="{esc(link(i))}" style="color:{INK}">{esc(i["title"])}</a></td></tr>' for i in resto]
    if inds:
        celdas = ''.join(f'<td width="50%" style="padding:8px 10px;border-bottom:1px solid {LINE};font:13px/1.4 Arial,sans-serif;color:{MUTED}">{esc(d["label"])}<br>'
                         f'<b style="font-size:16px;color:{INK}">{esc(d["value"])}</b> <span style="color:{"#1A7F4B" if d.get("trend") == "up" else "#B42318" if d.get("trend") == "down" else MUTED}">{esc(d.get("change", ""))}</span></td>'
                         + ('</tr><tr>' if n % 2 else '') for n, d in enumerate(inds))
        filas += [h2('Indicadores'), f'<tr><td style="padding:0 22px"><table role="presentation" width="100%"><tr>{celdas}</tr></table></td></tr>']
    if proximas:
        filas += [h2('Próximas fechas')] + [
            f'<tr><td style="padding:5px 32px;font:14px/1.5 Arial,sans-serif;color:{INK}"><b>{esc(f)}</b> · {esc(l)}</td></tr>' for f, l, _ in proximas]
    filas.append(f'<tr><td style="padding:30px 32px;font:12px/1.6 Arial,sans-serif;color:{MUTED};border-top:1px solid {LINE}">'
                 f'Recibís este correo porque te suscribiste a Pulso Comex. Las notas resumen información de las fuentes enlazadas en cada una; no constituyen asesoramiento aduanero ni legal.<br>'
                 f'<a href="{SITE}/" style="color:{NAVY}">pulso-comex.github.io</a> · <a href="{SITE}/publicidad/" style="color:{NAVY}">Anunciá acá</a> · <a href="{{$unsubscribe}}" style="color:{MUTED}">Darme de baja</a></td></tr>')

    doc = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f'<title>Pulso Comex · Resumen semanal · {esc(fecha_larga(hoy))}</title></head>'
           f'<body style="margin:0;background:{BG}"><div style="display:none;max-height:0;overflow:hidden">{esc(top[0]["title"] if top else "")}</div>'
           f'<table role="presentation" width="100%" style="background:{BG}"><tr><td align="center" style="padding:24px 12px">'
           f'<table role="presentation" width="100%" style="max-width:640px;background:#fff;border-radius:10px;overflow:hidden;border-collapse:collapse">'
           + ''.join(filas) + '</table></td></tr></table></body></html>')
    out.write_text(doc, encoding='utf-8')
    print(f'Newsletter: {out} · {len(top)} destacadas, {len(resto)} más, {len(arg)} para Argentina, patrocinio: {"sí" if sp else "no"}')


if __name__ == '__main__':
    main()
