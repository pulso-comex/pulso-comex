#!/usr/bin/env python3
"""Descarga una copia local de las fotos de archivo (data/photos.json) en img/stock/.

Así las fotos se sirven desde el propio sitio y no dependen de que Unsplash esté disponible.
La licencia de Unsplash permite descargarlas y usarlas; el sitio mantiene el crédito al autor.
Se ejecuta en cada corrida del workflow, pero solo descarga lo que falta.
Las fotos que ya no existen en Unsplash quedan marcadas en img/stock/status.json y build_pages.py las omite.
"""
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'img' / 'stock'
OUT.mkdir(parents=True, exist_ok=True)
STATUS = OUT / 'status.json'
SIZES = {'1600': 1600, '800': 800}


def download(url: str) -> bytes:
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; PulsoComexBot/1.1)'})
    with urlopen(req, timeout=30) as r:
        return r.read(8_000_000)


def main():
    bank = json.loads((ROOT / 'data' / 'photos.json').read_text(encoding='utf-8'))
    status = json.loads(STATUS.read_text(encoding='utf-8')) if STATUS.exists() else {}
    got = failed = 0
    for photos in bank.values():
        for p in photos:
            pid = p['id']
            for label, w in SIZES.items():
                f = OUT / f'{pid}-{label}.jpg'
                if f.exists() and f.stat().st_size > 5000:
                    continue
                try:
                    data = download(f"{p['src']}?auto=format&fit=crop&w={w}&q=72&fm=jpg")
                    if not data.startswith(b'\xff\xd8') or len(data) < 5000:
                        raise ValueError('la respuesta no es una imagen JPEG')
                    f.write_bytes(data)
                    got += 1
                    status[pid] = 'ok'
                except Exception as e:
                    failed += 1
                    status[pid] = 'missing' if '404' in str(e) else status.get(pid, 'error')
                    print(f'  ✘ {pid} ({w}px): {e}', file=sys.stderr)
                    break
            else:
                status[pid] = 'ok'
    STATUS.write_text(json.dumps(status, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(f'Fotos de archivo: {got} descargadas, {failed} con error, {sum(1 for v in status.values() if v == "ok")} disponibles.')


if __name__ == '__main__':
    main()
