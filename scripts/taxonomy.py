"""Secciones del sitio (data/taxonomy.json): qué notas entran en cada una.

Misma lógica que inSection() en assets/app.js. Lo usa scripts/build_pages.py para generar
/seccion/<slug>/ y decidir qué secciones se indexan.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def norm(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if not unicodedata.combining(c)).lower()


def item_text(it: dict) -> str:
    return norm(' '.join([it.get('title') or '', it.get('summary') or '', ' '.join(it.get('tags') or [])]))


class Taxonomy:
    def __init__(self, data: dict):
        self.data = data
        self.sections = {s['slug']: s for s in data.get('sections', [])}
        self.groups = data.get('groups', [])
        self.min_index = int(data.get('minIndex') or 5)
        self._rx = {}
        for s in self.sections.values():
            if s.get('match'):
                self._rx[s['slug']] = re.compile(s['match'])

    @classmethod
    def load(cls) -> 'Taxonomy':
        return cls(json.loads((ROOT / 'data' / 'taxonomy.json').read_text(encoding='utf-8')))

    def contains(self, slug: str, it: dict, text: str | None = None, depth: int = 0) -> bool:
        s = self.sections.get(slug)
        if not s:
            return False
        if any(t in (it.get('topics') or []) for t in s.get('topics', [])):
            return True
        if any(c in (it.get('countries') or []) for c in s.get('countries', [])):
            return True
        if any(t in (it.get('tags') or []) for t in s.get('tags', [])):
            return True
        text = item_text(it) if text is None else text
        rx = self._rx.get(slug)
        if rx and rx.search(text):
            return True
        if depth == 0:
            return any(self.contains(c, it, text, 1) for c in s.get('children', []))
        return False

    def items_for(self, slug: str, items: list) -> list:
        return [i for i in items if self.contains(slug, i)]

    def group_of(self, slug: str):
        return next((g for g in self.groups if g['slug'] == slug or slug in g['sections']), None)
