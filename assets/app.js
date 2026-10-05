(() => {
'use strict';

// Raíz del sitio, deducida de la ubicación de este script: funciona en el dominio propio,
// en una subcarpeta (usuario.github.io/repo/) y abriendo index.html con doble clic.
const BASE = document.currentScript?.src
  ? new URL('../', document.currentScript.src).href   // script externo: /assets/app.js → raíz
  : new URL('./', location.href).href;                // script embebido (portada): carpeta de la página
const FILE_MODE = location.protocol === 'file:';
const at = p => new URL(String(p).replace(/^\//, ''), BASE).href;

/* =====================================================================
   1. CONFIGURACIÓN
   ---------------------------------------------------------------------
   sources: la página lee todas las fuentes en orden y las combina.
   - inline: feed embebido en <script id="feed-data"> (modo actual, curado a mano).
   - json:   endpoint propio con el mismo esquema (recomendado en producción).
   - rss:    RSS/Atom. Por CORS conviene leerlo desde el servidor y exponerlo como json.
   Los webhooks y la ingesta programada escriben en la base que sirve el endpoint json.
   Cuando al menos una fuente remota responde, el encabezado pasa de "ACTUALIZADO" a "EN VIVO".
   ===================================================================== */
const CONFIG = {
  siteName: 'Pulso Comex',
  canonicalBase: FILE_MODE ? '' : BASE.replace(/\/$/, ''),   // dirección real del sitio, detectada sola (github.io o dominio propio)
  prettyUrls: !FILE_MODE,   // con doble clic (file://) las notas se abren dentro de index.html
  indexAutomatic: false,     // notas automáticas (solo enlazan a otro medio): noindex. Debe coincidir con build_pages.py
  refreshMinutes: 10,
  timeZone: 'America/Argentina/Buenos_Aires',
  pageSize: 8,
  breakingWindowDays: 2,     // ÚLTIMA HORA se apaga sola pasado este plazo
  social: [],               // ej.: [{ name:'LinkedIn', url:'https://www.linkedin.com/company/…' }]
  sources: [
    ...(FILE_MODE ? [] : [{ type: 'json', url: at('data/latest.json') }]),  // generado por scripts/build_pages.py
    { type: 'inline', id: 'feed-data' },
    // { type: 'rss',  url: 'https://www.ejemplo.org/feed.xml', sourceName: 'Ejemplo', sourceType: 'Organismo internacional',
    //   defaults: { topics: ['Economía internacional'], countries: ['Global'] } },
  ]
};

// Datos editables del sitio: site.json → inyectados por scripts/build_pages.py
const SITECFG = (() => {
  try { const t = document.getElementById('site-config')?.textContent?.trim(); return t && !t.startsWith('{{') ? JSON.parse(t) : {}; }
  catch (e) { return {}; }
})();
CONFIG.social = (SITECFG.redes || []).map(r => ({ name: r.nombre, url: r.url }));
// Taxonomía de secciones y glosario: data/taxonomy.json y data/glossary.json → inyectados por scripts/build_pages.py
const SITE_DATA = (() => {
  try { const t = document.getElementById('site-data')?.textContent?.trim(); return t && !t.startsWith('{{') ? JSON.parse(t) : {}; }
  catch (e) { return {}; }
})();

/* =====================================================================
   2. TAXONOMÍA
   ===================================================================== */
const TOPICS = ['Argentina','Latinoamérica','Estados Unidos','Europa','Asia','China','Oceanía','Mercosur','Importaciones','Exportaciones','Aduanas','Aranceles','Impuestos','Tratados y acuerdos','Logística','Transporte marítimo','Transporte aéreo','Puertos','Economía internacional','Geopolítica y comercio','Empresas','Regulaciones','Tecnología COMEX'];

// Secciones del menú (data/taxonomy.json), agrupadas en bloques: Comercio mundial, Argentina, Logística y Mercados.
// Una nota entra en una sección por categoría, país, etiqueta o palabras clave (misma lógica que scripts/taxonomy.py).
const TAXO = SITE_DATA.taxonomy || {};
const SECTIONS = (TAXO.sections || []).map(s => ({ ...s, title: s.title || s.label, topics: s.topics || [], countries: s.countries || [],
  tags: s.tags || [], children: s.children || [], rx: (() => { try { return s.match ? new RegExp(s.match) : null; } catch (e) { return null; } })() }));
const GROUPS = (TAXO.groups || []).map(g => ({ ...g, sections: g.sections.filter(x => SECTIONS.some(s => s.slug === x)) }));
const GROUP_SLUGS = new Set(GROUPS.map(g => g.slug));
const sectionBySlug = slug => SECTIONS.find(x => x.slug === slug) || SECTIONS.find(x => x.slug === (TAXO.aliases || {})[slug]);
const groupOf = slug => GROUPS.find(g => g.slug === slug) || GROUPS.find(g => g.sections.includes(slug));
const itemText = it => it._txt || (it._txt = norm([it.title, it.summary, (it.tags || []).join(' ')].join(' ')));
function inSection(it, s, depth = 0){
  if (!s) return false;
  if (s.topics.some(t => it.topics.includes(t)) || s.countries.some(c => it.countries.includes(c)) || s.tags.some(t => it.tags.includes(t))) return true;
  if (s.rx && s.rx.test(itemText(it))) return true;
  return depth === 0 && s.children.some(c => inSection(it, sectionBySlug(c), 1));
}
// Sección más específica de una nota (para la ruta de navegación y el menú).
function sectionOf(it){
  const leaf = SECTIONS.filter(s => !GROUP_SLUGS.has(s.slug));
  return leaf.find(s => s.topics.includes(category(it))) || leaf.find(s => inSection(it, s)) || SECTIONS.find(s => inSection(it, s));
}

const REGIONS = ['Argentina','Mercosur','Latinoamérica','Norteamérica','Europa','Asia','Oceanía','Medio Oriente','Global'];
const COUNTRY_REGIONS = {
  'Argentina':['Argentina','Mercosur','Latinoamérica'], 'Brasil':['Mercosur','Latinoamérica'], 'Paraguay':['Mercosur','Latinoamérica'],
  'Uruguay':['Mercosur','Latinoamérica'], 'Chile':['Latinoamérica'], 'México':['Norteamérica','Latinoamérica'],
  'Estados Unidos':['Norteamérica'], 'Canadá':['Norteamérica'],
  'Unión Europea':['Europa'], 'Polonia':['Europa'], 'España':['Europa'], 'Alemania':['Europa'],
  'China':['Asia'], 'Vietnam':['Asia'], 'Singapur':['Asia'], 'Japón':['Asia'], 'India':['Asia'],
  'Australia':['Oceanía'], 'Nueva Zelanda':['Oceanía'],
  'Irán':['Medio Oriente'], 'Arabia Saudita':['Medio Oriente'], 'Irak':['Medio Oriente'], 'Emiratos Árabes Unidos':['Medio Oriente'],
  'Global':['Global']
};
const TOPIC_REGIONS = { 'Latinoamérica':'Latinoamérica', 'Mercosur':'Mercosur', 'Europa':'Europa', 'Asia':'Asia', 'China':'Asia', 'Oceanía':'Oceanía', 'Estados Unidos':'Norteamérica', 'Argentina':'Argentina' };
// Coordenadas aproximadas (lon, lat) para el mapa de cobertura.
const COORDS = {
  'Argentina':[-64,-34],'Brasil':[-51,-10],'Paraguay':[-58,-23],'Uruguay':[-56,-33],'Chile':[-71,-33],'México':[-102,23],
  'Estados Unidos':[-98,39],'Canadá':[-100,57],'Unión Europea':[9,50],'Polonia':[19,52],'España':[-4,40],'Alemania':[10,51],
  'China':[104,35],'Vietnam':[106,15],'Singapur':[104,1.3],'Japón':[138,36],'India':[78,22],
  'Australia':[134,-25],'Nueva Zelanda':[174,-41],
  'Irán':[53,32],'Arabia Saudita':[45,24],'Irak':[44,33],'Emiratos Árabes Unidos':[54,24]
};

const KINDS = { noticia:'Noticia', analisis:'Análisis', datos:'Datos', opinion:'Opinión de terceros' };

// Directorio de fuentes de referencia (enlaces a los sitios institucionales, no a noticias).
const SOURCE_DIRECTORY = [
  { group:'Argentina · organismos oficiales', items:[
    ['INDEC · Intercambio comercial argentino','https://www.indec.gob.ar/'],
    ['ARCA · Aduana','https://www.arca.gob.ar/'],
    ['Boletín Oficial de la República Argentina','https://www.boletinoficial.gob.ar/'],
    ['Banco Central de la República Argentina','https://www.bcra.gob.ar/'],
    ['Cancillería argentina','https://www.cancilleria.gob.ar/'] ]},
  { group:'Organismos internacionales', items:[
    ['Organización Mundial del Comercio (OMC)','https://www.wto.org/indexsp.htm'],
    ['Organización Mundial de Aduanas (OMA)','https://www.wcoomd.org/'],
    ['UNCTAD','https://unctad.org/es'],
    ['Banco Mundial','https://www.bancomundial.org/'],
    ['Fondo Monetario Internacional','https://www.imf.org/es/Home'],
    ['Organización Marítima Internacional (IMO)','https://www.imo.org/'],
    ['IATA','https://www.iata.org/'] ]},
  { group:'Bloques y otros gobiernos', items:[
    ['Mercosur','https://www.mercosur.int/'],
    ['Comisión Europea · Comercio','https://policy.trade.ec.europa.eu/'],
    ['MDIC · Comercio exterior de Brasil','https://www.gov.br/mdic/pt-br'],
    ['USTR · Representante Comercial de EE.UU.','https://ustr.gov/'] ]},
  { group:'Logística, mercados y agencias', items:[
    ['Drewry · índices de fletes','https://www.drewry.co.uk/'],
    ['Reuters','https://www.reuters.com/'],
    ['AP','https://apnews.com/'],
    ['Bloomberg Línea','https://www.bloomberglinea.com/'] ]},
];

/* =====================================================================
   3. UTILIDADES
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MARKS = /[̀-ͯ]/g;
const norm = s => String(s ?? '').normalize('NFD').replace(MARKS,'').toLowerCase();
const slug = s => norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const TZ = CONFIG.timeZone;
const fmtDay = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday:'long', day:'numeric', month:'long', year:'numeric' });
const fmtShort = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day:'numeric', month:'short', year:'numeric' });
const fmtDM = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day:'numeric', month:'short' });
const fmtDayHead = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday:'long', day:'numeric', month:'long' });
const fmtTime = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour:'2-digit', minute:'2-digit', hour12:false });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const todayYMD = () => ymdFmt.format(new Date());
const ymdToUTC = ymd => { const [y,m,d] = ymd.split('-').map(Number); return Date.UTC(y, m-1, d); };
const dayDiff = item => Math.round((ymdToUTC(todayYMD()) - ymdToUTC(item.date)) / 86400000);
const itemDate = item => item.datetime ? new Date(item.datetime) : new Date(item.date + 'T12:00:00-03:00');
const shortDate = d => fmtShort.format(d).replace('.', '');

function agoText(date){
  const mins = Math.floor((Date.now() - date) / 60000);
  if (mins < 1) return 'hace instantes';
  if (mins < 60) return `hace ${plural(mins,'minuto')}`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${plural(h,'hora')}`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
function relTime(item){
  if (item.datetime){
    const mins = Math.floor((Date.now() - new Date(item.datetime)) / 60000);
    if (mins >= 0 && mins < 1440) return 'Publicado ' + agoText(new Date(item.datetime));
  }
  const d = dayDiff(item);
  if (d <= 0) return 'Publicado hoy';
  if (d === 1) return 'Publicado ayer';
  if (d < 7) return `Publicado hace ${d} días`;
  if (d < 31) return `Publicado hace ${plural(Math.floor(d/7),'semana')}`;
  return 'Publicado el ' + shortDate(itemDate(item));
}
const timeLabel = item => item.datetime ? fmtTime.format(new Date(item.datetime)) + ' h' : 'No informada por la fuente';

// Resalta coincidencias sin distinguir acentos ni mayúsculas.
function hl(text, q = state.filters.q){
  const s = String(text ?? '');
  const terms = norm(q).split(/\s+/).filter(t => t.length > 1);
  if (!terms.length) return esc(s);
  const chars = [...s];
  const flat = chars.map(c => { const n = norm(c); return n.length === 1 ? n : c.toLowerCase().slice(0,1) || ' '; }).join('');
  const hit = new Array(chars.length).fill(false);
  for (const t of terms){ let i = flat.indexOf(t); while (i !== -1){ for (let k = i; k < i + t.length; k++) hit[k] = true; i = flat.indexOf(t, i + 1); } }
  let out = '', open = false;
  chars.forEach((c, i) => { if (hit[i] && !open){ out += '<mark>'; open = true; } if (!hit[i] && open){ out += '</mark>'; open = false; } out += esc(c); });
  return out + (open ? '</mark>' : '');
}

/* =====================================================================
   4. ESTADO Y PREFERENCIAS
   ===================================================================== */
const emptyFilters = () => ({ q:'', section:'', topic:'', region:'', country:'', date:'', source:'', tag:'', arg:'', flow:'', kind:'' });
const PARAM = { q:'q', section:'seccion', topic:'categoria', region:'region', country:'pais', date:'fecha', source:'fuente', tag:'tema', arg:'argentina', flow:'operacion', kind:'tipo' };
const state = {
  items: [], indicators: [], stories: [], trade: null, updatedAt: null, checkedAt: null, live: false, loaded: false,
  filters: emptyFilters(), sort: 'relevancia', view: 'loading', articleId: null,
  listCount: CONFIG.pageSize, newIds: new Set(), firstRoute: true
};
const prefs = Object.assign({ theme:'system', size:'1', topics:[] }, store.get('comex.prefs', {}));
// compatibilidad con la preferencia de tema de la versión anterior
const legacyTheme = store.get('comex.theme', null); if (legacyTheme && prefs.theme === 'system') prefs.theme = legacyTheme;
const savePrefs = () => store.set('comex.prefs', prefs);

/* =====================================================================
   5. CAPA DE DATOS
   ===================================================================== */
const adapters = {
  async inline(src){ const el = document.getElementById(src.id); const txt = el?.textContent?.trim(); if (!txt || txt.startsWith('{{')) return { items: [] }; return JSON.parse(txt); },
  async json(src){ const r = await fetch(src.url, { cache:'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); },
  async rss(src){
    const r = await fetch(src.url, { cache:'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
    const items = [...xml.querySelectorAll('item, entry')].map(n => {
      const get = t => n.querySelector(t)?.textContent?.trim() || '';
      const link = n.querySelector('link')?.getAttribute('href') || get('link');
      const pub = new Date(get('pubDate') || get('published') || get('updated'));
      const text = get('description') || get('summary');
      const valid = !isNaN(pub);
      return {
        id: slug(get('title')).slice(0,80), datetime: valid ? pub.toISOString() : null, date: valid ? ymdFmt.format(pub) : null,
        title: get('title'), summary: text.replace(/<[^>]+>/g,'').slice(0,280), body: [], keyData: [],
        topics: src.defaults?.topics || [], countries: src.defaults?.countries || [], tags: [], visual: src.defaults?.visual || 'globe', impact: 1,
        author: get('author name') || get('dc\\:creator') || '',
        sources: [{ name: src.sourceName || new URL(src.url).hostname, type: src.sourceType || 'Fuente externa', url: link, primary: true, author: get('author name') || '' }]
      };
    });
    return { items };
  }
};

function normalize(raw){
  const primary = (raw.sources || []).find(s => s.primary) || (raw.sources || [])[0];
  // Verificabilidad: sin título, fecha o fuente con enlace, la noticia no se publica.
  if (!raw.title || !raw.date || !primary?.url || !primary?.name) return null;
  const label = raw.label || '';
  const kind = KINDS[raw.kind] ? raw.kind : (norm(label) === 'analisis' ? 'analisis' : 'noticia');
  return {
    id: raw.id || slug(raw.title).slice(0,80), date: raw.date, datetime: raw.datetime || null, updated: raw.updated || null,
    title: raw.title, summary: raw.summary || '', body: raw.body || [], keyData: raw.keyData || [],
    topics: (raw.topics || []).filter(t => TOPICS.includes(t)), countries: raw.countries || [], tags: raw.tags || [],
    visual: raw.visual || 'globe', impact: Math.min(3, Math.max(1, raw.impact || 1)), kind, label,
    breaking: !!raw.breaking, affectsArgentina: !!raw.affectsArgentina, argentinaNote: raw.argentinaNote || '', argentinaImpact: raw.argentinaImpact || null,
    photo: raw.photo || null, sources: raw.sources, primary,
    deadlines: Array.isArray(raw.deadlines) ? raw.deadlines : [], story: raw.story || ''
  };
}
function normalizeIndicator(d){
  if (!d || !d.label) return null;
  const has = d.value !== null && d.value !== undefined && String(d.value).trim() !== '';
  return { id: d.id || slug(d.label), label: d.label, value: has ? String(d.value) : null, change: d.change || '', trend: d.trend || 'flat',
    period: d.period || '', source: d.source || '', url: d.url || '', group: d.group || 'Otros', pending: d.pending || '' };
}

async function loadFeeds(){
  const byKey = new Map(state.items.map(i => [i.primary.url, i]));
  let indicators = state.indicators, stories = state.stories, updated = state.updatedAt, live = false;
  for (const src of CONFIG.sources){
    try {
      const feed = await adapters[src.type](src);
      if (src.type !== 'inline') live = true;
      if (Array.isArray(feed.indicators)) indicators = feed.indicators.map(normalizeIndicator).filter(Boolean);
      if (Array.isArray(feed.stories)) stories = feed.stories.map(normalizeStory).filter(Boolean);
      if (feed.trade && Array.isArray(feed.trade.monthly) && feed.trade.monthly.length) state.trade = feed.trade;
      if (feed.updatedAt && (!updated || new Date(feed.updatedAt) > new Date(updated))) updated = feed.updatedAt;
      for (const raw of feed.items || []){
        const it = normalize(raw); if (!it) continue;
        byKey.set(it.primary.url, it); // deduplica por enlace original
      }
    } catch (e) { console.warn('Fuente no disponible:', src, e); }
  }
  state.items = [...byKey.values()].sort((a,b) => itemDate(b) - itemDate(a) || score(b).total - score(a).total);
  state.indicators = indicators; state.stories = stories; state.updatedAt = updated; state.checkedAt = new Date(); state.live = live; state.loaded = true;
}

// Marca como "Nueva" lo que no estaba en la visita anterior (no aplica en la primera visita).
function trackNew(){
  const seen = store.get('comex.seen', null);
  if (seen) state.items.forEach(i => { if (!seen.includes(i.id)) state.newIds.add(i.id); });
  store.set('comex.seen', state.items.map(i => i.id));
}

/* =====================================================================
   6. RELEVANCIA, REGIONES Y FILTROS
   ===================================================================== */
function score(it){
  const d = dayDiff(it);
  const actualidad = d <= 1 ? 3 : d <= 3 ? 2 : d <= 7 ? 1 : 0;
  const c = it.countries.filter(x => x !== 'Global').length;
  const alcance = it.countries.includes('Global') || c >= 4 ? 3 : c >= 2 ? 2 : 1;
  const argentina = it.affectsArgentina ? 2 : 0;
  return { actualidad, impacto: it.impact, alcance, argentina, total: actualidad + it.impact + alcance + argentina };
}
const byScore = list => [...list].sort((a,b) => score(b).total - score(a).total || itemDate(b) - itemDate(a));
const byDate = list => [...list].sort((a,b) => itemDate(b) - itemDate(a));
const isBreaking = it => it.breaking && dayDiff(it) <= CONFIG.breakingWindowDays;
const isIntl = it => it.countries.some(c => c !== 'Argentina');

function regionsOf(it){
  const set = new Set();
  it.countries.forEach(c => (COUNTRY_REGIONS[c] || []).forEach(r => set.add(r)));
  it.topics.forEach(t => TOPIC_REGIONS[t] && set.add(TOPIC_REGIONS[t]));
  return set;
}
function textScore(it, q){
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const f = { t: norm(it.title), s: norm(it.summary), k: norm([...it.tags, ...it.topics, ...it.countries].join(' ')), b: norm(it.body.join(' ') + ' ' + it.keyData.flat().join(' ')), src: norm(it.sources.map(s=>s.name).join(' ')) };
  let sc = 0;
  for (const w of terms){
    const part = (f.t.includes(w) ? 6 : 0) + (f.k.includes(w) ? 4 : 0) + (f.s.includes(w) ? 3 : 0) + (f.b.includes(w) ? 1 : 0) + (f.src.includes(w) ? 2 : 0);
    if (!part) return -1; // todas las palabras deben aparecer
    sc += part;
  }
  return sc;
}
const filterCount = f => Object.values(f).filter(Boolean).length;
const anyFilter = () => filterCount(state.filters) > 0;

function matches(it, f = state.filters){
  if (f.section){ const s = sectionBySlug(f.section); if (s && !inSection(it, s)) return false; }
  if (f.topic && !it.topics.includes(f.topic)) return false;
  if (f.region && !regionsOf(it).has(f.region)) return false;
  if (f.country && !it.countries.includes(f.country)) return false;
  if (f.source && !it.sources.some(s => s.name === f.source)) return false;
  if (f.tag && !it.tags.includes(f.tag)) return false;
  if (f.arg && !it.affectsArgentina) return false;
  if (f.flow === 'importaciones' && !it.topics.includes('Importaciones')) return false;
  if (f.flow === 'exportaciones' && !it.topics.includes('Exportaciones')) return false;
  if (f.kind && it.kind !== f.kind) return false;
  if (f.date !== '' && dayDiff(it) > Number(f.date)) return false;
  if (f.q && textScore(it, f.q) < 0) return false;
  return true;
}
function results(){
  const list = state.items.filter(it => matches(it));
  if (state.sort === 'fecha') return byDate(list);
  return [...list].sort((a,b) => (textScore(b, state.filters.q) + score(b).total) - (textScore(a, state.filters.q) + score(a).total) || itemDate(b) - itemDate(a));
}

/* =====================================================================
   7. IMÁGENES (imagen de la fuente · banco de fotos con licencia · recuadro neutro)
   ===================================================================== */
function hash(s){ let h = 0; for (const c of s) h = (h*31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
/* Fotos de archivo (Unsplash License: uso libre, con crédito al autor).
   Si la noticia trae "photo" propia, se usa esa; si una foto no carga, queda la ilustración. */
const U = (id, by, sl, alt) => ({ src: 'https://images.unsplash.com/' + id, by, page: 'https://unsplash.com/photos/' + sl, alt });
const PHOTOS = {
  ship: [
    U('photo-1605745341112-85968b19335b','Ian Taylor','blue-and-red-cargo-ship-on-sea-during-daytime-jOqJbvo1P9g','Buque portacontenedores navegando en mar abierto'),
    U('photo-1578575437130-527eed3abbec','Andy Li','cargo-ships-docked-at-the-pier-during-day-CpsTAUPoScw','Buques de carga amarrados en un muelle con contenedores'),
    U('photo-1604506522146-316c8bedd874','Anastasios Antoniadis','cargo-ship-on-sea-under-cloudy-sky-during-daytime-AMXFr97d00c','Buque de carga bajo un cielo nublado')
  ],
  container: [
    U('photo-1678182451047-196f22a4143e','Ali Mkumbwa','a-large-amount-of-containers-are-stacked-on-top-of-each-other-Annl9CjEaEs','Contenedores apilados en el puerto de Dar es Salaam'),
    U('photo-1759272840538-ae4b07214c71','Haris Illahi','fT4SwA83jH4','Contenedores apilados en un puerto al atardecer'),
    U('photo-1741792003907-11e3bdc2a180','Pix Tresa','NXF9MI3zby0','Contenedores a bordo de un buque en Hamburgo')
  ],
  port: [
    U('photo-1706499856012-14f062c72b49','taro ohtani','5T5zmIqs0AM','Grúas pórtico y contenedores en el puerto de Shinagawa'),
    U('photo-1741173337736-0c6cd956a9b3','Sorin Basangeac','WdQevQ2nlh4','Grúa cargando contenedores en la terminal Burchardkai de Hamburgo'),
    U('photo-1670121180530-cfcba4438038','Nathan Cima','MHXJ9p64Jw8','Portacontenedores en la terminal de Hai Phong, Vietnam')
  ],
  plane: [
    U('photo-1774698078446-59299e016718','Peaky_82','cargo-plane-being-loaded-at-an-airport-tarmac-85gDb_IHdAQ','Avión carguero descargando en el aeropuerto de Sídney'),
    U('photo-1672136882892-4758ddd19826','Jan Rosolino','a-fed-ex-airplane-is-on-the-runway-DPWqOwZNwjA','Avión carguero despegando en el aeropuerto de Fráncfort'),
    U('photo-1570710891163-6d3b5c47248b','Kevin Woblick','low-angle-photography-of-airliner-during-flight-UdUbSPwbv2c','Avión en vuelo visto desde abajo')
  ],
  tanker: [
    U('photo-1518527989017-5baca7a58d3c','Shaah Shahidh','aerial-photography-of-tanker-ship--subrrYxv8A','Vista aérea de un buque tanque'),
    U('photo-1598408745613-178751e2ccde','Fredrick F.','red-and-white-ship-on-sea-under-cloudy-sky-during-daytime-U9_pRASawlc','Buque tanque navegando cerca de Johor, Malasia')
  ],
  customs: [
    U('photo-1700777685830-f501e67260e6','Bernd Dittrich','yfTSNbggFyE','Grúa moviendo un contenedor en el puerto de Fráncfort'),
    U('photo-1716880288871-c15d8519f5b3','PortCalls Asia','JZ0IIWzB52c','Camión portacontenedores en la terminal del puerto de Manila'),
    U('photo-1721937127582-ed331de95a04','Ashley','a-warehouse-filled-with-lots-of-boxes-and-pallets-28b8xlTT5t4','Autoelevador en un depósito con estanterías de mercadería')
  ],
  chart: [
    U('photo-1560221328-12fe60f83ab8','Nicholas Cappello','close-up-photo-of-monitor-displaying-graph-Wb63zqJ5gnE','Monitor con gráficos de mercado'),
    U('photo-1649003515353-c58a239cf662','Tötös Ádám','financial-candlestick-chart-market-trends-3r8rcSy0Ffg','Gráfico financiero de velas en una pantalla')
  ],
  globe: [
    U('photo-1521295121783-8a321d551ad2','Kyle Glenn','nXt5HtLmlgE','Globo terráqueo sobre una mesa'),
    U('photo-1451187580459-43490279c0fa','NASA','Q1p7bh3SHj8','La Tierra vista desde el espacio')
  ],
  treaty: [
    U('photo-1608817576203-3c27ed168bd2','Christian Lue','blue-and-yellow-star-flag-8Yw6tsB8tnc','Bandera de la Unión Europea frente al Parlamento Europeo en Bruselas'),
    U('photo-1756323150452-9844ab81d7cf','Dmitrii E.','european-union-flag-flies-over-a-stone-building-9IijGDLb1D4','Bandera de la Unión Europea sobre un edificio en Berlín')
  ],
  steel: [
    U('photo-1697698532634-ea59b636ccea','Morteza Mohammadi','rolls-of-steel-are-lined-up-in-a-warehouse--kWkoUkFyp0','Bobinas de acero en un depósito'),
    U('photo-1763771420746-c75fefab51b5','Zoshua Colah','bundles-of-rusty-rebar-steel-rods-ARW8QOYR_bI','Atados de barras de acero')
  ],
  court: [
    U('photo-1483600516620-7254872369ae','Jesse Collins','gray-stone-columns-worms-eye-view-photo-ICXMkhRdquA','Columnas de la Corte Suprema de Estados Unidos'),
    U('photo-1593115057322-e94b77572f20','Tingey Injury Law Firm','brown-wooden-tool-on-white-surface-veNb0DDegzE','Martillo de juez sobre una superficie blanca')
  ]
};
// El build inyecta el banco con las copias locales (img/stock/…), así las fotos no dependen de Unsplash.
(function loadPhotoBank(){
  try {
    const txt = document.getElementById('photo-bank')?.textContent?.trim();
    if (!txt || txt.startsWith('{{')) return;
    const bank = JSON.parse(txt);
    for (const [k, list] of Object.entries(bank)) if (Array.isArray(list) && list.length) PHOTOS[k] = list;
  } catch (e) { console.warn('Banco de fotos no disponible', e); }
})();
const stockFor = it => { const bank = PHOTOS[it.visual] || PHOTOS.globe; return bank[hash(it.id) % bank.length]; };
function photoFor(it){
  if (it.photo?.src) return { ...it.photo, source: true };
  return stockFor(it);
}
const isUnsplash = p => p.src.includes('images.unsplash.com');
const photoUrl = (p, w) => {
  if (p.local) return at(w <= 800 && p.localSmall ? p.localSmall : p.local);
  return isUnsplash(p) ? `${p.src}?auto=format&fit=crop&w=${w}&q=70` : p.src;
};
const photoSrcset = (p, w) => p.local && p.localSmall ? `${at(p.localSmall)} 800w, ${at(p.local)} 1600w`
  : isUnsplash(p) ? `${photoUrl(p, w)} ${w}w, ${photoUrl(p, w*2)} ${w*2}w` : '';
const capText = p => p.source ? `Imagen: ${p.by}` : `Foto de archivo: ${p.by}${p.page?.includes('unsplash') ? ' / Unsplash' : ''}`;
function imgTag(p, w, eager, sizes){
  const set = photoSrcset(p, w);
  return `<img class="photo" src="${esc(photoUrl(p, w))}"${set ? ` srcset="${esc(set)}" sizes="${sizes}"` : ''} alt="${esc(p.alt || '')}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"${p.source ? ' referrerpolicy="no-referrer"' : ''}>`;
}
function media(it, w, { caption = true, eager = false } = {}){
  const p = photoFor(it);
  const sizes = w >= 1000 ? '(max-width: 760px) 100vw, 760px' : w >= 600 ? '(max-width: 760px) 100vw, 380px' : '120px';
  // Si la imagen de la fuente falla, se prueba la foto de archivo; si también falla, queda un recuadro neutro.
  const alt = p.source ? stockFor(it) : null;
  return `<span class="ph" aria-hidden="true"><span>${esc(category(it))}</span></span>${imgTag(p, w, eager, sizes)}`
    + (alt ? `<template class="photo-alt" data-cap="${esc(capText(alt))}">${imgTag(alt, w, false, sizes)}</template>` : '')
    + (caption ? `<span class="photo-cap">${esc(capText(p))}</span>` : '');
}
const photoCredit = p => p.source
  ? `Imagen: ${p.page ? `<a href="${esc(p.page)}" target="_blank" rel="noopener noreferrer">${esc(p.by)}</a>` : esc(p.by)}, publicada junto a la nota original.`
  : p.page?.includes('unsplash.com')
  ? `Foto de archivo de <a href="${esc(p.page)}?utm_source=comex_global&utm_medium=referral" target="_blank" rel="noopener noreferrer">${esc(p.by)}</a> en <a href="https://unsplash.com/?utm_source=comex_global&utm_medium=referral" target="_blank" rel="noopener noreferrer">Unsplash</a>. Imagen ilustrativa, no corresponde al hecho de la noticia.`
  : `Foto: ${p.page ? `<a href="${esc(p.page)}" target="_blank" rel="noopener noreferrer">${esc(p.by)}</a>` : esc(p.by)}.`;
document.addEventListener('error', e => {
  const img = e.target;
  if (!img?.classList?.contains('photo')) return;
  const box = img.closest('.art');
  const alt = box?.querySelector('template.photo-alt');
  if (alt){
    const next = alt.content.firstElementChild.cloneNode(true);
    const cap = box.querySelector('.photo-cap'); if (cap) cap.textContent = alt.dataset.cap;
    alt.remove(); img.replaceWith(next);
    if (box.classList.contains('article-media')) $('#photoCredit')?.setAttribute('hidden','');
    return;
  }
  box?.classList.add('fallback');
  if (box?.classList.contains('article-media')) $('#photoCredit')?.setAttribute('hidden','');
}, true);

/* =====================================================================
   8. MAPA DE COBERTURA (máscara de tierra 2,5° · Natural Earth, dominio público)
   ===================================================================== */
const LAND = '13.8.6.a.29|x.b.2.i.e.5.p.1.1.2.w|p.1.1.1.6.1.2.1.1.2.4.j.e.1.1.2.v.1.u|r.1.5.7.9.f.v.1.b.a.a.2.2.1.c|m.2.1.2.1.2.1.2.1.1.1.1.1.2.1.1.8.d.u.1.6.1.3.j.5.2.e|7.8.a.7.1.2.3.1.2.3.6.1.1.b.i.3.f.11.4.1.3|0.2.4.r.1.5.2.1.1.3.5.8.j.a.3.a.1.16|2.1.2.w.1.1.2.4.6.5.7.3.b.4.1.4.2.1k|6.t.3.1.5.1.7.3.j.5.1.1l.1.6|5.8.2.j.7.3.a.1.g.1.2.6.1.1.2.1e.4.1.5|9.2.8.g.6.6.m.2.6.3.2.1a.7.2.7|6.1.d.j.2.7.l.2.4.1.4.1a.8.3.1.1.5|l.i.2.9.i.1.1.3.1.1i.g|l.o.4.1.m.1k.1.1.e|m.o.4.1.k.1l.g|m.n.1.1.p.c.1.1.1.4.1.z.h|m.m.o.5.2.3.1.4.6.2.2.v.4.1.f|m.k.q.4.3.1.2.1.1.1.1.a.1.r.1.2.5.1.f|n.i.r.3.6.1.5.9.2.r.2.1.3.1.g|o.h.s.7.9.z.5.2.h|p.f.s.a.2.1.5.y.4.1.j|r.9.2.1.t.n.1.t.n|q.1.1.5.6.1.r.i.1.6.1.r.o|r.1.1.4.x.k.1.6.1.1.4.m.n|u.3.5.2.p.m.1.8.4.8.1.8.r|u.3.3.1.4.1.o.l.1.7.6.6.2.5.u|v.6.t.m.1.5.7.4.5.5.5.1.n|z.4.q.n.1.3.a.2.7.5.4.1.n|11.1.r.o.4.1.8.2.7.1.1.3.4.2.m|12.1.3.1.1.3.j.q.b.1.7.1.2.1.4.1.o|15.8.i.p.c.1.h.1.l|15.a.h.2.4.h.j.1.1.1.5.2.o|15.b.o.e.k.2.1.1.3.2.p|z.1.4.c.o.d.n.1.3.3.p|14.e.m.c.o.3.1.3.1.1.4.1.1.1.g|14.h.k.b.p.1.d.3.e|14.i.j.b.r.2.7.1.2.4.d|15.h.j.b.x.1.9.2.b|15.g.k.b.10.3.h|16.e.l.b.3.1.u.4.3.1.e|17.d.l.a.3.2.t.9.e|18.c.l.9.4.2.s.b.d|18.b.n.8.3.2.q.f.c|18.9.p.8.4.1.q.g.b|18.9.p.7.x.f.b|17.9.r.5.y.f.b|17.8.s.4.z.4.4.7.b|17.6.26.5.c|17.6.27.4.c|17.4.2n.1.1|16.5.2b.1.9.1.3|17.2.2m.1.4|16.4.2q|16.3.2r|16.2.2s|18.1.2r';
const MAP_W = 720, MAP_H = 282;
const proj = ([lon, lat]) => [(lon + 180) * 2, (82.5 - lat) * 2 + 2.5];
function landPath(){
  if (landPath.c) return landPath.c;
  let d = '';
  LAND.split('|').forEach((row, r) => { let x = 0, on = false; row.split('.').forEach(n => { n = parseInt(n, 36); if (on) for (let i = 0; i < n; i++) d += `M${(x+i)*5+2.5} ${r*5+2.5}h0`; x += n; on = !on; }); });
  return landPath.c = `<path d="${d}" stroke="var(--map-land)" stroke-width="3.2" stroke-linecap="round" fill="none"/>`;
}
function coverageMap(){
  const cc = {}; state.items.forEach(i => i.countries.forEach(c => { if (COORDS[c]) cc[c] = (cc[c] || 0) + 1; }));
  const entries = Object.entries(cc).sort((a,b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  const labelled = new Set(entries.slice(0, 6).map(e => e[0]));
  const bubbles = [...entries].reverse().map(([c, n]) => {
    const [x, y] = proj(COORDS[c]); const r = 5 + Math.sqrt(n / max) * 13;
    const lab = labelled.has(c) ? `<text x="${x + r + 4}" y="${y + 4}">${esc(c)} · ${n}</text>` : '';
    return `<a href="${filterHash({ country: c })}" aria-label="${esc(c)}: ${plural(n,'noticia')}"><title>${esc(c)}: ${plural(n,'noticia')}</title><circle class="bubble" cx="${x}" cy="${y}" r="${r.toFixed(1)}"/>${lab}</a>`;
  }).join('');
  const rc = REGIONS.map(r => [r, state.items.filter(i => regionsOf(i).has(r)).length]).filter(([,n]) => n);
  const rmax = Math.max(1, ...rc.map(x => x[1]));
  return `<div class="map-box">
    <svg viewBox="0 0 ${MAP_W} ${MAP_H}" role="group" aria-label="Mapa de países con noticias. Cada círculo filtra las noticias de ese país.">${landPath()}${bubbles}</svg>
    <ul class="regions" aria-label="Noticias por región">${rc.map(([r,n]) => `<li><button type="button" data-region="${esc(r)}" aria-label="${esc(r)}: ${plural(n,'noticia')}"><span>${esc(r)}</span><span class="track"><span class="fill" style="width:${Math.round(n/rmax*100)}%"></span></span><span class="num">${n}</span></button></li>`).join('')}</ul>
  </div>`;
}

/* =====================================================================
   9. ICONOS
   ===================================================================== */
const I = {
  link:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  share:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  save:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  ext:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  back:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'
};

/* =====================================================================
   10. COMPONENTES
   ===================================================================== */
const placeLine = it => { const c = it.countries.filter(x => x !== 'Global'); return c.length ? c.slice(0,2).join(', ') + (c.length > 2 ? ' y otros' : '') : 'Global'; };
const srcStamp = (it, link = true) => {
  const inner = `<span class="k">Fuente</span><b>${esc(it.primary.name)}</b><span>· ${esc(shortDate(itemDate(it)))}</span>`;
  return link ? `<a class="srcstamp" href="${esc(it.primary.url)}" target="_blank" rel="noopener noreferrer" title="Abrir el artículo original en ${esc(it.primary.name)}">${inner}</a>` : `<span class="srcstamp">${inner}</span>`;
};
const metaLine = (it, { ago = false } = {}) => `<div class="meta">${srcStamp(it)}<span class="dot"></span><span>${esc(placeLine(it))}</span>${ago ? `<span class="dot"></span><span data-rel="${esc(it.id)}">${esc(relTime(it))}</span>` : ''}</div>`;
const category = it => it.topics.find(t => t !== 'Argentina') || it.topics[0] || 'Comercio exterior';
const eyebrow = it => `<span class="eyebrow">${esc(category(it))}</span>`;
const kindBadge = (it, always = false) => (always || it.kind !== 'noticia') ? `<span class="kind ${esc(it.kind)}">${esc(KINDS[it.kind])}</span>` : '';
const newBadge = it => state.newIds.has(it.id) ? '<span class="new">Nueva</span>' : '';
const argFlag = it => it.affectsArgentina ? '<span class="flag-ar">Impacto en Argentina</span>' : '';
const IMPACT_TXT = { 1:'Impacto bajo', 2:'Impacto medio', 3:'Impacto alto' };
const impactMeter = it => `<span class="imp l${it.impact}" title="Valoración editorial del impacto comercial"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>${IMPACT_TXT[it.impact]}</span>`;
const tagRow = (it, n = 3) => it.tags.length ? `<div class="tagrow">${it.tags.slice(0,n).map(t => `<button type="button" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : '';
const headRow = it => `<div class="eyebrow-row">${eyebrow(it)}${kindBadge(it)}${newBadge(it)}${argFlag(it)}</div>`;

const sitePath = () => new URL(BASE).pathname.replace(/\/+$/, '');
// Direcciones propias (indexables) de secciones y herramientas. scripts/build_pages.py genera una página en cada una.
const PRETTY = { datos:'datos', agenda:'agenda', glosario:'glosario', fuentes:'fuentes', calculadora:'calculadora-importacion',
  exportacion:'calculadora-exportacion', guias:'guias', acerca:'quienes-somos', contacto:'contacto', privacidad:'privacidad', terminos:'terminos' };
const guideBySlug = slug => (SITE_DATA.guides || []).find(g => g.slug === slug);
function prettyPath(h){   // h: ruta con hash sin '#', ej. 'tema-aduanas' → 'seccion/aduanas/'
  if (PRETTY[h]) return PRETTY[h] + '/';
  if (h.startsWith('tema-')){ const sec = sectionBySlug(h.slice(5)); if (sec) return 'seccion/' + sec.slug + '/'; }
  if (h.startsWith('hilo-') && (state.stories || []).some(x => x.id === h.slice(5))) return 'tema/' + h.slice(5) + '/';
  if (h.startsWith('guia-') && guideBySlug(h.slice(5))) return 'guias/' + h.slice(5) + '/';
  return null;
}
function hashFromPretty(rel){
  const k = Object.keys(PRETTY).find(k => PRETTY[k] === rel); if (k) return k;
  let m = rel.match(/^seccion\/([a-z0-9-]+)$/); if (m && sectionBySlug(m[1])) return 'tema-' + m[1];
  m = rel.match(/^tema\/([a-z0-9-]+)$/); if (m) return 'hilo-' + m[1];
  m = rel.match(/^guias\/([a-z0-9-]+)$/); if (m && guideBySlug(m[1])) return 'guia-' + m[1];
  return null;
}
const prettyHref = h => `${sitePath()}/${prettyPath(h)}`;
// Cambia los enlaces internos con hash (#datos, #tema-…) por su dirección propia.
function prettifyLinks(){
  if (!CONFIG.prettyUrls) return;
  for (const a of $$('a[href^="#"]')){ const h = decodeURIComponent(a.getAttribute('href').slice(1)); if (prettyPath(h)) a.setAttribute('href', prettyHref(h)); }
}
function articleHref(it){
  return CONFIG.prettyUrls ? `${sitePath()}/noticias/${encodeURIComponent(it.id)}/` : `#${it.id}`;
}
function goArticle(id){
  if (CONFIG.prettyUrls){
    const target = `${sitePath()}/noticias/${encodeURIComponent(id)}/`;
    if (location.pathname === target && !location.hash) return route();
    location.href = target;
    return;
  }
  go('#'+id);
}

function card(it){
  return `<article class="card">
    <a href="${esc(articleHref(it))}" class="art" tabindex="-1" aria-hidden="true">${media(it, 640)}</a>
    ${headRow(it)}
    <h3><a href="${esc(articleHref(it))}">${hl(it.title)}</a></h3>
    <p>${hl(it.summary)}</p>
    ${metaLine(it, { ago: true })}
  </article>`;
}
function listItem(it){
  const d = dayDiff(it);
  return `<li class="li">
    <a href="${esc(articleHref(it))}" class="art" tabindex="-1" aria-hidden="true">${media(it, 360, { caption:false })}</a>
    <div style="min-width:0">
      <div class="eyebrow-row"><span class="when${d<=1?' fresh':''}" data-rel="${esc(it.id)}">${esc(relTime(it))}${it.datetime ? ' · ' + esc(timeLabel(it)) : ''}</span>${eyebrow(it)}${kindBadge(it)}${newBadge(it)}${argFlag(it)}</div>
      <h3><a href="${esc(articleHref(it))}">${hl(it.title)}</a></h3>
      <p>${hl(it.summary)}</p>
      <div class="bottom">${metaLine(it)}${tagRow(it)}</div>
    </div>
  </li>`;
}
// Lista cronológica con separadores por día.
function chronoList(list){
  let last = '', out = '';
  for (const it of list){
    if (it.date !== last){ last = it.date; const d = dayDiff(it); out += `<li class="day-sep" aria-hidden="true">${d === 0 ? 'Hoy' : d === 1 ? 'Ayer' : cap(fmtDayHead.format(itemDate(it)))}</li>`; }
    out += listItem(it);
  }
  return `<ul class="list">${out}</ul>`;
}
function indicatorCard(d, tag = 'a'){
  const arrow = d.trend === 'up' ? '▲' : d.trend === 'down' ? '▼' : '';
  const dir = d.trend === 'up' ? 'up' : d.trend === 'down' ? 'down' : 'flat';
  const value = d.value
    ? `<span class="v">${esc(d.value)}</span>${d.change ? `<span class="c ${dir}"><span aria-hidden="true">${arrow}</span> ${esc(d.change)}<span class="sr">${dir === 'up' ? ' (sube)' : dir === 'down' ? ' (baja)' : ''}</span></span>` : ''}`
    : `<span class="v na">Sin datos disponibles</span><span class="c flat">${esc(d.pending || 'Pendiente de conexión')}</span>`;
  const body = `<span class="l">${esc(d.label)}</span>${value}<span class="p">${esc(d.period || '—')}</span><span class="s">Fuente: ${esc(d.source || 'sin fuente')}</span>`;
  return d.url && tag === 'a' ? `<a class="ind-card" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${body}</a>` : `<div class="ind-card">${body}</div>`;
}
const tickerItem = d => {
  const dir = d.trend === 'up' ? 'up' : d.trend === 'down' ? 'down' : 'flat';
  const arrow = d.trend === 'up' ? '▲' : d.trend === 'down' ? '▼' : '';
  return `<a class="tk" href="${esc(d.url || '#datos')}" ${d.url ? 'target="_blank" rel="noopener noreferrer"' : ''} title="${esc(d.period)} · ${esc(d.source)}"><span class="l">${esc(d.label)}</span>${d.value ? `<span class="v">${esc(d.value)}</span><span class="c ${dir}">${arrow} ${esc(d.change)}</span>` : '<span class="c flat">Sin datos</span>'}</a>`;
};
const emptyState = (title, text, extra = '') => `<div class="empty"><h3>${esc(title)}</h3><p>${text}</p>${extra}</div>`;

/* =====================================================================
   10b. AGENDA, TEMAS EN DESARROLLO Y GLOSARIO
   ---------------------------------------------------------------------
   Agenda: cada nota curada puede traer "deadlines": [{ date, label, url? }].
     date "AAAA-MM-DD" (día exacto) o "AAAA-MM" (mes sin día confirmado).
   Temas: "stories" en la raíz del feed ({ id, title, desc, match[] }) y "story": "<id>" en cada nota.
     match: expresiones (sobre texto sin acentos, en minúsculas) para sumar cobertura automática del tema.
   Glosario: siglas y términos técnicos explicados al pasar el mouse o tocar (solo en notas curadas).
   ===================================================================== */
const fmtMonthYear = new Intl.DateTimeFormat('es-AR', { timeZone:'UTC', month:'long', year:'numeric' });
const fmtDLday = new Intl.DateTimeFormat('es-AR', { timeZone:'UTC', day:'numeric' });
const fmtDLmon = new Intl.DateTimeFormat('es-AR', { timeZone:'UTC', month:'short' });
const fmtDLshort = new Intl.DateTimeFormat('es-AR', { timeZone:'UTC', day:'numeric', month:'short', year:'numeric' });
const fmtDLlong = new Intl.DateTimeFormat('es-AR', { timeZone:'UTC', weekday:'long', day:'numeric', month:'long', year:'numeric' });
const DAY_MS = 86400000;

function deadlineInfo(d){
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(d?.date || ''));
  if (!m || !d.label) return null;
  const y = +m[1], mo = +m[2], day = m[3] ? +m[3] : 0;
  const start = Date.UTC(y, mo - 1, day || 1);
  const end = day ? start : Date.UTC(y, mo, 0);           // último día del mes
  const today = ymdToUTC(todayYMD());
  return { date: d.date, label: d.label, url: d.url || '', start, end, monthOnly: !day,
    days: Math.round((start - today) / DAY_MS), past: end < today, thisMonth: !day && start <= today && end >= today };
}
function deadlineList(items = state.items){
  return items.flatMap(it => (it.deadlines || []).map(d => { const x = deadlineInfo(d); return x ? { ...x, it } : null; }).filter(Boolean))
    .sort((a, b) => a.start - b.start || a.label.localeCompare(b.label, 'es'));
}
const upcomingDeadlines = () => deadlineList().filter(d => !d.past);
function whenText(d){
  if (d.monthOnly) return d.past ? 'Mes cumplido' : d.thisMonth ? 'Este mes, día a confirmar' : 'Día a confirmar';
  if (d.past) return d.days === -1 ? 'Fue ayer' : `Hace ${-d.days} días`;
  if (d.days === 0) return 'Hoy';
  if (d.days === 1) return 'Mañana';
  if (d.days <= 45) return `En ${d.days} días`;
  return `En ${Math.round(d.days / 30)} meses`;
}
const dateLong = d => d.monthOnly ? cap(fmtMonthYear.format(new Date(d.start))) : cap(fmtDLlong.format(new Date(d.start)));
const dateBadge = d => d.monthOnly
  ? `<span class="dl-date month" aria-hidden="true"><b>${esc(fmtDLmon.format(new Date(d.start)).replace('.', ''))}</b><span>${new Date(d.start).getUTCFullYear()}</span></span>`
  : `<span class="dl-date" aria-hidden="true"><b>${esc(fmtDLday.format(new Date(d.start)))}</b><span>${esc(fmtDLmon.format(new Date(d.start)).replace('.', ''))}</span></span>`;
function deadlineRow(d, { link = true } = {}){
  const soon = !d.past && !d.monthOnly && d.days <= 7;
  return `<li class="dl-row${soon ? ' soon' : ''}${d.past ? ' past' : ''}">${dateBadge(d)}<div class="dl-body">
    <p class="dl-label">${esc(d.label)}</p>
    <span class="dl-meta"><span class="sr">${esc(dateLong(d))}. </span><b>${esc(whenText(d))}</b>${link ? ` · <a href="${esc(articleHref(d.it))}">Ver la nota</a>` : ''}${d.url ? ` · <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Fuente de la fecha</a>` : ''}</span>
  </div></li>`;
}
const deadlineListHtml = (list, opts) => `<ul class="dl-list">${list.map(d => deadlineRow(d, opts)).join('')}</ul>`;

function normalizeStory(s){
  if (!s || !s.id || !s.title) return null;
  const match = (s.match || []).map(r => { try { return new RegExp(r, 'i'); } catch (e) { return null; } }).filter(Boolean);
  return { id: String(s.id), title: s.title, desc: s.desc || '', match };
}
const storyById = id => state.stories.find(s => s.id === id);
const storyHref = s => '#hilo-' + s.id;
const storyItems = id => byDate(state.items.filter(i => i.story === id));
function storyCoverage(s, own){
  // Notas automáticas recientes sobre el mismo tema (sin revisión editorial): se listan aparte.
  if (!s.match.length || !own.length) return [];
  const from = Math.min(...own.map(i => +itemDate(i))) - 3 * DAY_MS;
  return byDate(state.items.filter(i => i.label === 'Automática' && !i.story && +itemDate(i) >= from
    && s.match.some(r => r.test(norm(i.title + ' ' + i.summary)))));
}
const activeStories = () => state.stories.map(s => ({ s, list: storyItems(s.id) }))
  .filter(x => x.list.length >= 2).sort((a, b) => itemDate(b.list[0]) - itemDate(a.list[0]));

function storyBox(it){
  const s = storyById(it.story); if (!s) return '';
  const list = storyItems(s.id); if (list.length < 2) return '';
  return `<section class="story-box" aria-labelledby="h-story">
    <span class="eyebrow">Tema en desarrollo</span>
    <h2 class="panel-h" id="h-story">${esc(s.title)}</h2>
    <ol class="timeline">${list.map(o => `<li${o.id === it.id ? ' class="cur" aria-current="true"' : ''}><time datetime="${esc(o.datetime || o.date)}">${esc(shortDate(itemDate(o)))}</time>${o.id === it.id
      ? `<span>${esc(o.title)} <em>· esta nota</em></span>` : `<a href="${esc(articleHref(o))}">${esc(o.title)}</a>`}</li>`).join('')}</ol>
    <a class="foot-link" href="${esc(storyHref(s))}">Ver el tema completo →</a>
  </section>`;
}

const GLOSSARY = (SITE_DATA.glossary || []).map(([term, pat, def]) => ({ term, def, rx: new RegExp('^(?:' + pat + ')$', 'u'), pat }));
const GLOSS_RX = new RegExp('(?<![\\p{L}\\p{N}])(?:' + [...GLOSSARY].sort((a, b) => b.pat.length - a.pat.length).map(g => g.pat).join('|') + ')(?![\\p{L}\\p{N}])', 'gu');
const glossEntry = term => GLOSSARY.find(g => g.term === term);
// Recibe texto ya escapado; marca la primera aparición de cada término en la nota.
function gloss(html, used){
  return html.replace(GLOSS_RX, m => {
    const g = GLOSSARY.find(x => x.rx.test(m));
    if (!g || used.has(g.term)) return m;
    used.add(g.term);
    return `<abbr class="gl" tabindex="0" role="button" title="${esc(g.def)}" data-gl="${esc(g.term)}">${m}</abbr>`;
  });
}

/* =====================================================================
   11. VISTAS
   ===================================================================== */
function renderHome(){
  const items = state.items;
  if (!items.length){
    $('#main').innerHTML = emptyState('Estamos actualizando las noticias', `No se pudo leer ninguna fuente en este momento. La página vuelve a intentarlo cada ${CONFIG.refreshMinutes} minutos.`);
    return;
  }
  const ranked = byScore(items);
  const hero = ranked[0];
  const featured = ranked.slice(1, 7);
  const wire = items.slice(0, 6);
  const arItems = items.filter(i => i.topics.includes('Argentina') || i.affectsArgentina).slice(0, 4);
  const arInd = ['arg-expo','arg-impo','arg-saldo'].map(id => state.indicators.find(d => d.id === id)).filter(Boolean);
  const mainInd = state.indicators.filter(d => d.value).slice(0, 8);
  const latest = items.slice(0, state.listCount);
  const sc = score(hero);
  const forYou = prefs.topics.length ? items.filter(i => i.topics.some(t => prefs.topics.includes(t))).slice(0, 4) : [];
  const nextDates = upcomingDeadlines().slice(0, 5);
  const stories = activeStories().slice(0, 6);

  $('#main').innerHTML = `
  <section class="sec top" aria-labelledby="h-hero">
    <article class="hero">
      <a href="${esc(articleHref(hero))}" class="art" tabindex="-1" aria-hidden="true">${media(hero, 1100, { eager:true })}</a>
      <div class="hero-body">
        <div class="eyebrow-row"><span class="eyebrow">Noticia principal · ${esc(category(hero))}</span>${kindBadge(hero)}${argFlag(hero)}</div>
        <h2 id="h-hero"><a href="${esc(articleHref(hero))}">${esc(hero.title)}</a></h2>
        <p class="sum">${esc(hero.summary)}</p>
        <dl class="facts">
          <div><dt>Fecha</dt><dd>${esc(shortDate(itemDate(hero)))}${hero.datetime ? ' · ' + esc(timeLabel(hero)) : ''}</dd></div>
          <div><dt>Fuente</dt><dd><a href="${esc(hero.primary.url)}" target="_blank" rel="noopener noreferrer">${esc(hero.primary.name)}</a></dd></div>
          <div><dt>País / región</dt><dd>${esc(hero.countries.slice(0,3).join(', '))}${hero.countries.length>3?' y otros':''}</dd></div>
          <div><dt>Impacto</dt><dd>${impactMeter(hero)}</dd></div>
        </dl>
        <div class="hero-actions">
          <a class="btn primary" href="${esc(articleHref(hero))}">Leer la noticia</a>
          <span class="note" data-rel="${esc(hero.id)}">${esc(relTime(hero))}</span>
          <span class="note">· Relevancia ${sc.total}/11</span>
        </div>
      </div>
    </article>
    <section class="wire" aria-labelledby="h-wire">
      <h2 id="h-wire">Al minuto <span class="note" style="letter-spacing:0;text-transform:none">${esc(state.updatedAt ? 'Feed ' + agoText(new Date(state.updatedAt)) : '')}</span></h2>
      <ol>${wire.map(it => `<li><time datetime="${esc(it.datetime || it.date)}">${esc(it.datetime ? fmtTime.format(new Date(it.datetime)) : fmtDM.format(itemDate(it)).replace('.', ''))}</time><div><a href="${esc(articleHref(it))}">${esc(it.title)}</a><span class="s">${esc(it.primary.name)} · ${esc(category(it))}</span></div></li>`).join('')}</ol>
      <a class="all" href="#ultimas">Todas las últimas noticias ↓</a>
    </section>
  </section>

  ${forYou.length ? `<section class="sec" aria-labelledby="h-you">
    <div class="sec-h"><h2 id="h-you">Para vos</h2><p>Según tus temas: ${esc(prefs.topics.slice(0,4).join(', '))}${prefs.topics.length>4?'…':''} · <button class="btn sm" type="button" data-open-prefs>Editar</button></p></div>
    <div class="cards">${forYou.slice(0,3).map(card).join('')}</div>
  </section>` : ''}

  <section class="sec" aria-labelledby="h-ind">
    <div class="sec-h"><h2 id="h-ind">Indicadores COMEX</h2><a class="more-link" href="#datos">Todos los indicadores →</a></div>
    <div class="ind-grid">${mainInd.map(d => indicatorCard(d)).join('')}</div>
    <p class="ind-note">Últimos datos publicados por cada fuente. Cada valor enlaza a su publicación original.</p>
  </section>

  ${nextDates.length ? `<section class="sec" aria-labelledby="h-agenda">
    <div class="sec-h"><h2 id="h-agenda">Próximas fechas</h2><a class="more-link" href="#agenda">Agenda completa →</a></div>
    <div class="agenda-home">${deadlineListHtml(nextDates)}</div>
  </section>` : ''}

  <section class="sec" aria-labelledby="h-dest">
    <div class="sec-h"><h2 id="h-dest">Noticias destacadas</h2><p>Ordenadas por relevancia editorial</p></div>
    <div class="cards">${featured.map(card).join('')}</div>
  </section>

  ${stories.length ? `<section class="sec" aria-labelledby="h-stories">
    <div class="sec-h"><h2 id="h-stories">Temas en desarrollo</h2><p>Notas agrupadas por tema</p></div>
    <div class="stories">${stories.map(({ s, list }) => `<article class="story-card">
      <span class="eyebrow">${plural(list.length, 'nota')} · última ${esc(agoText(itemDate(list[0])))}</span>
      <h3><a href="${esc(storyHref(s))}">${esc(s.title)}</a></h3>
      <p>${esc(s.desc)}</p>
      <ol>${list.slice(0, 2).map(o => `<li><time datetime="${esc(o.datetime || o.date)}">${esc(fmtDM.format(itemDate(o)).replace('.', ''))}</time><a href="${esc(articleHref(o))}">${esc(o.title)}</a></li>`).join('')}</ol>
      <a class="foot-link" href="${esc(storyHref(s))}">Seguir el tema →</a>
    </article>`).join('')}</div>
  </section>` : ''}

  <section class="sec" aria-labelledby="h-ar">
    <div class="ar-block">
      <div class="ar-head"><h2 id="h-ar">Comercio exterior argentino</h2><a href="#tema-argentina">Ir a la sección →</a></div>
      ${arInd.length ? `<div class="ar-kpis">${arInd.map(d => indicatorCard(d)).join('')}</div>` : ''}
      <div class="ar-rows">${arItems.map(it => `<div class="ar-row">
        <div style="min-width:0"><div class="eyebrow-row">${eyebrow(it)}${isIntl(it) && it.affectsArgentina ? '<span class="flag-ar">Internacional con impacto local</span>' : ''}</div>
        <h3><a href="${esc(articleHref(it))}">${esc(it.title)}</a></h3><p>${esc(it.argentinaNote || it.summary)}</p></div>
        <span class="note" data-rel="${esc(it.id)}">${esc(relTime(it))}</span>
      </div>`).join('')}</div>
    </div>
  </section>

  <section class="sec split" aria-label="Ranking y cobertura">
    <div>
      <div class="sec-h"><h2>Lo más importante</h2><p>Ranking con criterios explícitos</p></div>
      <ol class="ranked">${ranked.slice(0,5).map((it,i) => { const s = score(it); return `<li>
        <span class="rk">${i+1}</span>
        <div style="min-width:0">${eyebrow(it)}<h3><a href="${esc(articleHref(it))}">${esc(it.title)}</a></h3>
          <div class="score" aria-label="Desglose de relevancia"><span>Actualidad ${s.actualidad}/3</span><span>Impacto ${s.impacto}/3</span><span>Alcance ${s.alcance}/3</span><span>Argentina ${s.argentina}/2</span></div></div>
        <div class="score-total">${s.total}<small>de 11</small></div>
      </li>`; }).join('')}</ol>
      <p class="criteria"><b>Actualidad</b>: hoy o ayer 3, hasta 3 días 2, hasta 7 días 1. <b>Impacto</b>: valoración editorial de 1 a 3. <b>Alcance</b>: países involucrados. <b>Argentina</b>: +2 si cambia condiciones para operadores argentinos. No usa datos de audiencia.</p>
    </div>
    <div>
      <div class="sec-h"><h2>Mapa de la cobertura</h2><p>Tocá un país o región para filtrar</p></div>
      ${coverageMap()}
    </div>
  </section>

  <section class="sec" aria-labelledby="h-last" id="ultimas" tabindex="-1">
    <div class="sec-h"><h2 id="h-last">Últimas noticias</h2><p>Orden cronológico, de la más reciente a la más antigua · ${plural(items.length,'noticia')}</p></div>
    ${chronoList(latest)}
    ${state.listCount < items.length ? `<div class="more"><button class="btn" type="button" id="loadMore">Cargar más noticias (${items.length - state.listCount})</button></div>` : '<p class="note" style="text-align:center;margin-top:18px">Llegaste al final del archivo.</p>'}
  </section>`;
  setSEO({ title:`${CONFIG.siteName} · Noticias de Comercio Exterior`, desc:'Noticias y actualidad del comercio exterior, con fuentes identificadas y enlaces al contenido original.',
    ld: { '@type':'ItemList', name:'Noticias de Comercio Exterior', itemListElement: items.slice(0,10).map((it,i) => ({ '@type':'ListItem', position:i+1, url: shareUrl(it), name: it.title })) } });
}

function sectionHeader(s, n, extra = ''){
  const g = s.slug && groupOf(s.slug);
  const eyebrowTxt = g && g.slug !== s.slug ? `<a href="#tema-${g.slug}">${esc(g.label)}</a>` : 'Sección';
  return `<div class="sec-intro"><div style="min-width:0"><span class="eyebrow">${eyebrowTxt}</span><h2>${esc(s.title || s.label)}</h2><p>${esc(s.desc)}</p></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="rcount"><b>${n}</b> ${n===1?'noticia':'noticias'}</span>${extra}</div></div>${subNav(s)}`;
}
// Accesos a las secciones del mismo bloque (en la página del bloque, sus secciones; en una sección, sus hermanas).
function subNav(s){
  const g = s.slug && groupOf(s.slug); if (!g) return '';
  const list = g.sections.map(sectionBySlug).filter(x => x && x.slug !== s.slug)
    .map(x => [x, state.items.filter(i => inSection(i, x)).length]).filter(([, n]) => n);
  if (!list.length) return '';
  return `<nav class="subnav" aria-label="${g.slug === s.slug ? 'Secciones de ' : 'Más en '}${esc(g.label)}"><span class="note">${g.slug === s.slug ? 'En esta sección:' : 'Más en ' + esc(g.label) + ':'}</span>${list.map(([x, n]) => `<a href="#tema-${x.slug}">${esc(x.label)} <span>${n}</span></a>`).join('')}</nav>`;
}
function renderSection(){
  const s = sectionBySlug(state.filters.section);
  const list = byDate(state.items.filter(it => matches(it)));
  if (!list.length){
    $('#main').innerHTML = sectionHeader(s, 0) + emptyState(`Todavía no hay noticias en ${s.title}`,
      'Cuando el sitio incorpore notas sobre este tema, aparecerán acá automáticamente. Mientras tanto podés recorrer las secciones relacionadas.',
      `<div class="tagrow">${(groupOf(s.slug)?.sections || []).filter(x => x !== s.slug).slice(0,6).map(sectionBySlug).filter(Boolean).map(x => `<button type="button" data-section="${esc(x.slug)}">${esc(x.label)}</button>`).join('')}</div>`);
  } else {
    const lead = byScore(list)[0], rest = list.filter(i => i !== lead);
    $('#main').innerHTML = sectionHeader(s, list.length, `<a class="btn sm" href="${filterHash({ section: s.slug, date:'7' })}">Últimos 7 días</a>`) + `
      <article class="hero" style="margin-bottom:30px"><a href="${esc(articleHref(lead))}" class="art" tabindex="-1" aria-hidden="true">${media(lead, 1100, { eager:true })}</a>
        <div class="hero-body">${headRow(lead)}<h2><a href="${esc(articleHref(lead))}">${esc(lead.title)}</a></h2><p class="sum">${esc(lead.summary)}</p>${metaLine(lead, { ago:true })}</div></article>
      ${rest.length ? `<div class="sec-h"><h2>Más en ${esc(s.title)}</h2><p>Orden cronológico</p></div>${chronoList(rest.slice(0, state.listCount * 3))}${rest.length > state.listCount * 3 ? `<div class="more"><button class="btn" type="button" id="loadMore">Cargar más (${rest.length - state.listCount * 3})</button></div>` : ''}` : ''}`;
  }
  const g = groupOf(s.slug);
  setSEO({ title:`${s.title} · Noticias de comercio exterior · ${CONFIG.siteName}`, desc: s.desc,
    crumbs: g && g.slug !== s.slug ? [[g.label, '#tema-' + g.slug], [s.label]] : [[s.title]] });
}

function renderArgentina(){
  const s = sectionBySlug('argentina');
  const local = byDate(state.items.filter(i => i.topics.includes('Argentina')));
  const intl = byDate(state.items.filter(i => i.affectsArgentina && isIntl(i)));
  const inds = state.indicators.filter(d => d.group === 'Argentina');
  const block = (title, list, link) => list.length ? `<section class="sec"><div class="sec-h"><h2>${esc(title)}</h2>${link ? `<a class="more-link" href="${link}">Ver todas →</a>` : ''}</div>${chronoList(list.slice(0,4))}</section>` : '';
  const pick = t => local.filter(i => i.topics.includes(t));
  const axes = [['Energía','energia'],['Minería','mineria'],['Agroexportaciones','agro'],['Puertos argentinos','puerto'],['ARCA','arca'],['Carne vacuna','carne']]
    .map(([label, q]) => [label, q, state.items.filter(i => textScore(i, q) >= 0 && (i.topics.includes('Argentina') || i.affectsArgentina)).length]).filter(x => x[2]);
  $('#main').innerHTML = `
    ${sectionHeader(s, local.length)}
    ${state.trade ? tradePanel({ full: false }) : inds.length ? `<section class="sec"><div class="sec-h"><h2>Datos del intercambio</h2><a class="more-link" href="#datos">Todos los indicadores →</a></div><div class="ind-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">${inds.map(d => indicatorCard(d)).join('')}</div></section>` : ''}
    ${axes.length ? `<div class="active" style="margin-top:22px"><span class="note">Ejes que sigue la sección:</span>${axes.map(([l,q,n]) => `<button type="button" data-q="${esc(q)}" data-arg="1">${esc(l)} <span>${n}</span></button>`).join('')}</div>` : ''}
    ${block('Exportaciones', pick('Exportaciones'), filterHash({ section:'argentina', flow:'exportaciones' }))}
    ${block('Importaciones', pick('Importaciones'), filterHash({ section:'argentina', flow:'importaciones' }))}
    ${block('Aduanas y ARCA', pick('Aduanas'), filterHash({ section:'argentina', topic:'Aduanas' }))}
    ${block('Mercosur y acuerdos comerciales', local.filter(i => i.topics.includes('Mercosur') || i.topics.includes('Tratados y acuerdos')), filterHash({ section:'argentina', topic:'Mercosur' }))}
    ${block('Regulaciones', pick('Regulaciones'), filterHash({ section:'argentina', topic:'Regulaciones' }))}
    <section class="sec"><div class="sec-h"><h2>Noticias internacionales con impacto en Argentina</h2><p>Hechos de otros países o bloques que cambian condiciones para operadores argentinos</p></div>
      ${intl.length ? `<div class="cards">${intl.slice(0,6).map(card).join('')}</div>` : emptyState('Sin noticias internacionales marcadas', 'No hay notas del exterior con impacto en Argentina en el archivo actual.')}</section>`;
  setSEO({ title:`Comercio exterior argentino · ${CONFIG.siteName}`, desc: s.desc, crumbs:[['Argentina']] });
}

const FILTER_LABELS = {
  q: v => `“${v}”`, section: v => `Sección: ${sectionBySlug(v)?.label || v}`, topic: v => v, region: v => `Región: ${v}`, country: v => `País: ${v}`,
  date: v => `Fecha: ${$('#fDate').querySelector(`option[value="${v}"]`)?.textContent || v}`, source: v => `Fuente: ${v}`, tag: v => `#${v}`,
  arg: () => 'Impacto en Argentina', flow: v => cap(v), kind: v => KINDS[v] || v
};
function resultsTitle(){
  const f = state.filters, n = filterCount(f);
  if (n === 1 && f.topic) return f.topic;
  if (n === 1 && f.kind) return KINDS[f.kind] === 'Análisis' ? 'Análisis' : KINDS[f.kind];
  if (n === 1 && f.tag) return '#' + f.tag;
  if (n === 1 && f.country) return 'Noticias de ' + f.country;
  if (n === 1 && f.region) return 'Región: ' + f.region;
  return f.q ? 'Resultados de búsqueda' : 'Noticias filtradas';
}
function renderResults(){
  const res = results();
  const chips = Object.entries(state.filters).filter(([,v]) => v !== '').map(([k,v]) => `<button type="button" data-clear="${k}" aria-label="Quitar filtro ${esc(FILTER_LABELS[k](v))}">${esc(FILTER_LABELS[k](v))}<span aria-hidden="true">✕</span></button>`).join('');
  const popular = topTrends(8);
  $('#main').innerHTML = `<section>
    <div class="rhead"><div><h2>${esc(resultsTitle())}</h2><p class="rcount" aria-live="polite"><b>${res.length}</b> ${res.length===1?'resultado':'resultados'} de ${state.items.length} noticias</p></div>
      <label class="rtools" for="sortSel">Ordenar por <select id="sortSel"><option value="relevancia"${state.sort==='relevancia'?' selected':''}>Relevancia</option><option value="fecha"${state.sort==='fecha'?' selected':''}>Más recientes</option></select></label></div>
    <div class="active">${chips}<button type="button" class="clear" data-clear="all">Limpiar todo</button></div>
    ${res.length ? `<ul class="list">${res.slice(0, state.listCount).map(listItem).join('')}</ul>${state.listCount < res.length ? `<div class="more"><button class="btn" type="button" id="loadMore">Ver más resultados (${res.length - state.listCount})</button></div>` : ''}`
      : emptyState('No hay noticias con esos filtros', `Probá con otra palabra, ampliá el rango de fechas o quitá algún filtro. El archivo incluye ${plural(state.items.length,'noticia')}.`,
        `<button class="btn sm" type="button" data-clear="all">Ver todas las noticias</button><div class="tagrow">${popular.map(t => `<button type="button" data-${t.type}="${esc(t.label)}">${esc(t.label)}</button>`).join('')}</div>`)}
  </section>`;
  $('#sortSel').onchange = e => { state.sort = e.target.value; applyFilters({}, { replace:true }); };
  setSEO({ title:`${resultsTitle()} · ${CONFIG.siteName}`, desc:'Resultados filtrados de noticias de comercio exterior.', crumbs:[['Noticias','#inicio'],['Búsqueda']], noindex:true });
}

function impactBlock(it){
  if (!it.affectsArgentina || !(it.argentinaNote || it.argentinaImpact)) return '';
  const ai = it.argentinaImpact || {};
  const derived = !ai.flows;
  const flows = ai.flows || {
    importaciones: it.topics.includes('Importaciones'), exportaciones: it.topics.includes('Exportaciones'),
    logistica: it.topics.some(t => ['Logística','Transporte marítimo','Transporte aéreo','Puertos'].includes(t)),
    aranceles: it.topics.some(t => ['Aranceles','Impuestos'].includes(t))
  };
  const F = [['importaciones','Importaciones'],['exportaciones','Exportaciones'],['logistica','Logística'],['aranceles','Aranceles y tributos']];
  return `<section class="impact" aria-labelledby="h-impact">
    <h2 class="panel-h" id="h-impact">Impacto en Argentina</h2>
    ${it.argentinaNote ? `<p>${esc(it.argentinaNote)}</p>` : ''}
    ${(ai.change || ai.who || ai.sectors?.length) ? `<dl>
      ${ai.change ? `<dt>Qué cambió</dt><dd>${esc(ai.change)}</dd>` : ''}
      ${ai.who ? `<dt>A quién afecta</dt><dd>${esc(ai.who)}</dd>` : ''}
      ${ai.sectors?.length ? `<dt>Sectores</dt><dd>${esc(ai.sectors.join(', '))}</dd>` : ''}
    </dl>` : ''}
    <div class="flows" aria-label="Áreas alcanzadas">${F.map(([k,l]) => `<span class="${flows[k] ? 'on' : ''}">${l}${flows[k] ? '' : '<span class="sr"> (no alcanzada)</span>'}</span>`).join('')}</div>
    <p class="basis">${derived ? 'Áreas marcadas según la clasificación de la nota.' : 'Elaborado por la redacción a partir de las fuentes citadas.'} No constituye asesoramiento.</p>
  </section>`;
}
function renderArticle(it){
  const used = new Set(), gl = txt => it.label === 'Automática' ? esc(txt) : gloss(esc(txt), used);
  const dls = deadlineList([it]);
  const words = (it.title + ' ' + it.summary + ' ' + it.body.join(' ')).split(/\s+/).length;
  const mins = Math.max(1, Math.round(words / 200));
  const saved = store.get('comex.saved', []).includes(it.id);
  const related = state.items.filter(o => o.id !== it.id)
    .map(o => ({ o, s: o.topics.filter(t => it.topics.includes(t)).length * 2 + o.countries.filter(c => it.countries.includes(c) && c !== 'Global').length + o.tags.filter(t => it.tags.includes(t)).length * 3 + (Math.abs(dayDiff(o) - dayDiff(it)) <= 7 ? 1 : 0) }))
    .filter(x => x.s > 1).sort((a,b) => b.s - a.s || itemDate(b.o) - itemDate(a.o)).slice(0,4).map(x => x.o);
  const url = shareUrl(it), t = encodeURIComponent(it.title), u = encodeURIComponent(url);
  const sec = sectionOf(it);
  $('#main').innerHTML = `<article class="article" id="art" itemscope itemtype="https://schema.org/NewsArticle">
    <div class="article-top"><a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>${eyebrow(it)}${kindBadge(it, true)}${newBadge(it)}${argFlag(it)}
      <div class="textsize" role="group" aria-label="Tamaño del texto">${[['1','A','Texto normal'],['1.12','A','Texto grande'],['1.25','A','Texto muy grande']].map(([v,l,a]) => `<button type="button" data-size="${v}" aria-label="${a}" aria-pressed="${prefs.size===v}">${l}</button>`).join('')}</div></div>
    <h1 itemprop="headline">${esc(it.title)}</h1>
    <p class="lede" itemprop="description">${esc(it.summary)}</p>
    <div class="srcbar">
      <a class="src-main" href="${esc(it.primary.url)}" target="_blank" rel="noopener noreferrer"><span class="k">Fuente</span><b>${esc(it.primary.name)} ${I.ext}</b><span class="note">${esc(it.primary.type || '')}</span></a>
      ${it.primary.author ? `<div><dt>Autor</dt><dd>${esc(it.primary.author)}</dd></div>` : ''}
      <div><dt>Fecha</dt><dd><time itemprop="datePublished" datetime="${esc(it.datetime || it.date)}">${esc(cap(fmtDay.format(itemDate(it))))}</time></dd></div>
      <div><dt>Hora</dt><dd>${esc(timeLabel(it))}</dd></div>
      ${it.updated ? `<div><dt>Actualizada</dt><dd><time itemprop="dateModified" datetime="${esc(it.updated)}">${esc(shortDate(new Date(it.updated)))} ${esc(fmtTime.format(new Date(it.updated)))} h</time></dd></div>` : ''}
      <div><dt>Países</dt><dd>${esc(it.countries.join(', '))}</dd></div>
      <div><dt>Impacto</dt><dd>${impactMeter(it)}</dd></div>
      <div><dt>Lectura</dt><dd>${mins} min</dd></div>
    </div>
    <div class="art article-media">${media(it, 1200, { eager:true })}</div>
    <p class="credit" id="photoCredit">${photoCredit(photoFor(it))}</p>
    ${impactBlock(it)}
    <div class="prose" itemprop="articleBody">${it.body.length ? it.body.map(p => `<p>${gl(p)}</p>`).join('') : `<p>${gl(it.summary)}</p>`}</div>
    ${it.keyData.length ? `<section class="keydata" aria-labelledby="h-key"><h2 class="panel-h" id="h-key">Datos clave</h2><table>${it.keyData.map(([k,v]) => `<tr><td>${gl(k)}</td><td>${gl(v)}</td></tr>`).join('')}</table></section>` : ''}
    ${dls.length ? `<section class="keydata dl-box" aria-labelledby="h-dl"><h2 class="panel-h" id="h-dl">Fechas clave</h2>${deadlineListHtml(dls, { link:false })}<a class="foot-link" href="#agenda">Ver la agenda completa →</a></section>` : ''}
    ${storyBox(it)}
    ${used.size ? `<p class="note gl-note">Las palabras subrayadas con puntos tienen una explicación: pasá el mouse o tocalas. <a href="#glosario">Ver el glosario</a>.</p>` : ''}
    <div class="actions">
      <a class="btn primary" href="${esc(it.primary.url)}" target="_blank" rel="noopener noreferrer">${I.ext}Leer el original en ${esc(it.primary.name)}</a>
      <button class="btn${saved?' saved':''}" type="button" id="saveBtn" aria-pressed="${saved}">${I.save}<span>${saved ? 'Guardada' : 'Guardar noticia'}</span></button>
    </div>
    <div class="share" aria-label="Compartir">
      <span class="k">Compartir</span>
      <button type="button" id="copyBtn">${I.link}Copiar enlace</button>
      ${navigator.share ? `<button type="button" id="nativeShare">${I.share}Compartir…</button>` : ''}
      <a href="https://wa.me/?text=${t}%20${u}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" target="_blank" rel="noopener noreferrer">LinkedIn</a>
      <a href="https://twitter.com/intent/tweet?text=${t}&url=${u}" target="_blank" rel="noopener noreferrer">X</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener noreferrer">Facebook</a>
    </div>
    <section class="srcs" aria-labelledby="h-srcs"><h2 class="panel-h" id="h-srcs">Fuentes consultadas</h2><ol>${it.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>${s.author ? `, ${esc(s.author)}` : ''} <span class="t">· ${esc(s.type || 'Fuente')}${s.primary ? ' · fuente principal' : ''}</span></li>`).join('')}</ol></section>
    <div class="tags-block"><span class="note">Etiquetas</span><div class="tagrow" style="margin-top:6px">${[...it.tags.map(x => `<button type="button" data-tag="${esc(x)}">#${esc(x)}</button>`), ...it.topics.map(x => `<button type="button" data-topic="${esc(x)}">${esc(x)}</button>`), ...it.countries.filter(c=>c!=='Global').map(c => `<button type="button" data-country="${esc(c)}">${esc(c)}</button>`)].join('')}</div></div>
    <p class="disclaimer">${it.kind === 'analisis' ? 'Este contenido resume un <b>análisis de terceros</b>: las interpretaciones pertenecen a la fuente citada, no a la redacción. ' : ''}Resumen elaborado por Pulso Comex o, cuando se indique, información normalizada desde un feed público. Para el texto completo y oficial, consultá el artículo original. Cuando la imagen proviene de la fuente se indica su origen; las fotos de archivo son ilustrativas y no corresponden al hecho.</p>
    ${newsletterBox('band')}
    ${related.length ? `<section class="related" aria-labelledby="h-rel"><h2 id="h-rel">También puede interesarte</h2><div class="cards ${related.length === 4 ? 'two' : ''}">${related.map(card).join('')}</div></section>` : ''}
  </article>`;
  $('#saveBtn').onclick = () => toggleSave(it.id);
  $('#copyBtn').onclick = () => copy(url, 'Enlace copiado');
  $('#nativeShare') && ($('#nativeShare').onclick = () => navigator.share({ title: it.title, text: it.summary, url }).catch(() => {}));
  const img = new URL(photoUrl(photoFor(it), 1200), CONFIG.canonicalBase || location.origin).href;
  setSEO({ title:`${it.title} · ${CONFIG.siteName}`, desc: it.summary, image: img, url, type:'article', noindex: it.label === 'Automática' && !CONFIG.indexAutomatic,
    crumbs: [['Noticias','#inicio'], sec ? [sec.label, '#tema-' + sec.slug] : [category(it)], [it.title]],
    ld: { '@type':'NewsArticle', headline: it.title, description: it.summary, image:[img], datePublished: it.datetime || it.date,
      dateModified: it.updated || state.updatedAt || it.date, inLanguage:'es-AR', mainEntityOfPage: url, articleSection: category(it),
      keywords: [...it.tags, ...it.topics].join(', '), author: { '@type':'Organization', name: CONFIG.siteName + ' · Redacción' }, publisher: { '@id':'#org' },
      isBasedOn: it.sources.map(s => ({ '@type':'CreativeWork', url: s.url, publisher: { '@type':'Organization', name: s.name }, ...(s.author ? { author: { '@type':'Person', name: s.author } } : {}) })),
      contentLocation: it.countries.map(c => ({ '@type':'Place', name:c })) } });
}

function renderAgenda(){
  const all = deadlineList(), today = ymdToUTC(todayYMD());
  const up = all.filter(d => !d.past);
  const recent = all.filter(d => d.past && today - d.end <= 45 * DAY_MS).reverse();
  const months = new Map();
  up.forEach(d => { const k = d.date.slice(0, 7); months.has(k) || months.set(k, []); months.get(k).push(d); });
  $('#main').innerHTML = `<article class="article doc">
    <a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>
    <h1>Agenda de comercio exterior</h1>
    <p class="lede">Vencimientos, entradas en vigor y publicaciones de datos que surgen de las noticias del sitio. Cada fecha enlaza a la nota donde se explica y a su fuente.</p>
    ${up.length ? [...months].map(([k, list]) => `<h2>${esc(cap(fmtMonthYear.format(new Date(list[0].start))))}</h2>${deadlineListHtml(list)}`).join('')
      : emptyState('No hay fechas próximas cargadas', 'Cuando una nota anuncie un vencimiento o una entrada en vigor, va a aparecer acá.')}
    ${recent.length ? `<h2>Fechas recientes</h2>${deadlineListHtml(recent)}` : ''}
    <p class="note" style="margin-top:20px">Las fechas provienen de las fuentes citadas en cada nota. Cuando la fuente informa solo el mes, se indica «día a confirmar». Si una fecha cambia, se corrige en la nota correspondiente.</p>
  </article>`;
  setSEO({ title:`Agenda de comercio exterior · ${CONFIG.siteName}`, desc:'Próximos vencimientos, entradas en vigor de normas y publicaciones de datos de comercio exterior, con su fuente.', crumbs:[['Noticias','#inicio'],['Agenda']] });
}
function renderStory(s){
  const list = storyItems(s.id);
  if (!list.length){ renderNotFound(); return; }
  const more = storyCoverage(s, list).slice(0, 10);
  const dls = deadlineList(list).filter(d => !d.past);
  $('#main').innerHTML = `<div class="sec-intro"><div style="min-width:0"><span class="eyebrow">Tema en desarrollo</span><h2>${esc(s.title)}</h2><p>${esc(s.desc)}</p></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="rcount"><b>${list.length}</b> ${list.length === 1 ? 'nota' : 'notas'}</span><span class="note">Última nota ${esc(agoText(itemDate(list[0])))}</span></div></div>
    ${dls.length ? `<section class="sec" aria-labelledby="h-sdl"><div class="sec-h"><h2 id="h-sdl">Próximas fechas del tema</h2></div>${deadlineListHtml(dls)}</section>` : ''}
    <section class="sec" aria-labelledby="h-snotes"><div class="sec-h"><h2 id="h-snotes">Cronología</h2><p>De la más reciente a la más antigua</p></div>${chronoList(list)}</section>
    ${more.length ? `<section class="sec" aria-labelledby="h-smore"><div class="sec-h"><h2 id="h-smore">Más cobertura del tema</h2><p>Notas automáticas de las fuentes, sin revisión editorial</p></div>${chronoList(more)}</section>` : ''}`;
  setSEO({ title:`${s.title} · ${CONFIG.siteName}`, desc: s.desc, crumbs:[['Noticias','#inicio'],[s.title]] });
}
function renderGlosario(){
  const list = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, 'es', { sensitivity:'base' }));
  $('#main').innerHTML = `<article class="article doc">
    <a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>
    <h1>Glosario de comercio exterior</h1>
    <p class="lede">Siglas y términos técnicos que aparecen en las noticias. Dentro de cada nota, la primera vez que aparecen se marcan con un subrayado de puntos: pasá el mouse o tocalos para ver la explicación.</p>
    <dl class="gloss-list">${list.map(g => `<div id="gl-${esc(slug(g.term))}"><dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd></div>`).join('')}</dl>
  </article>`;
  setSEO({ title:`Glosario de comercio exterior · ${CONFIG.siteName}`, desc:'Qué significan FOB, TEU, OEA, salvaguardia, Sección 301 y otras siglas y términos del comercio exterior.', crumbs:[['Noticias','#inicio'],['Glosario']] });
}
/* =====================================================================
   PANEL ARGENTINA: intercambio comercial del INDEC (data/trade.json, scripts/update_trade.py)
   ===================================================================== */
const nfM = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtM = n => `USD ${nfM.format(n)} M`;
const fmtChg = n => n == null ? '' : `${n > 0 ? '+' : ''}${nf1.format(n)} %`;
const chgCls = n => n == null ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
const MES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const monthShort = m => `${MES_CORTO[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
const monthLong = m => `${['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][+m.slice(5) - 1]} de ${m.slice(0, 4)}`;

function tradeTiles(t){
  const s = t.summary || {};
  const tile = (label, v, chg, note) => `<div class="tr-tile"><span class="l">${label}</span><b>${fmtM(v)}</b>${chg != null ? `<span class="c ${chgCls(chg)}">${fmtChg(chg)} <span class="note">interanual</span></span>` : `<span class="c flat">${note || ''}</span>`}</div>`;
  return `<div class="tr-tiles">
    ${tile(`Exportaciones · ${esc(monthLong(t.lastMonth))}`, s.expo, s.expoChange)}
    ${tile(`Importaciones · ${esc(monthLong(t.lastMonth))}`, s.impo, s.impoChange)}
    ${tile('Saldo comercial del mes', s.saldo, null, s.saldo >= 0 ? 'Superávit' : 'Déficit')}
  </div>
  <div class="tr-tiles ytd">
    ${tile(`Exportaciones ${esc(s.ytdLabel || '')}`, s.expoYtd, s.expoYtdChange)}
    ${tile(`Importaciones ${esc(s.ytdLabel || '')}`, s.impoYtd, s.impoYtdChange)}
    ${tile(`Saldo ${esc(s.ytdLabel || '')}`, s.saldoYtd, null, s.saldoYtd >= 0 ? 'Superávit acumulado' : 'Déficit acumulado')}
  </div>`;
}
function tradeChartBlock(t){
  return `<figure class="tr-fig">
    <figcaption><b>Exportaciones e importaciones por mes</b><span>En millones de dólares · últimos ${t.monthly.length} meses</span></figcaption>
    <div class="tr-legend" aria-hidden="true"><span><i class="sw expo"></i>Exportaciones</span><span><i class="sw impo"></i>Importaciones</span></div>
    <div class="tr-chart" data-trade-chart role="img" aria-label="Exportaciones e importaciones mensuales de la Argentina, de ${esc(monthLong(t.monthly[0].m))} a ${esc(monthLong(t.lastMonth))}"></div>
    <details class="tr-table"><summary>Ver los datos en tabla</summary>
      <div class="tr-scroll"><table><tr><th>Mes</th><th>Exportaciones</th><th>Importaciones</th><th>Saldo</th></tr>
      ${[...t.monthly].reverse().map(r => `<tr><td>${esc(monthShort(r.m))}</td><td>${nfM.format(r.expo)}</td><td>${nfM.format(r.impo)}</td><td>${nfM.format(r.expo - r.impo)}</td></tr>`).join('')}</table></div>
    </details>
  </figure>`;
}
function drawTradeCharts(){
  const t = state.trade; if (!t) return;
  $$('[data-trade-chart]').forEach(el => {
    const W = Math.max(280, el.clientWidth), H = W < 500 ? 220 : 260, padL = 46, padR = W < 500 ? 12 : 116, padT = 12, padB = 26;
    const rows = t.monthly, n = rows.length;
    const max = Math.max(...rows.flatMap(r => [r.expo, r.impo])) * 1.08;
    const step = max > 8000 ? 2000 : max > 4000 ? 1000 : 500;
    const x = i => padL + (W - padL - padR) * i / (n - 1), y = v => padT + (H - padT - padB) * (1 - v / max);
    const path = k => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join('');
    const grid = []; for (let v = 0; v <= max; v += step) grid.push(v);
    const ticks = rows.map((r, i) => [r, i]).filter(([r]) => r.m.endsWith('-01') || (W >= 500 && r.m.endsWith('-07')));
    const L = rows[n - 1];
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      ${grid.map(v => `<line class="g" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${nfM.format(v)}</text>`).join('')}
      ${ticks.map(([r, i]) => `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(monthShort(r.m))}</text>`).join('')}
      <path class="ln impo" d="${path('impo')}"/><path class="ln expo" d="${path('expo')}"/>
      <circle class="dot expo" cx="${x(n - 1)}" cy="${y(L.expo)}" r="4"/><circle class="dot impo" cx="${x(n - 1)}" cy="${y(L.impo)}" r="4"/>
      ${W >= 500 ? (() => { let ye = y(L.expo), yi = y(L.impo); if (Math.abs(ye - yi) < 30){ const mid = (ye + yi) / 2; if (ye < yi){ ye = mid - 15; yi = mid + 15; } else { ye = mid + 15; yi = mid - 15; } }
        return `<text class="dl" x="${x(n - 1) + 10}" y="${ye - 2}">Exportaciones</text><text class="dl v" x="${x(n - 1) + 10}" y="${ye + 12}">${nfM.format(L.expo)}</text>
          <text class="dl" x="${x(n - 1) + 10}" y="${yi - 2}">Importaciones</text><text class="dl v" x="${x(n - 1) + 10}" y="${yi + 12}">${nfM.format(L.impo)}</text>`; })() : ''}
      <g class="xh" hidden><line class="xl" y1="${padT}" y2="${H - padB}"/><circle class="dot expo" r="5"/><circle class="dot impo" r="5"/></g>
      <rect class="hit" x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent"/>
    </svg><div class="tr-tip" hidden></div>`;
    const svg = el.querySelector('svg'), xh = el.querySelector('.xh'), tip = el.querySelector('.tr-tip');
    const show = ev => {
      const r = svg.getBoundingClientRect(), px = ev.clientX - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round((px - padL) / (W - padL - padR) * (n - 1)))), d = rows[i];
      xh.hidden = false; tip.hidden = false;
      xh.querySelector('.xl').setAttribute('x1', x(i)); xh.querySelector('.xl').setAttribute('x2', x(i));
      const [ce, ci] = xh.querySelectorAll('circle'); ce.setAttribute('cx', x(i)); ce.setAttribute('cy', y(d.expo)); ci.setAttribute('cx', x(i)); ci.setAttribute('cy', y(d.impo));
      tip.innerHTML = `<b>${esc(monthLong(d.m))}</b><span><i class="sw expo"></i>Exportaciones <em>${fmtM(d.expo)}</em></span><span><i class="sw impo"></i>Importaciones <em>${fmtM(d.impo)}</em></span><span>Saldo <em>${fmtM(d.expo - d.impo)}</em></span>`;
      const tw = tip.offsetWidth; tip.style.left = Math.min(Math.max(0, x(i) + 12 + tw > W ? x(i) - tw - 12 : x(i) + 12), W - tw) + 'px';
    };
    const hide = () => { xh.hidden = true; tip.hidden = true; };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
  });
}
let tradeResizeT; addEventListener('resize', () => { clearTimeout(tradeResizeT); tradeResizeT = setTimeout(drawTradeCharts, 150); });

function tradeBars(title, sub, list, cls, { shareOf = 'ytd' } = {}){
  if (!list || !list.length) return '';
  const max = Math.max(...list.map(e => e[shareOf]));
  return `<section class="tr-bars ${cls}"><h3>${esc(title)}</h3><p class="note">${esc(sub)}</p>
    <ol>${list.map(e => `<li title="${esc(e.name)}: ${fmtM(e[shareOf])}${e.share != null ? ` · ${nf1.format(e.share)} % del total` : ''}${e.change ?? e.ytdChange ? ` · ${fmtChg(e.change ?? e.ytdChange)} interanual` : ''}">
      <span class="n">${esc(e.name)}</span>
      <span class="bar"><i style="width:${(e[shareOf] / max * 100).toFixed(1)}%"></i></span>
      <span class="v">${nfM.format(e[shareOf])}${e.share != null ? ` <small>${nf1.format(e.share)} %</small>` : ''}</span>
      <span class="c ${chgCls(e.change ?? e.ytdChange)}">${fmtChg(e.change ?? e.ytdChange)}</span></li>`).join('')}</ol></section>`;
}
function tradePanel({ full = true } = {}){
  const t = state.trade;
  if (!t || !t.summary) return '';
  const ytd = t.summary.ytdLabel || '';
  return `<section class="trade" aria-labelledby="h-trade">
    <div class="sec-h"><h2 id="h-trade">Comercio exterior argentino en datos</h2>${full ? '' : `<a class="more-link" href="#datos">Panel completo →</a>`}</div>
    <p class="note">Último dato: ${esc(monthLong(t.lastMonth))}. Fuente: <a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener noreferrer">INDEC</a>. Exportaciones FOB e importaciones CIF, en millones de dólares. Variaciones contra el mismo período del año anterior.</p>
    ${tradeTiles(t)}
    ${tradeChartBlock(t)}
    ${full ? `<div class="tr-grid">
      ${tradeBars('Exportaciones por rubro', `Acumulado ${ytd}`, t.rubros, 'expo')}
      ${tradeBars('Importaciones por uso económico', `Acumulado ${ytd}`, t.usos, 'impo')}
      ${tradeBars('Principales destinos', `Exportaciones acumuladas ${ytd}`, (t.destinos || []).slice(0, 10), 'expo')}
      ${tradeBars('Principales orígenes', `Importaciones acumuladas ${ytd}`, (t.origenes || []).slice(0, 10), 'impo')}
    </div>
    ${(t.destinosBloques || []).length ? `<div class="tr-grid">${tradeBars('Exportaciones por bloque', `Acumulado ${ytd}`, t.destinosBloques, 'expo')}${tradeBars('Importaciones por bloque', `Acumulado ${ytd}`, t.origenesBloques, 'impo')}</div>` : ''}` : ''}
  </section>`;
}

function renderDatos(){
  const groups = {}; state.indicators.forEach(d => (groups[d.group] ||= []).push(d));
  $('#main').innerHTML = `<article class="article doc">
    <a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>
    <h1>Datos e indicadores de comercio exterior</h1>
    <p class="lede">El intercambio comercial argentino, el tipo de cambio, los granos, el petróleo y los fletes, con el último dato de cada fuente oficial. Se actualizan solos varias veces por día.</p>
    ${tradePanel()}
    <h2 class="ind-head">Indicadores de mercado</h2>
    ${Object.entries(groups).map(([g, list]) => `<h2 class="ind-group-h">${esc(g)}</h2><div class="ind-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${list.map(d => indicatorCard(d)).join('')}</div>`).join('') || emptyState('Sin indicadores', 'El feed no trae indicadores en este momento.')}
    <h2>Cómo se actualizan</h2>
    <div class="prose"><p>Un proceso automático consulta las fuentes oficiales cinco veces por día: el INDEC (intercambio comercial, a través de las series de tiempo de datos.gob.ar), el Banco Central (tipo de cambio mayorista), la Bolsa de Comercio de Rosario (precios pizarra) y la EIA (petróleo Brent). Si una fuente no responde, se mantiene el último dato publicado con su fecha. Ningún valor se estima ni se completa a mano.</p></div>
  </article>`;
  setSEO({ title:`Datos de comercio exterior argentino: exportaciones, importaciones e indicadores · ${CONFIG.siteName}`, desc:'Exportaciones, importaciones y saldo comercial de la Argentina por mes, rubro, uso económico, destino y origen (INDEC), con tipo de cambio, granos, petróleo y fletes.', crumbs:[['Datos']] });
}
function renderFuentes(){
  const used = {}; state.items.forEach(i => i.sources.forEach(s => { (used[s.name] ||= { n:0, type:s.type }).n++; }));
  const usedList = Object.entries(used).sort((a,b) => b[1].n - a[1].n || a[0].localeCompare(b[0], 'es'));
  $('#main').innerHTML = `<article class="article doc">
    <a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>
    <h1>Fuentes</h1>
    <p class="lede">Pulso Comex prioriza organismos oficiales, aduanas, organizaciones internacionales y medios especializados. Toda nota enlaza a su fuente original.</p>
    <h2>Fuentes citadas en el archivo</h2>
    <ul class="srcdir" style="grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));display:grid">${usedList.map(([n, o]) => `<li><button class="btn sm" type="button" data-source="${esc(n)}" style="width:100%;justify-content:space-between;white-space:normal;text-align:left;gap:10px;min-width:0"><span style="min-width:0;overflow-wrap:anywhere">${esc(n)}</span><span class="mono">${o.n}</span></button><span>${esc(o.type || '')}</span></li>`).join('')}</ul>
    <h2>Directorio de fuentes de referencia</h2>
    <div class="src-groups">${SOURCE_DIRECTORY.map(g => `<section class="src-group"><h2>${esc(g.group)}</h2><ul class="srcdir">${g.items.map(([n,u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('')}</ul></section>`).join('')}</div>
    <p class="note" style="margin-top:16px">El directorio enlaza a los sitios institucionales. Una fuente figura en una nota solo cuando la información proviene efectivamente de ella.</p>
  </article>`;
  setSEO({ title:`Fuentes · ${CONFIG.siteName}`, desc:'Fuentes oficiales, organismos internacionales y medios especializados que usa Pulso Comex.', crumbs:[['Noticias','#inicio'],['Fuentes']] });
}
function renderGuardadas(){
  const saved = store.get('comex.saved', []).map(id => state.items.find(i => i.id === id)).filter(Boolean);
  $('#main').innerHTML = `<section>
    <div class="rhead"><div><h2>Noticias guardadas</h2><p class="rcount"><b>${saved.length}</b> en este navegador</p></div></div>
    ${saved.length ? `<ul class="list">${saved.map(listItem).join('')}</ul>` : emptyState('Todavía no guardaste noticias', 'Usá «Guardar noticia» dentro de cada nota para leerla más tarde. Se guardan solo en este navegador.')}
  </section>`;
  setSEO({ title:`Guardadas · ${CONFIG.siteName}`, desc:'Noticias guardadas para leer más tarde.', crumbs:[['Noticias','#inicio'],['Guardadas']], noindex:true });
}
const PAGES = {
  privacidad: ['Política de privacidad', `<p>Esta sección no utiliza cuentas de usuario ni recopila datos personales. Las noticias guardadas, las preferencias y el contador de lecturas se almacenan solo en tu navegador y podés borrarlos limpiando los datos del sitio.</p><p>Al seguir un enlace a una fuente externa, rige la política de privacidad de ese sitio.</p>`],
  terminos: ['Términos y condiciones', `<p>El contenido es informativo y no constituye asesoramiento legal, aduanero, tributario ni financiero. Antes de operar, verificá la normativa vigente en la fuente oficial.</p><p>Los resúmenes son redacción propia de Pulso Comex. Los datos, cifras y declaraciones pertenecen a las fuentes citadas, que se enlazan en cada nota. Las imágenes son las publicadas por la fuente junto a la nota original, con crédito y enlace, o fotos de archivo de uso libre de Unsplash, con crédito a su autor.</p>`],
  acerca: ['Sobre Pulso Comex', `<p>Pulso Comex es un portal de noticias, datos y análisis sobre comercio exterior, pensado para importadores, exportadores, despachantes de aduana, operadores logísticos y portuarios, estudiantes y docentes.</p>
    <h2>Criterios editoriales</h2><ul><li>Cada nota se verifica contra su fuente original y la enlaza.</li><li>Los resúmenes son redacción propia; las cifras y declaraciones pertenecen a las fuentes.</li><li>Se distingue entre <b>noticias</b>, <b>análisis de terceros</b>, <b>datos</b> y <b>opinión</b>.</li><li>El bloque «Impacto en Argentina» solo aparece cuando la información disponible lo sustenta.</li><li>No se publican noticias sin título, fecha y fuente con enlace.</li></ul>
    <h2>Cómo se actualiza</h2><p>La página lee un feed normalizado que puede alimentarse con APIs, RSS, una base de datos o webhooks, y lo vuelve a consultar cada ${CONFIG.refreshMinutes} minutos sin recargar. Un proceso automático consulta las fuentes varias veces por día; el encabezado muestra la hora de la última actualización. Las notas marcadas como «Automática» provienen directamente del feed de la fuente y no tienen revisión editorial.</p>`]
};
/* =====================================================================
   PÁGINAS EDITABLES DESDE site.json (contacto, quiénes somos, privacidad)
   ===================================================================== */
const mail = SITECFG.contactEmail || '';
const resp = SITECFG.responsable || {};
const nl = SITECFG.newsletter || {};
const hasNewsletter = !!(nl.formAction || nl.url);
const mailLink = mail ? `<a href="mailto:${esc(mail)}">${esc(mail)}</a>` : '';

PAGES.acerca = ['Quiénes somos', `
  <p>Pulso Comex es un portal de noticias, datos y herramientas sobre comercio exterior, con foco en Argentina y Latinoamérica. Está pensado para importadores, exportadores, despachantes de aduana, operadores logísticos, estudiantes y docentes que necesitan seguir, en un solo lugar, lo que pasa con aranceles, aduanas, acuerdos comerciales y logística.</p>
  ${resp.nombre ? `<h2>Quién está detrás</h2>
    <div class="person"><p><b>${esc(resp.nombre)}</b>${resp.rol ? ` · ${esc(resp.rol)}` : ''}</p>
    ${resp.descripcion ? `<p>${esc(resp.descripcion)}</p>` : ''}
    ${resp.linkedin ? `<p><a href="${esc(resp.linkedin)}" target="_blank" rel="noopener noreferrer">Perfil de LinkedIn</a></p>` : ''}</div>` : ''}
  <h2>Qué vas a encontrar</h2>
  <ul>
    <li><b>Noticias al día</b> de organismos oficiales y medios especializados, actualizadas varias veces por día, siempre con la fuente y el enlace al original.</li>
    <li><b>Herramientas</b> como la <a href="#calculadora">calculadora de costo de importación</a>.</li>
    <li><b>Indicadores</b> de fletes, carga aérea y balanza comercial con su fuente.</li>
  </ul>
  <h2>Criterios editoriales</h2>
  <ul>
    <li>Toda nota identifica su fuente y enlaza al artículo original. No se publican noticias sin título, fecha y fuente.</li>
    <li>Las notas marcadas como «Automática» provienen directamente del feed de la fuente y no tienen revisión editorial; los títulos se respetan tal como los publica cada medio.</li>
    <li>Se distingue entre noticias, análisis de terceros, datos y opinión.</li>
    <li>El contenido es informativo y no reemplaza el asesoramiento de un despachante de aduana o un profesional.</li>
  </ul>
  <h2>Contacto</h2>
  <p>${mail ? `Para sugerencias, correcciones o propuestas comerciales escribinos a ${mailLink}.` : 'Muy pronto vas a encontrar acá un correo de contacto.'}</p>`];

PAGES.contacto = ['Contacto', `
  ${mail ? `<p>Escribinos a <b>${mailLink}</b> <button class="btn sm" type="button" data-copy="${esc(mail)}">Copiar correo</button></p>
    <p>Respondemos consultas sobre:</p>
    <ul><li>Correcciones o aclaraciones sobre una nota (indicá el enlace).</li><li>Sugerencias de fuentes o temas.</li><li>Publicidad, patrocinios y propuestas comerciales.</li></ul>
    <p class="note">Pulso Comex no brinda asesoramiento aduanero ni tributario personalizado. Para operar, consultá con un despachante de aduana matriculado.</p>`
    : '<p>Muy pronto vas a encontrar acá un correo de contacto.</p>'}
  ${SITECFG.redes?.length ? `<h2>Redes</h2><p style="display:flex;gap:14px;flex-wrap:wrap">${SITECFG.redes.map(r => `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.nombre)}</a>`).join('')}</p>` : ''}`];

PAGES.privacidad = ['Política de privacidad', `
  <p>Pulso Comex no requiere registrarse ni crear una cuenta para leer el sitio.</p>
  <h2>Datos que se guardan en tu navegador</h2>
  <p>Las noticias guardadas, tus preferencias (tema, tamaño de texto, temas favoritos) y el contador de lecturas se guardan solo en tu navegador. No se envían a ningún servidor y podés borrarlos limpiando los datos del sitio.</p>
  ${SITECFG.googleAnalyticsId ? `<h2>Estadísticas de visitas</h2><p>Usamos Google Analytics para saber cuántas personas visitan el sitio y qué secciones leen. Google recibe datos técnicos de la visita (páginas vistas, tipo de dispositivo, ubicación aproximada) y usa cookies para eso. No usamos esa información para identificarte personalmente. Podés bloquearla con la configuración de tu navegador o con el <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">complemento de inhabilitación de Google Analytics</a>.</p>` : ''}
  ${hasNewsletter ? `<h2>Newsletter</h2><p>Si te suscribís, tu correo se guarda en MailerLite, el servicio que usamos para enviar el newsletter. Solo lo usamos para mandarte el boletín y podés darte de baja en cualquier momento con el enlace que aparece en cada envío.</p>` : ''}
  <h2>Enlaces externos</h2>
  <p>Al seguir un enlace a una fuente externa, rige la política de privacidad de ese sitio.</p>
  ${mail ? `<h2>Consultas</h2><p>Por cualquier consulta sobre tus datos escribinos a ${mailLink}.</p>` : ''}`];

/* =====================================================================
   NEWSLETTER (MailerLite u otro servicio, configurado en site.json)
   ===================================================================== */
function newsletterBox(where = 'aside'){
  if (!hasNewsletter) return '';
  const title = 'Newsletter de Pulso Comex';
  const txt = 'Lo más importante del comercio exterior, en tu correo. Gratis, y te das de baja cuando quieras.';
  const body = nl.formAction
    ? `<form class="nl-form" novalidate><label class="sr" for="nl-${where}">Tu correo</label>
        <input id="nl-${where}" type="email" name="email" placeholder="tu@correo.com" autocomplete="email" required>
        <button class="btn primary" type="submit">Suscribirme</button></form><p class="nl-msg" role="status"></p>`
    : `<a class="btn primary" href="${esc(nl.url)}" target="_blank" rel="noopener noreferrer">Suscribirme</a>`;
  return where === 'aside'
    ? `<section class="box nl-box"><h2>${title}</h2><p class="note">${txt}</p>${body}</section>`
    : `<section class="nl-band"><h2>${title}</h2><p>${txt}</p>${body}</section>`;
}
document.addEventListener('submit', async e => {
  const form = e.target.closest('.nl-form'); if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input[type=email]'), msg = form.parentElement.querySelector('.nl-msg');
  const email = input.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ msg.textContent = 'Revisá el correo: parece incompleto.'; input.focus(); return; }
  const btn = form.querySelector('button'); btn.disabled = true; msg.textContent = 'Enviando…';
  try {
    const fd = new FormData(); fd.append('fields[email]', email); fd.append('ml-submit', '1'); fd.append('anticsrf', 'true');
    await fetch(nl.formAction, { method: 'POST', body: fd, mode: 'no-cors' });
    form.reset(); msg.textContent = '¡Listo! Revisá tu correo para confirmar la suscripción.';
    window.gtag?.('event', 'sign_up', { method: 'newsletter' });
  } catch (err) {
    msg.textContent = 'No se pudo enviar. Probá de nuevo en unos minutos.';
  } finally { btn.disabled = false; }
});

/* =====================================================================
   CALCULADORAS DE IMPORTACIÓN Y EXPORTACIÓN
   ===================================================================== */
const CALC_DEFAULTS = { inco: 'FOB', precio: 10000, origen: 0, flete: 1200, seguro: 60, tc: '', di: 0, mercosur: false, te: 3, iva: 21, piva: 20, pgan: 6, piibb: 2.5,
  despachante: 0, terminal: 0, fleteint: 0, otros: 0 };
const calc = (() => {
  const saved = store.get('comex.calc', {});
  if (saved.fob != null && saved.precio == null) saved.precio = saved.fob;      // versión anterior de la calculadora
  if (saved.gastos != null && saved.otros == null) saved.otros = saved.gastos;
  delete saved.fob; delete saved.gastos;
  return Object.assign({}, CALC_DEFAULTS, saved);
})();
const EXP_DEFAULTS = { fob: 20000, dex: 0, reint: 0, insumos: 0, tc: '', despachante: 0, terminal: 0, fleteint: 0, otros: 0 };
const expo = Object.assign({}, EXP_DEFAULTS, store.get('comex.expo', {}));
// Acepta "10000", "10.000", "10.000,50", "2,5" y "2.5".
const num = v => {
  let t = String(v ?? '').trim().replace(/\s|USD|\$|%/gi, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t); return isFinite(n) ? n : 0;
};
const fmtUSD = n => 'USD ' + new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtARS = n => '$ ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n);
const fmtPct = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n) + ' %';

// Incoterms: qué incluye el precio de compra y qué hay que sumarle para llegar al valor CIF (base de los tributos de importación).
const INCOTERMS = {
  EXW: { label: 'EXW · en fábrica', hint: 'El precio no incluye llevar la mercadería al puerto ni cargarla: sumá esos gastos en origen, el flete y el seguro.', origen: true, flete: true, seguro: true },
  FCA: { label: 'FCA · franco transportista', hint: 'El vendedor entrega la mercadería despachada de exportación al transportista que elegiste. Sumá el flete y el seguro.', flete: true, seguro: true },
  FOB: { label: 'FOB · franco a bordo', hint: 'El precio incluye la mercadería cargada en el buque en el puerto de origen. Sumá el flete y el seguro.', flete: true, seguro: true },
  CFR: { label: 'CFR · costo y flete', hint: 'El precio ya incluye el flete hasta el puerto de destino. Sumá solo el seguro.', seguro: true },
  CIF: { label: 'CIF · costo, seguro y flete', hint: 'El precio ya incluye el flete y el seguro hasta el puerto de destino: es directamente el valor CIF.' },
};
function calcResult(c){
  const inc = INCOTERMS[c.inco] || INCOTERMS.FOB;
  const precio = num(c.precio), origen = inc.origen ? num(c.origen) : 0, flete = inc.flete ? num(c.flete) : 0, seguro = inc.seguro ? num(c.seguro) : 0;
  const cif = precio + origen + flete + seguro;
  const fob = inc.flete ? precio + origen : null;
  const di = c.mercosur ? 0 : cif * num(c.di) / 100;
  const te = c.mercosur ? 0 : cif * num(c.te) / 100;
  const base = cif + di + te;
  const iva = base * num(c.iva) / 100, piva = base * num(c.piva) / 100, pgan = base * num(c.pgan) / 100, piibb = base * num(c.piibb) / 100;
  const tributos = di + te + iva + piva + pgan + piibb;
  const recuperables = iva + piva + pgan + piibb;
  const gastosList = [['Despachante de aduana', num(c.despachante)], ['Terminal, depósito y gastos portuarios', num(c.terminal)], ['Flete interno', num(c.fleteint)], ['Otros gastos', num(c.otros)]];
  const gastos = gastosList.reduce((s, [, v]) => s + v, 0);
  return { inc, precio, origen, flete, seguro, fob, cif, di, te, base, iva, piva, pgan, piibb, tributos, recuperables, gastos, gastosList,
    desembolso: cif + tributos + gastos, costoReal: cif + di + te + gastos, tc: num(c.tc) };
}
function expResult(c){
  const fob = num(c.fob), insumos = Math.min(num(c.insumos), fob), base = fob - insumos;
  const dex = base * num(c.dex) / 100, reint = base * num(c.reint) / 100;
  const gastosList = [['Despachante de aduana', num(c.despachante)], ['Terminal, depósito y gastos portuarios', num(c.terminal)], ['Flete interno hasta el puerto', num(c.fleteint)], ['Otros gastos', num(c.otros)]];
  const gastos = gastosList.reduce((s, [, v]) => s + v, 0);
  return { fob, insumos, base, dex, reint, gastos, gastosList, neto: fob - dex - gastos + reint, tc: num(c.tc) };
}
const calcField = (obj, attr) => (id, label, hint, attrs = '') =>
  `<label for="${attr}-${id}">${label}<input id="${attr}-${id}" data-${attr}="${id}" inputmode="decimal" value="${esc(obj[id])}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>`;
const calcTabs = cur => `<nav class="calc-tabs" aria-label="Herramientas">${[['calculadora','Importación'],['exportacion','Exportación'],['guias','Guías para calcular']]
  .map(([h, l]) => `<a href="#${h}"${cur === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;

function renderCalculadora(){
  const f = calcField(calc, 'calc');
  const inc = INCOTERMS[calc.inco] || INCOTERMS.FOB;
  $('#main').innerHTML = `<article class="article doc calc">
    <a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>
    ${calcTabs('calculadora')}
    <h1>Calculadora de costo de importación</h1>
    <p class="lede">Estimá cuánto pagás en la Aduana argentina y cuál es el costo real de tu mercadería, desde el precio de compra en cualquier Incoterm hasta tu depósito. Todas las alícuotas se pueden modificar.</p>
    <form class="calc-form" onsubmit="return false">
      <h2>1. Precio y condición de compra (en USD)</h2>
      <div class="calc-grid">
        <label for="calc-inco">Incoterm<select id="calc-inco" data-calc="inco">${Object.entries(INCOTERMS).map(([k, v]) => `<option value="${k}"${calc.inco === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select><small>${esc(inc.hint)} <a href="#guia-incoterms">Qué es cada Incoterm</a></small></label>
        ${f('precio', `Precio de compra (${esc(calc.inco)})`, 'El valor de la factura comercial.')}
        ${inc.origen ? f('origen', 'Gastos en origen', 'Transporte hasta el puerto, carga y despacho de exportación en el país de origen.') : ''}
        ${inc.flete ? f('flete', 'Flete internacional', 'Hasta el puerto o aeropuerto de destino.') : ''}
        ${inc.seguro ? f('seguro', 'Seguro', 'Si no lo contratás, la Aduana puede presumir un valor.') : ''}
        ${f('tc', 'Tipo de cambio (opcional)', 'Pesos por dólar, para ver los montos en $.')}
      </div>
      <h2>2. Tributos</h2>
      <label class="calc-check"><input type="checkbox" data-calc="mercosur" ${calc.mercosur ? 'checked' : ''}> Origen Mercosur con certificado de origen (sin derecho de importación ni tasa de estadística)</label>
      <div class="calc-grid">
        ${f('di', 'Derecho de importación (%)', 'Depende de la posición arancelaria (NCM). Suele ir de 0 % a 35 %. <a href="#guia-posicion-arancelaria">Cómo encontrarlo</a>', calc.mercosur ? 'disabled' : '')}
        ${f('te', 'Tasa de estadística (%)', 'General: 3 % del valor CIF. Puede tener topes o exenciones según el caso.', calc.mercosur ? 'disabled' : '')}
        <label for="calc-iva">IVA<select id="calc-iva" data-calc="iva"><option value="21" ${num(calc.iva)===21?'selected':''}>21 % (general)</option><option value="10.5" ${num(calc.iva)===10.5?'selected':''}>10,5 % (bienes de capital y otros)</option></select><small>Según la mercadería.</small></label>
        ${f('piva', 'Percepción de IVA (%)', 'General 20 %; 10 % si el IVA es 10,5 %. A cuenta del IVA.')}
        <label for="calc-pgan">Percepción de Ganancias<select id="calc-pgan" data-calc="pgan"><option value="6" ${num(calc.pgan)===6?'selected':''}>6 % (inscripto en Ganancias)</option><option value="11" ${num(calc.pgan)===11?'selected':''}>11 % (no inscripto / bienes de uso propio)</option></select><small>Anticipo del impuesto.</small></label>
        ${f('piibb', 'Percepción de Ingresos Brutos (%)', 'Varía según la provincia y el régimen de cada empresa.')}
      </div>
      <h2>3. Gastos en Argentina (opcional, en USD)</h2>
      <div class="calc-grid">
        ${f('despachante', 'Despachante de aduana', 'Honorarios por el despacho.')}
        ${f('terminal', 'Terminal, depósito y puerto', 'Almacenaje, manipuleo, gastos de terminal y de la agencia marítima.')}
        ${f('fleteint', 'Flete interno', 'Del puerto o aeropuerto hasta tu depósito.')}
        ${f('otros', 'Otros gastos', 'Certificaciones, licencias, bancos u otros.')}
      </div>
      <p><button class="btn sm" type="button" data-calc-reset>Restablecer valores</button></p>
    </form>
    <section class="calc-out" aria-live="polite" id="calcOut"></section>
    <div class="callout"><p><b>Importante.</b> Es una estimación orientativa. No contempla regímenes especiales, valores criterio, derechos antidumping, licencias ni otras medidas que puedan aplicar a tu producto. Las alícuotas pueden cambiar: antes de operar, confirmalas con tu despachante de aduana o en la normativa vigente.</p></div>
    ${guideLinks(['costo-importacion', 'valor-cif', 'incoterms', 'posicion-arancelaria'])}
  </article>`;
  updateCalc();
  setSEO({ title:`Calculadora de costo de importación en Argentina · ${CONFIG.siteName}`, desc:'Calculá el valor CIF desde cualquier Incoterm, los derechos de importación, la tasa de estadística, el IVA, las percepciones y los gastos para importar en la Argentina.', crumbs:[['Herramientas'],['Calculadora de importación']] });
}
function updateCalc(){
  const out = $('#calcOut'); if (!out) return;
  const r = calcResult(calc);
  const ars = n => r.tc ? `<td class="ars">${fmtARS(n * r.tc)}</td>` : '';
  const row = (label, n, note = '', cls = '') => `<tr class="${cls}"><td>${label}${note ? `<small>${note}</small>` : ''}</td><td>${fmtUSD(n)}</td>${ars(n)}</tr>`;
  const head = `<tr><th>Concepto</th><th>USD</th>${r.tc ? '<th>Pesos</th>' : ''}</tr>`;
  out.innerHTML = `<h2>Resultado</h2>
    <div class="calc-sum">
      <div><span>Pagás en la Aduana</span><b>${fmtUSD(r.tributos)}</b>${r.tc ? `<em>${fmtARS(r.tributos * r.tc)}</em>` : ''}</div>
      <div><span>Desembolso total</span><b>${fmtUSD(r.desembolso)}</b>${r.tc ? `<em>${fmtARS(r.desembolso * r.tc)}</em>` : ''}</div>
      <div class="hl"><span>Costo real de la mercadería*</span><b>${fmtUSD(r.costoReal)}</b>${r.tc ? `<em>${fmtARS(r.costoReal * r.tc)}</em>` : ''}</div>
    </div>
    <table class="calc-table">${head}
      ${row(`Precio de compra (${esc(calc.inco)})`, r.precio)}
      ${r.inc.origen ? row('Gastos en origen', r.origen) : ''}
      ${r.fob != null && r.inc.origen ? row('Valor FOB', r.fob, 'Precio + gastos en origen', 'sub') : ''}
      ${r.inc.flete ? row('Flete internacional', r.flete) : ''}
      ${r.inc.seguro ? row('Seguro', r.seguro) : ''}
      ${row('Valor CIF', r.cif, 'Base de los tributos de importación', 'sub')}
      ${row(`Derecho de importación (${fmtPct(calc.mercosur ? 0 : num(calc.di))})`, r.di)}
      ${row(`Tasa de estadística (${fmtPct(calc.mercosur ? 0 : num(calc.te))})`, r.te)}
      ${row('Base imponible', r.base, 'CIF + derecho + tasa de estadística', 'sub')}
      ${row(`IVA (${fmtPct(num(calc.iva))})`, r.iva, 'Crédito fiscal')}
      ${row(`Percepción de IVA (${fmtPct(num(calc.piva))})`, r.piva, 'A cuenta del IVA')}
      ${row(`Percepción de Ganancias (${fmtPct(num(calc.pgan))})`, r.pgan, 'A cuenta de Ganancias')}
      ${row(`Percepción de Ingresos Brutos (${fmtPct(num(calc.piibb))})`, r.piibb, 'A cuenta de Ingresos Brutos')}
      ${row('Total de tributos en Aduana', r.tributos, '', 'total')}
      ${r.gastosList.filter(([, v]) => v).map(([l, v]) => row(l, v)).join('')}
      ${r.gastos ? row('Total de gastos en Argentina', r.gastos, '', 'sub') : ''}
    </table>
    <p class="note">* Para una empresa inscripta, el IVA y las percepciones (${fmtUSD(r.recuperables)}) se recuperan o se descuentan de otros impuestos, así que el costo real es CIF + derecho + tasa de estadística + gastos. Para un particular o un no inscripto, el costo es el desembolso total. Los gastos se muestran sin IVA.</p>
    ${!calc.mercosur && !num(calc.di) ? '<p class="warn">El derecho de importación está en 0 %. Si tu mercadería no es de origen Mercosur, completalo según su posición arancelaria.</p>' : ''}`;
}

function renderExportacion(){
  const f = calcField(expo, 'exp');
  $('#main').innerHTML = `<article class="article doc calc">
    <a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>
    ${calcTabs('exportacion')}
    <h1>Calculadora de exportación</h1>
    <p class="lede">Estimá cuánto te queda de una exportación desde la Argentina: derechos de exportación, reintegros y gastos hasta el embarque, a partir del valor FOB. Todas las alícuotas se pueden modificar.</p>
    <form class="calc-form" onsubmit="return false">
      <h2>1. Valor de la exportación (en USD)</h2>
      <div class="calc-grid">
        ${f('fob', 'Valor FOB', 'Precio de venta con la mercadería cargada en el puerto argentino. Si vendés CFR o CIF, restá el flete y el seguro que pagás vos. <a href="#guia-valor-fob">Qué es el FOB</a>')}
        ${f('insumos', 'Insumos importados incorporados', 'Valor CIF de los insumos importados que lleva el producto (por ejemplo, en importación temporaria). Según el régimen, se descuenta de la base del derecho y del reintegro. Si no corresponde, dejalo en 0.')}
        ${f('tc', 'Tipo de cambio (opcional)', 'Pesos por dólar, para ver los montos en $.')}
      </div>
      <h2>2. Derechos y estímulos</h2>
      <div class="calc-grid">
        ${f('dex', 'Derecho de exportación (%)', 'Depende de la posición arancelaria. Muchas posiciones tienen 0 %; los granos y otros productos agroindustriales tienen alícuotas propias que cambian con frecuencia.')}
        ${f('reint', 'Reintegro a la exportación (%)', 'Devolución de tributos internos que tienen algunas posiciones. Si no corresponde, dejalo en 0.')}
      </div>
      <h2>3. Gastos hasta el embarque (opcional, en USD)</h2>
      <div class="calc-grid">
        ${f('despachante', 'Despachante de aduana', 'Honorarios por el despacho de exportación.')}
        ${f('terminal', 'Terminal, depósito y puerto', 'Gastos de terminal, consolidación y agencia marítima.')}
        ${f('fleteint', 'Flete interno', 'Desde tu planta hasta el puerto o aeropuerto.')}
        ${f('otros', 'Otros gastos', 'Certificados de origen, inspecciones, bancos u otros.')}
      </div>
      <p><button class="btn sm" type="button" data-exp-reset>Restablecer valores</button></p>
    </form>
    <section class="calc-out" aria-live="polite" id="expOut"></section>
    <div class="callout"><p><b>Importante.</b> Es una estimación orientativa. Los derechos de exportación y los reintegros se fijan por posición arancelaria y cambian con frecuencia; además, puede haber regímenes especiales, valores referenciales o condiciones para cobrar el reintegro. Antes de operar, confirmalos con tu despachante de aduana o en la normativa vigente.</p></div>
    ${guideLinks(['valor-fob', 'incoterms', 'posicion-arancelaria'])}
  </article>`;
  updateExp();
  setSEO({ title:`Calculadora de exportación: derechos y reintegros · ${CONFIG.siteName}`, desc:'Calculá los derechos de exportación, los reintegros y los gastos de una exportación desde la Argentina, y cuánto te queda a partir del valor FOB.', crumbs:[['Herramientas'],['Calculadora de exportación']] });
}
function updateExp(){
  const out = $('#expOut'); if (!out) return;
  const r = expResult(expo);
  const ars = n => r.tc ? `<td class="ars">${fmtARS(n * r.tc)}</td>` : '';
  const row = (label, n, note = '', cls = '') => `<tr class="${cls}"><td>${label}${note ? `<small>${note}</small>` : ''}</td><td>${fmtUSD(n)}</td>${ars(n)}</tr>`;
  out.innerHTML = `<h2>Resultado</h2>
    <div class="calc-sum">
      <div><span>Derecho de exportación</span><b>${fmtUSD(r.dex)}</b>${r.tc ? `<em>${fmtARS(r.dex * r.tc)}</em>` : ''}</div>
      <div><span>Reintegro</span><b>${fmtUSD(r.reint)}</b>${r.tc ? `<em>${fmtARS(r.reint * r.tc)}</em>` : ''}</div>
      <div class="hl"><span>Ingreso neto estimado</span><b>${fmtUSD(r.neto)}</b>${r.tc ? `<em>${fmtARS(r.neto * r.tc)}</em>` : ''}</div>
    </div>
    <table class="calc-table"><tr><th>Concepto</th><th>USD</th>${r.tc ? '<th>Pesos</th>' : ''}</tr>
      ${row('Valor FOB', r.fob)}
      ${r.insumos ? row('Insumos importados', -r.insumos, 'Se descuentan de la base') : ''}
      ${row('Base del derecho y del reintegro', r.base, '', 'sub')}
      ${row(`Derecho de exportación (${fmtPct(num(expo.dex))})`, -r.dex)}
      ${r.reint ? row(`Reintegro (${fmtPct(num(expo.reint))})`, r.reint, 'Se cobra después del embarque') : ''}
      ${r.gastosList.filter(([, v]) => v).map(([l, v]) => row(l, -v)).join('')}
      ${row('Ingreso neto estimado', r.neto, 'FOB − derecho − gastos + reintegro', 'total')}
    </table>
    <p class="note">El ingreso neto no descuenta impuestos sobre la ganancia ni costos de producción. Los gastos se muestran sin IVA.</p>`;
}
function guideLinks(slugs){
  const list = slugs.map(s => (SITE_DATA.guides || []).find(g => g.slug === s)).filter(Boolean);
  return list.length ? `<section class="guide-links"><h2>Guías relacionadas</h2><ul>${list.map(g => `<li><a href="#guia-${esc(g.slug)}">${esc(g.title)}</a><small>${esc(g.desc)}</small></li>`).join('')}</ul></section>` : '';
}
function calcInput(e){
  const el = e.target.closest('[data-calc],[data-exp]'); if (!el) return;
  const isExp = 'exp' in el.dataset, obj = isExp ? expo : calc, k = isExp ? el.dataset.exp : el.dataset.calc;
  obj[k] = el.type === 'checkbox' ? el.checked : el.value;
  if (!isExp && k === 'iva'){ calc.piva = num(el.value) === 10.5 ? 10 : 20; const p = $('#calc-piva'); if (p) p.value = calc.piva; }
  if (!isExp && k === 'mercosur'){ ['di','te'].forEach(id => { const x = $('#calc-' + id); if (x) x.disabled = el.checked; }); }
  store.set(isExp ? 'comex.expo' : 'comex.calc', obj);
  if (!isExp && k === 'inco'){ const y = scrollY; renderCalculadora(); prettifyLinks(); window.scrollTo({ top: y }); $('#calc-inco')?.focus(); return; }
  isExp ? updateExp() : updateCalc();
}
document.addEventListener('input', e => { if (e.target.matches?.('input[data-calc]:not([type=checkbox]),input[data-exp]')) calcInput(e); });
document.addEventListener('change', e => { if (e.target.matches?.('select[data-calc],select[data-exp],input[type=checkbox][data-calc]')) calcInput(e); });
document.addEventListener('click', e => {
  if (e.target.closest('[data-calc-reset]')){ Object.assign(calc, CALC_DEFAULTS); store.set('comex.calc', calc); renderCalculadora(); prettifyLinks(); }
  if (e.target.closest('[data-exp-reset]')){ Object.assign(expo, EXP_DEFAULTS); store.set('comex.expo', expo); renderExportacion(); prettifyLinks(); }
});

function renderGuias(){
  const list = SITE_DATA.guides || [];
  $('#main').innerHTML = `<article class="article doc">
    <a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a>
    ${calcTabs('guias')}
    <h1>Guías de comercio exterior</h1>
    <p class="lede">Explicaciones prácticas para calcular costos, entender los Incoterms y clasificar la mercadería, con ejemplos y acceso directo a las calculadoras.</p>
    <ul class="guide-index">${list.map(g => `<li><a href="#guia-${esc(g.slug)}"><b>${esc(g.title)}</b><span>${esc(g.desc)}</span></a></li>`).join('')}</ul>
  </article>`;
  setSEO({ title:`Guías de comercio exterior · ${CONFIG.siteName}`, desc:'Guías prácticas: cómo calcular el costo de importar, qué es el valor CIF y el FOB, Incoterms 2020 y posición arancelaria NCM.', crumbs:[['Guías']] });
}
function renderGuide(g){
  if (!g) return renderNotFound();
  const full = SITE_DATA.guide && SITE_DATA.guide.slug === g.slug ? SITE_DATA.guide : null;
  const others = (SITE_DATA.guides || []).filter(x => x.slug !== g.slug);
  $('#main').innerHTML = `<article class="article doc guide">
    <a class="btn sm" href="#guias">${I.back}Todas las guías</a>
    <span class="eyebrow" style="display:block;margin-top:18px">Guía práctica</span>
    <h1>${esc(g.title)}</h1>
    <p class="lede">${esc(g.desc)}</p>
    ${g.updated ? `<p class="note">Actualizada el ${esc(fmtDLlong.format(new Date(g.updated + 'T12:00:00Z')))}</p>` : ''}
    <div class="guide-body">${full ? full.body : '<p>Abrí la guía completa desde su página.</p>'}</div>
    <div class="callout"><p>Esta guía es informativa y no reemplaza el asesoramiento de un despachante de aduana. Las alícuotas y la normativa cambian: verificá siempre la norma vigente.</p></div>
    <section class="guide-links"><h2>Más guías</h2><ul>${others.map(o => `<li><a href="#guia-${esc(o.slug)}">${esc(o.title)}</a><small>${esc(o.desc)}</small></li>`).join('')}</ul></section>
  </article>`;
  setSEO({ title:`${g.title} · ${CONFIG.siteName}`, desc: g.desc, type:'article', crumbs:[['Guías','#guias'],[g.title]],
    ld: { '@type':'Article', headline: g.title, description: g.desc, inLanguage:'es-AR', dateModified: g.updated, author: { '@type':'Organization', name: CONFIG.siteName } } });
}
function renderPage(key){
  const [title, html] = PAGES[key];
  $('#main').innerHTML = `<article class="article doc"><a class="btn sm" href="#inicio">${I.back}Volver a Noticias</a><h1>${esc(title)}</h1><div class="prose">${html}</div></article>`;
  setSEO({ title:`${title} · ${CONFIG.siteName}`, desc: title, crumbs:[[title]] });
}
function renderNotFound(){
  $('#main').innerHTML = emptyState('No encontramos esa página', 'Puede que la noticia ya no esté en el feed o que el enlace esté incompleto.', '<a class="btn sm primary" href="#inicio">Ir a la portada</a>');
  setSEO({ title:`Página no encontrada · ${CONFIG.siteName}`, desc:'', noindex:true });
}

/* =====================================================================
   12. PANEL LATERAL
   ===================================================================== */
function topTrends(n = 12){
  const reads = store.get('comex.reads', {});
  const recent = state.items.filter(i => dayDiff(i) <= 14);
  const m = new Map();
  const add = (label, type, w) => { const k = type + ':' + label; const e = m.get(k) || { label, type, n:0, w:0 }; e.n++; e.w += w; m.set(k, e); };
  recent.forEach(i => {
    const w = 1 + (reads[i.id] ? 1 : 0) + (dayDiff(i) <= 3 ? 1 : 0);
    i.tags.forEach(t => add(t, 'tag', w));
    i.topics.filter(t => !['Argentina','Latinoamérica','Europa','Asia'].includes(t)).forEach(t => add(t, 'topic', w * .8));
  });
  return [...m.values()].sort((a,b) => b.w - a.w || a.label.localeCompare(b.label, 'es')).slice(0, n);
}
function renderAside(){
  const items = state.items, view = state.view;
  const reads = store.get('comex.reads', {});
  const mostRead = Object.entries(reads).map(([id,n]) => [items.find(i=>i.id===id), n]).filter(([i]) => i).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const saved = store.get('comex.saved', []).map(id => items.find(i => i.id === id)).filter(Boolean);
  const trends = topTrends(12);
  const tc = t => items.filter(i => i.topics.includes(t)).length;
  const boxes = [];
  if (hasNewsletter && view !== 'calculadora') boxes.push(newsletterBox('aside'));
  if (view !== 'home') boxes.push(`<section class="box"><h2>Indicadores <small>últimos datos</small></h2>
    <div class="ind-mini">${state.indicators.filter(d => d.value).slice(0,6).map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer"><span class="l">${esc(d.label)}</span><span class="v">${esc(d.value)}</span><span class="p">${esc(d.period)} · ${esc(d.source)}</span><span class="c ${d.trend==='up'?'up':d.trend==='down'?'down':'flat'}">${d.trend==='up'?'▲':d.trend==='down'?'▼':''} ${esc(d.change)}</span></a>`).join('')}</div>
    <a class="foot-link" href="#datos">Ver todos los indicadores →</a></section>`);
  const nextDates = upcomingDeadlines().slice(0, 4);
  if (view !== 'home' && view !== 'agenda' && nextDates.length) boxes.push(`<section class="box"><h2>Próximas fechas <small>agenda</small></h2>
    <ol class="mini">${nextDates.map(d => `<li><a href="${esc(articleHref(d.it))}">${esc(d.label)}</a><span class="sub">${esc(d.monthOnly ? cap(fmtMonthYear.format(new Date(d.start))) : fmtDLshort.format(new Date(d.start)).replace('.', ''))} · ${esc(whenText(d))}</span></li>`).join('')}</ol>
    <a class="foot-link" href="#agenda">Ver la agenda →</a></section>`);
  if (view !== 'home') boxes.push(`<section class="box"><h2>Más recientes <small>${items.length} en archivo</small></h2>
    <ol class="mini">${items.slice(0,5).map(it => `<li><a href="${esc(articleHref(it))}">${esc(it.title)}</a><span class="sub" data-rel="${esc(it.id)}">${esc(relTime(it))}</span></li>`).join('')}</ol></section>`);
  boxes.push(`<section class="box"><h2>Temas en tendencia <small>últimos 14 días</small></h2>
    <div class="trend">${trends.map((t,i) => `<button type="button" class="${i<3?'hot':''}" data-${t.type}="${esc(t.label)}">${t.type==='tag'?'#':''}${esc(t.label)}<span class="n">${t.n}</span></button>`).join('')}</div>
    <p class="note" style="margin-top:10px">Según la frecuencia en las noticias recientes y tus lecturas en este navegador.</p></section>`);
  boxes.push(`<section class="box"><h2>Más leídas <small>en este navegador</small></h2>
    ${mostRead.length ? `<ol class="mini num">${mostRead.map(([it,n]) => `<li><span><a href="${esc(articleHref(it))}">${esc(it.title)}</a><span class="sub">${plural(n,'lectura')}</span></span></li>`).join('')}</ol>`
      : `<p class="note">Cuando abras noticias, las más consultadas aparecerán acá. Con un servicio de analítica conectado, este bloque muestra las más leídas por todo el público.</p>`}</section>`);
  boxes.push(`<section class="box"><h2>Guardadas <small>${saved.length}</small></h2>
    ${saved.length ? `<ol class="mini">${saved.slice(0,5).map(it => `<li><a href="${esc(articleHref(it))}">${esc(it.title)}</a></li>`).join('')}</ol><a class="foot-link" href="#guardadas">Ver todas →</a>` : `<p class="note">Usá «Guardar noticia» dentro de cada nota para leerla más tarde.</p>`}</section>`);
  if (view === 'home' || view === 'article') boxes.push(`<section class="box"><h2>Fuentes confiables</h2>
    <ul class="srcdir">${SOURCE_DIRECTORY.flatMap(g => g.items).filter(([n]) => /INDEC|ARCA|OMC|OMA|IATA|Mercosur|Comisión Europea/.test(n)).map(([n,u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('')}</ul>
    <a class="foot-link" href="#fuentes">Directorio completo →</a></section>`);
  boxes.push(`<section class="box"><h2>Accesos rápidos</h2>
    <div class="quick">${TOPICS.map(t => `<button type="button" data-topic="${esc(t)}"><span>${esc(t)}</span><span class="n">${tc(t)}</span></button>`).join('')}</div></section>`);
  $('#aside').innerHTML = boxes.join('');
}

/* =====================================================================
   13. ESTRUCTURA FIJA (encabezado, navegación, ticker, última hora, pie)
   ===================================================================== */
function renderStatus(){
  const now = new Date();
  $('#today').textContent = cap(fmtDay.format(now));
  $('#todayLong').textContent = fmtDay.format(now);
  $('#year').textContent = now.getFullYear();
  const up = state.updatedAt ? new Date(state.updatedAt) : null;
  const upTxt = up ? `${shortDate(up)}, ${fmtTime.format(up)} h` : '—';
  $('#updatedLong').textContent = upTxt; $('#footUpdated').textContent = upTxt;
  $('#mastUpdated').textContent = up ? `Feed actualizado ${agoText(up)} · revisado ${fmtTime.format(state.checkedAt || now)} h` : 'Sin datos del feed';
  $('#mastUpdated').title = up ? `Última actualización del feed: ${upTxt}` : '';
  $('#liveText').textContent = 'ACTUALIZADO';
  $('#liveBadge').classList.toggle('is-live', state.live);
  $('#liveBadge').title = state.live ? `Feed automático: las fuentes se consultan varias veces por día y la página lo revisa cada ${CONFIG.refreshMinutes} minutos.` : `Feed curado. Se revisa cada ${CONFIG.refreshMinutes} minutos.`;
  const week = state.items.filter(i => dayDiff(i) <= 7).length, today = state.items.filter(i => dayDiff(i) === 0).length;
  $('#countLine').innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg><b>${state.items.length}</b>&nbsp;noticias · <b>${week}</b>&nbsp;en 7 días${today ? ` · <b>${today}</b>&nbsp;hoy` : ''}`;
  $('#footFeed').textContent = `Las noticias se actualizan automáticamente mediante un feed normalizado y GitHub Actions. Las fuentes se consultan periódicamente y los artículos nuevos se incorporan sin editar el HTML. La página consulta el feed cada ${CONFIG.refreshMinutes} minutos y suma lo nuevo sin recargar.`;
}
function currentNav(){
  if (state.view === 'home') return 'inicio';
  if ((state.view === 'section' || state.view === 'argentina')) return state.filters.section;
  if (state.view === 'article'){ const it = state.items.find(i => i.id === state.articleId); const s = it && sectionOf(it); return s ? (groupOf(s.slug)?.slug || s.slug) : ''; }
  return '';
}
function renderNav(){
  const cur = currentNav();
  const cnt = s => state.items.filter(i => inSection(i, s)).length;
  const curGroup = groupOf(cur)?.slug;
  const extra = [['datos','Datos','datos'],['agenda','Agenda','agenda'],['buscar?tipo=analisis','Análisis','analisis'],['calculadora','Calculadoras','calculadora']];
  const curExtra = state.view === 'results' && state.filters.kind === 'analisis' && filterCount(state.filters) === 1 ? 'analisis' : state.view;
  const sub = g => `<div class="sub" id="sub-${g.slug}"><ul>${[g.slug, ...g.sections].map(sectionBySlug).filter(s => s && (s.slug === g.slug || s.slug === cur || cnt(s))).map(s =>
    `<li><a href="#tema-${s.slug}" ${cur===s.slug?'aria-current="page"':''}>${s.slug === g.slug ? `Todo ${esc(g.label)}` : esc(s.label)}<span class="n">${cnt(s)}</span></a></li>`).join('')}</ul></div>`;
  $('#navList').innerHTML = `<li class="nav-top"><a href="#inicio" ${cur==='inicio'?'aria-current="page"':''}>Inicio<span class="n">${state.items.length}</span></a></li>` +
    GROUPS.map(g => `<li class="has-sub${curGroup===g.slug?' cur':''}"><a class="grp" href="#tema-${g.slug}" ${cur===g.slug?'aria-current="page"':''}>${esc(g.label)}</a><button type="button" class="sub-btn" aria-expanded="false" aria-controls="sub-${g.slug}" aria-label="Ver secciones de ${esc(g.label)}"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>${sub(g)}</li>`).join('') +
    extra.map(([h, l, k]) => `<li class="nav-top nav-x nav-${k}"><a href="#${h}" ${curExtra===k?'aria-current="page"':''}>${l}</a></li>`).join('') +
    '<li class="nav-prefs"><button type="button" data-open-prefs>Preferencias: tema, texto y mis temas</button></li>';
  const tc = t => state.items.filter(i => i.topics.includes(t)).length;
  const f = state.filters, onlyTopic = f.topic && filterCount(f) === 1;
  $('#chips').innerHTML = [['Todas',''], ...TOPICS.map(t => [t,t])].map(([l,v]) =>
    `<button class="chip" type="button" data-topic="${esc(v)}" aria-pressed="${v ? String(onlyTopic && f.topic === v) : String(state.view === 'home')}">${esc(l)}${v ? `<span class="n">${tc(v)}</span>` : ''}</button>`).join('');
  const link = slug => { const s = sectionBySlug(slug); return s ? `<li><a href="#tema-${s.slug}">${esc(GROUP_SLUGS.has(slug) ? groupOf(slug).label : s.title)}</a></li>` : ''; };
  $('#footSections').innerHTML = ['mundo','argentina','logistica','mercados','aranceles','aduanas','arca','importaciones','exportaciones'].map(link).join('');
  $('#footTopics').innerHTML = ['fletes','contenedores','puertos','agro','energia','mineria','china','estados-unidos','union-europea','mercosur'].map(link).join('');
  $('#social').innerHTML = CONFIG.social.length ? `<p style="display:flex;gap:12px;flex-wrap:wrap">${CONFIG.social.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>`).join('')}</p>` : '';
}
function closeSubs(except){ $$('#navList .has-sub.open').forEach(li => { if (li !== except){ li.classList.remove('open'); li.querySelector('.sub-btn')?.setAttribute('aria-expanded','false'); } }); }
function renderTicker(){
  const list = state.indicators;
  $('#tickerList').innerHTML = list.length ? list.map(tickerItem).join('') : '<span class="tk"><span class="l">Sin indicadores disponibles</span></span>';
}
function renderBreaking(){
  const b = byDate(state.items.filter(isBreaking))[0];
  const el = $('#breaking');
  if (!b){ el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="wrap"><span class="breaking-tag"><i aria-hidden="true"></i>Última hora</span><span class="breaking-time">${esc(b.datetime ? fmtTime.format(new Date(b.datetime)) + ' h' : fmtDM.format(itemDate(b)).replace('.',''))}</span><a href="${esc(articleHref(b))}">${esc(b.title)}</a><span class="bsrc">${esc(b.primary.name)} · <span data-rel="${esc(b.id)}">${esc(relTime(b))}</span></span></div>`;
}
function renderCrumbs(crumbs){
  const parts = ['<a href="#inicio">Inicio</a>'];
  (crumbs || [['Noticias']]).forEach(([l, h], i, arr) => parts.push('<span aria-hidden="true">/</span>', h && i < arr.length - 1 ? `<a href="${esc(h)}">${esc(l)}</a>` : `<span aria-current="page">${esc(l.length > 60 ? l.slice(0,57) + '…' : l)}</span>`));
  $('#crumbs').innerHTML = parts.join('');
}
function fillSelects(){
  const opt = (arr, all, lab = x => x) => `<option value="">${all}</option>` + arr.map(v => `<option value="${esc(v)}">${esc(lab(v))}</option>`).join('');
  const uniq = arr => [...new Set(arr)].sort((a,b)=>a.localeCompare(b,'es'));
  $('#fRegion').innerHTML = opt(REGIONS.filter(r => state.items.some(i => regionsOf(i).has(r))), 'Todas las regiones');
  $('#fCountry').innerHTML = opt(uniq(state.items.flatMap(i=>i.countries)), 'Todos los países');
  $('#fTopic').innerHTML = opt(TOPICS, 'Todas las categorías');
  $('#fSource').innerHTML = opt(uniq(state.items.flatMap(i=>i.sources.map(s=>s.name))), 'Todas las fuentes');
  $('#fTag').innerHTML = opt(uniq(state.items.flatMap(i=>i.tags)), 'Todos los temas');
  const presets = [
    ['Argentina + Exportaciones + 7 días', { section:'argentina', flow:'exportaciones', date:'7' }],
    ['China + Logística + 30 días', { country:'China', topic:'Logística', date:'30' }],
    ['Aranceles en EE.UU.', { country:'Estados Unidos', topic:'Aranceles' }],
    ['Normativa ARCA', { source:'', q:'ARCA', topic:'Regulaciones' }],
  ];
  $('#presets').innerHTML = '<span>Combinaciones rápidas:</span>' + presets.map(([l, f], i) => `<button type="button" data-preset="${i}">${esc(l)}</button>`).join('');
  fillSelects.presets = presets;
  $('#searchHints').innerHTML = '<span>Búsquedas frecuentes:</span>' + ['aranceles','Mercosur','fletes','ARCA','acero'].map(q => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  syncControls();
}
function syncControls(){
  const f = state.filters;
  const set = (id, v) => { const el = $('#' + id); if (el && document.activeElement !== el) el.value = v; };
  set('q', f.q); set('mastQ', f.q); set('mobileQ', f.q);
  set('fRegion', f.region); set('fCountry', f.country); set('fTopic', f.topic); set('fDate', f.date); set('fFlow', f.flow);
  set('fSource', f.source); set('fTag', f.tag); set('fArg', f.arg); set('fKind', f.kind); set('fSort', state.sort);
  const n = filterCount(f) - (f.q ? 1 : 0);
  $('#advCount').hidden = !n; $('#advCount').textContent = n;
}

function render(){
  renderStatus(); renderNav(); renderTicker(); renderBreaking();
  $('#phead').classList.toggle('compact', state.view !== 'home');
  const v = state.view;
  if (v === 'loading') return;
  if (v === 'article'){ const it = state.items.find(i => i.id === state.articleId); it ? renderArticle(it) : renderNotFound(); }
  else if (v === 'section') renderSection();
  else if (v === 'argentina') renderArgentina();
  else if (v === 'results') renderResults();
  else if (v === 'datos') renderDatos();
  else if (v === 'fuentes') renderFuentes();
  else if (v === 'guardadas') renderGuardadas();
  else if (v === 'calculadora') renderCalculadora();
  else if (v === 'exportacion') renderExportacion();
  else if (v === 'guias') renderGuias();
  else if (v === 'guide') renderGuide(guideBySlug(state.guideId));
  else if (v === 'agenda') renderAgenda();
  else if (v === 'glosario') renderGlosario();
  else if (v === 'story'){ const st = storyById(state.storyId); st ? renderStory(st) : renderNotFound(); }
  else if (PAGES[v]) renderPage(v);
  else if (v === 'notfound') renderNotFound();
  else renderHome();
  $('#main').setAttribute('aria-busy', 'false');
  renderAside(); syncControls(); updateProgress(); prettifyLinks(); drawTradeCharts();
}

/* =====================================================================
   14. NAVEGACIÓN (rutas con hash)
   #inicio · #tema-<sección> · #buscar?q=…&pais=… · #<id-de-noticia> · #datos · #fuentes · #guardadas · #acerca
   ===================================================================== */
function filterHash(f, sort = 'relevancia'){
  const full = { ...emptyFilters(), ...f };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(full)) if (v) p.set(PARAM[k], v);
  if (sort !== 'relevancia') p.set('orden', sort);
  const keys = [...p.keys()];
  if (!keys.length) return '#inicio';
  if (keys.length === 1 && full.section) return '#tema-' + full.section;
  return '#buscar?' + p.toString();
}
function viewFor(f){
  const n = filterCount(f);
  if (!n) return 'home';
  if (n === 1 && f.section) return f.section === 'argentina' ? 'argentina' : 'section';
  return 'results';
}
function parseHash(){
  const raw = location.hash.slice(1);
  const i = raw.indexOf('?');
  const path = decodeURIComponent(i === -1 ? raw : raw.slice(0, i));
  return { path, params: new URLSearchParams(i === -1 ? '' : raw.slice(i + 1)) };
}
function route(){
  if (!state.loaded){ state.view = 'loading'; return; }
  const m = location.pathname.match(/\/noticias\/([^/]+)\/?(?:index\.html)?$/);
  const rel = location.pathname.slice(sitePath().length).replace(/index\.html$/, '').replace(/^\/+|\/+$/g, '');
  const staticHash = CONFIG.prettyUrls && !m ? hashFromPretty(rel) : null; 
  let path, params;
  if (staticHash && location.hash.length > 1 && location.hash !== '#main') {
    // Desde una página con dirección propia, los filtros y búsquedas vuelven a la portada.
    location.replace(BASE + location.hash);
    return;
  }
  if (staticHash) {
    path = staticHash;
    params = new URLSearchParams();
  } else if (m && location.hash.length > 1) {
    // Desde una nota, los enlaces de sección (#tema-…, #buscar?…) vuelven a la portada.
    location.replace(BASE + (FILE_MODE ? 'index.html' : '') + location.hash);
    return;
  } else if (m) {
    path = decodeURIComponent(m[1]);
    params = new URLSearchParams();
  } else {
    ({ path, params } = parseHash());
    // Enlaces viejos o internos con hash (#calculadora, #tema-aduanas): van a su dirección propia.
    if (CONFIG.prettyUrls && !m && prettyPath(path) && ![...params.keys()].length){ location.replace(prettyHref(path)); return; }
  }
  state.pretty = prettyPath(path);
  state.listCount = CONFIG.pageSize;
  const prevView = state.view;
  if (path === '' || path === 'inicio'){ state.filters = emptyFilters(); state.view = 'home'; }
  else if (path === 'ultimas'){ state.filters = emptyFilters(); state.view = 'home'; }
  else if (path.startsWith('tema-')){
    const key = path.slice(5), s = sectionBySlug(key);
    const t = s ? null : TOPICS.find(x => slug(x) === key);
    state.filters = { ...emptyFilters(), ...(s ? { section: s.slug } : t ? { topic: t } : {}) };
    state.view = viewFor(state.filters);
  }
  else if (path === 'buscar'){
    const f = emptyFilters();
    for (const [k, p] of Object.entries(PARAM)) f[k] = params.get(p) || '';
    if (f.topic && !TOPICS.includes(f.topic)) f.topic = '';
    state.filters = f; state.sort = params.get('orden') === 'fecha' ? 'fecha' : 'relevancia';
    state.view = viewFor(f);
  }
  else if (['datos','fuentes','guardadas','calculadora','exportacion','guias','agenda','glosario'].includes(path) || PAGES[path]) state.view = path;
  else if (path.startsWith('guia-') && guideBySlug(path.slice(5))){ state.view = 'guide'; state.guideId = path.slice(5); }
  else if (path.startsWith('hilo-') && storyById(path.slice(5))){ state.view = 'story'; state.storyId = path.slice(5); }
  else if (state.items.some(i => i.id === path)){ state.view = 'article'; state.articleId = path; countRead(path); }
  else state.view = 'notfound';
  render();
  closeMenus();
  if (path === 'ultimas'){ $('#ultimas')?.scrollIntoView(); $('#ultimas')?.focus({ preventScroll:true }); }
  else if (!state.firstRoute){ window.scrollTo({ top: 0 }); if (prevView !== state.view || state.view === 'article') $('#main').focus({ preventScroll:true }); }
  state.firstRoute = false;
  window.gtag?.('event', 'page_view', { page_location: location.href, page_title: document.title });
}
function go(h){ if (location.hash === h) route(); else location.hash = h; }
// Cambia filtros. replace=true actualiza la URL sin sumar historial (búsqueda mientras se escribe).
function applyFilters(patch, { replace = false } = {}){
  const f = { ...state.filters, ...patch };
  const h = filterHash(f, state.sort);
  if (!replace) return go(h);
  history.replaceState(null, '', h);
  state.filters = f; state.view = viewFor(f); state.listCount = CONFIG.pageSize;
  render();
  const ph = $('#phead'), top = ph.offsetTop + ph.offsetHeight - mastH();
  if (scrollY > top) window.scrollTo({ top });
}
function countRead(id){ const r = store.get('comex.reads', {}); r[id] = (r[id] || 0) + 1; store.set('comex.reads', r); }

/* =====================================================================
   15. ACCIONES
   ===================================================================== */
function shareUrl(it){
  const base = CONFIG.canonicalBase || location.href.split('#')[0];
  return CONFIG.prettyUrls && CONFIG.canonicalBase ? `${base.replace(/\/$/,'')}/noticias/${encodeURIComponent(it.id)}/` : `${base}#${it.id}`;
}
function toast(msg, action){
  const t = $('#toast'); t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`; t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, action ? 6000 : 2800);
}
function copy(text, ok = 'Copiado'){
  const fallback = () => { const i = document.createElement('input'); i.value = text; document.body.appendChild(i); i.select(); try { document.execCommand('copy') ? toast(ok) : toast('Seleccioná y copiá: ' + text); } catch { toast('Seleccioná y copiá: ' + text); } i.remove(); };
  try { navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(() => toast(ok), fallback) : fallback(); } catch { fallback(); }
}
function toggleSave(id){
  const s = store.get('comex.saved', []); const i = s.indexOf(id);
  if (i >= 0) s.splice(i,1); else s.unshift(id);
  store.set('comex.saved', s);
  const on = i < 0, b = $('#saveBtn');
  if (b){ b.classList.toggle('saved', on); b.setAttribute('aria-pressed', on); b.querySelector('span').textContent = on ? 'Guardada' : 'Guardar noticia'; }
  toast(on ? 'Noticia guardada' : 'Se quitó de guardadas', on ? { label:'Ver guardadas', run:() => go('#guardadas') } : { label:'Deshacer', run:() => toggleSave(id) });
  renderAside();
}

/* =====================================================================
   16. TEMA, TAMAÑO DE TEXTO Y PREFERENCIAS
   ===================================================================== */
function applyPrefs(){
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  root.style.setProperty('--txt', prefs.size);
  paintThemeBtn();
}
function currentDark(){ const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function paintThemeBtn(){
  const d = currentDark();
  $('#themeIcon').innerHTML = d ? I.sun : I.moon;
  $('#themeLabel').textContent = d ? 'Modo claro' : 'Modo oscuro';
  $('#themeBtn').setAttribute('aria-label', d ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
}
function openPrefs(){
  const f = $('#prefsForm');
  f.theme.value = prefs.theme; f.size.value = prefs.size;
  $('#prefTopics').innerHTML = TOPICS.map((t, i) => `<label for="pt${i}"><input type="checkbox" id="pt${i}" value="${esc(t)}" ${prefs.topics.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('');
  const d = $('#prefs'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

/* =====================================================================
   17. SEO DINÁMICO
   ===================================================================== */
function crumbUrl(h){
  const base = CONFIG.canonicalBase || location.href.split('#')[0].replace(/\/$/, '');
  const p = h?.startsWith('#') ? prettyPath(h.slice(1)) : null;
  return p ? `${base}/${p}` : h?.startsWith('#') ? `${base}/` : h;
}
function setSEO({ title, desc, image, url, type = 'website', crumbs, ld, noindex = false }){
  document.title = title;
  const pageUrl = url || (CONFIG.canonicalBase ? CONFIG.canonicalBase + '/' + (state.pretty || '') : location.href.split('#')[0]);
  const meta = (sel, attr, val) => { let m = document.querySelector(sel); if (!m){ m = document.createElement('meta'); const [k, v] = attr; m.setAttribute(k, v); document.head.appendChild(m); } m.setAttribute('content', val); };
  meta('meta[name="description"]', ['name','description'], desc);
  meta('meta[property="og:title"]', ['property','og:title'], title);
  meta('meta[property="og:description"]', ['property','og:description'], desc);
  meta('meta[property="og:type"]', ['property','og:type'], type);
  meta('meta[property="og:url"]', ['property','og:url'], pageUrl);
  meta('meta[name="twitter:title"]', ['name','twitter:title'], title);
  meta('meta[name="twitter:description"]', ['name','twitter:description'], desc);
  meta('meta[name="robots"]', ['name','robots'], noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large');
  if (image){ meta('meta[property="og:image"]', ['property','og:image'], image); meta('meta[name="twitter:image"]', ['name','twitter:image'], image); }
  const can = $('#canonical'); if (can) can.setAttribute('href', pageUrl);
  renderCrumbs(crumbs);
  const graph = [];
  if (ld) graph.push(ld);
  const bc = [['Inicio','#inicio'], ...(crumbs || [])];
  graph.push({ '@type':'BreadcrumbList', itemListElement: bc.map(([l, h], i) => ({ '@type':'ListItem', position: i + 1, name: l, ...(h ? { item: crumbUrl(h) } : {}) })) });
  $('#ld').textContent = JSON.stringify({ '@context':'https://schema.org', '@graph': graph });
}

/* =====================================================================
   18. SCROLL Y MENÚS
   ===================================================================== */
const mastH = () => $('#mast').offsetHeight;
function setMastVar(){
  document.documentElement.style.setProperty('--mast-h', mastH() + 'px');
  const top = $('.util').offsetHeight + $('.mast-top').offsetHeight + ($('#mast').classList.contains('search-open') ? $('#mastSearchRow').offsetHeight : 0);
  document.documentElement.style.setProperty('--mast-top-h', top + 'px');
}
function updateProgress(){
  const p = $('#progress'), a = $('#art');
  if (state.view !== 'article' || !a){ p.style.width = '0'; return; }
  const r = a.getBoundingClientRect(), total = r.height - innerHeight + mastH();
  p.style.width = Math.min(100, Math.max(0, (-r.top + mastH()) / Math.max(1,total) * 100)) + '%';
}
function closeMenus(){
  closeSubs();
  $('#nav').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded','false'); $('#menuBtn').setAttribute('aria-label','Abrir menú de secciones');
  setMastVar();
}

/* =====================================================================
   19. EVENTOS
   ===================================================================== */
document.addEventListener('click', e => {
  const sb = e.target.closest('.sub-btn');
  if (sb){ const li = sb.closest('.has-sub'); closeSubs(li); const open = li.classList.toggle('open'); sb.setAttribute('aria-expanded', String(open)); return; }
  if (!e.target.closest('.has-sub')) closeSubs();
  const a = e.target.closest('a[href^="#"]');
  if (a && a.getAttribute('href') === location.hash){ e.preventDefault(); route(); return; }
  if (a && a.getAttribute('href') === '#main'){ e.preventDefault(); $('#main').focus(); return; }
  const g = e.target.closest('[data-gl]');
  if (g) return showGloss(g);
  const t = e.target.closest('[data-topic],[data-tag],[data-country],[data-region],[data-source],[data-section],[data-clear],[data-q],[data-preset],[data-size],[data-copy],[data-open-prefs],#loadMore');
  if (!t) return;
  const d = t.dataset;
  if (t.id === 'loadMore'){ state.listCount += CONFIG.pageSize; const y = scrollY; render(); window.scrollTo({ top: y }); return; }
  if ('openPrefs' in d) return openPrefs();
  if (d.copy) return copy(d.copy, 'Dirección copiada');
  if (d.size){ prefs.size = d.size; savePrefs(); applyPrefs(); $$('.textsize button').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === prefs.size)); return; }
  if (d.clear){ if (d.clear === 'all') return go('#inicio'); return applyFilters({ [d.clear]: '' }); }
  if (d.preset){ const f = fillSelects.presets[+d.preset][1]; return go(filterHash(f)); }
  if ('topic' in d){
    if (!d.topic) return go('#inicio');
    return go(filterHash({ topic: d.topic }));
  }
  if (d.section) return go('#tema-' + d.section);
  if (d.q) return go(filterHash({ q: d.q, arg: d.arg || '' }));
  const base = ['article','datos','fuentes','guardadas','notfound','agenda','glosario','story','calculadora','exportacion','guias','guide'].includes(state.view) || PAGES[state.view] ? emptyFilters() : state.filters;
  if (d.tag) return go(filterHash({ ...base, tag: d.tag }));
  if (d.country) return go(filterHash({ ...base, country: d.country }));
  if (d.region) return go(filterHash({ ...base, region: d.region }));
  if (d.source) return go(filterHash({ source: d.source }));
});
let qTimer;
const onQuery = v => { clearTimeout(qTimer); qTimer = setTimeout(() => applyFilters({ q: v.trim() }, { replace:true }), 280); };
['q','mastQ','mobileQ'].forEach(id => $('#' + id).addEventListener('input', e => onQuery(e.target.value)));
[['searchForm','q'],['mastSearchForm','mastQ'],['mobileSearchForm','mobileQ']].forEach(([f, i]) => $('#' + f).addEventListener('submit', e => {
  e.preventDefault(); clearTimeout(qTimer); applyFilters({ q: $('#' + i).value.trim() }); $('#' + i).blur();
}));
[['fRegion','region'],['fCountry','country'],['fTopic','topic'],['fDate','date'],['fSource','source'],['fTag','tag'],['fArg','arg'],['fFlow','flow'],['fKind','kind']].forEach(([id,k]) =>
  $('#'+id).addEventListener('change', e => {
    const base = ['home','results','section','argentina'].includes(state.view) ? {} : emptyFilters();
    applyFilters({ ...base, [k]: e.target.value }, { replace:true });
  }));
$('#fSort').addEventListener('change', e => { state.sort = e.target.value; applyFilters({}, { replace:true }); });
$('#advBtn').onclick = () => { const a = $('#adv'); a.hidden = !a.hidden; $('#advBtn').setAttribute('aria-expanded', String(!a.hidden)); if (!a.hidden) $('#fRegion').focus(); };
$('#clearAll').onclick = () => go('#inicio');
$('#menuBtn').onclick = () => { const n = $('#nav'); const open = n.classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', String(open)); $('#menuBtn').setAttribute('aria-label', open ? 'Cerrar menú de secciones' : 'Abrir menú de secciones'); setMastVar(); };
$('#searchJump').onclick = () => { const m = $('#mast'); const open = m.classList.toggle('search-open'); $('#searchJump').setAttribute('aria-expanded', String(open)); setMastVar(); if (open) $('#mobileQ').focus(); };
$('#themeBtn').onclick = () => { prefs.theme = currentDark() ? 'light' : 'dark'; savePrefs(); applyPrefs(); };
$('#prefsBtn').onclick = openPrefs;
$('#prefsReset').onclick = () => { const f = $('#prefsForm'); f.theme.value = 'system'; f.size.value = '1'; $$('#prefTopics input').forEach(i => i.checked = false); };
$('#prefsForm').addEventListener('submit', e => {
  if (e.submitter?.value !== 'save') return;
  const f = e.target; prefs.theme = f.theme.value || 'system'; prefs.size = f.size.value || '1';
  prefs.topics = $$('#prefTopics input:checked').map(i => i.value);
  savePrefs(); applyPrefs(); render(); toast('Preferencias guardadas');
  if (!$('#prefs').showModal){ e.preventDefault(); $('#prefs').removeAttribute('open'); }
});
$('#toTop').onclick = () => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
let ticking = false;
addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { $('#toTop').hidden = scrollY < 700; updateProgress(); ticking = false; }); }, { passive:true });
addEventListener('hashchange', route);
addEventListener('popstate', route);
addEventListener('resize', setMastVar);
function showGloss(el){
  const g = glossEntry(el.dataset.gl);
  if (g) toast(`${g.term}: ${g.def}`, { label:'Glosario', run: () => go('#glosario') });
}
addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-gl]')){ e.preventDefault(); showGloss(e.target.closest('[data-gl]')); return; }
  if (e.key === 'Escape'){
    const sub = $('#navList .has-sub.open'); if (sub){ closeSubs(); sub.querySelector('.sub-btn')?.focus(); }
    if ($('#nav').classList.contains('open')){ closeMenus(); $('#menuBtn').focus(); }
    if ($('#mast').classList.contains('search-open')){ $('#mast').classList.remove('search-open'); $('#searchJump').setAttribute('aria-expanded','false'); setMastVar(); }
  }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){ e.preventDefault(); const t = getComputedStyle($('#mastSearchForm')).display !== 'none' ? $('#mastQ') : $('#q'); t.focus(); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintThemeBtn);

/* =====================================================================
   20. ARRANQUE
   ===================================================================== */
(async function init(){
  if (FILE_MODE) $$('a[data-h]').forEach(a => a.setAttribute('href', '#' + a.dataset.h));   // abierto con doble clic: sin direcciones propias
  applyPrefs(); setMastVar(); renderStatus();
  await loadFeeds();
  trackNew();
  fillSelects();
  route();
  // Revisión periódica de fuentes: suma noticias nuevas sin recargar.
  setInterval(async () => {
    const before = new Set(state.items.map(i => i.id));
    await loadFeeds();
    const added = state.items.filter(i => !before.has(i.id));
    if (added.length){
      added.forEach(i => state.newIds.add(i.id)); store.set('comex.seen', state.items.map(i => i.id));
      fillSelects();
      const reading = ['article','calculadora','exportacion','guide'].includes(state.view);
      if (!reading) render(); else { renderStatus(); renderBreaking(); renderAside(); }
      toast(added.length === 1 ? 'Nueva noticia: ' + added[0].title.slice(0, 60) + (added[0].title.length > 60 ? '…' : '') : `${added.length} noticias nuevas`, { label:'Ver', run:() => goArticle(added[0].id) });
    } else { renderStatus(); renderTicker(); }
  }, CONFIG.refreshMinutes * 60000);
  // Refresca los "hace X minutos" cada minuto.
  setInterval(() => { $$('[data-rel]').forEach(el => { const it = state.items.find(i => i.id === el.dataset.rel); if (it) el.textContent = relTime(it); }); renderStatus(); }, 60000);
})();
})();
