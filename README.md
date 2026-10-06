# Pulso Comex

Portal estático de noticias de comercio exterior, publicado en GitHub Pages y actualizado solo con GitHub Actions.

## Cómo se actualiza

El workflow `.github/workflows/update-news.yml` corre a las 06:30, 10:30, 14:30, 18:30 y 22:30 (hora argentina), cada vez que se suben cambios a `main` y a mano desde **Actions → Actualizar y publicar Pulso Comex → Run workflow**. En cada corrida:

1. `scripts/update_news.py` lee las fuentes de `sources.json` y guarda las notas en `data/news.json`.
   - Una fuente caída no frena a las demás; el resumen de cada corrida (qué fuentes respondieron y cuántas notas nuevas hubo) aparece en la página de la ejecución en Actions y en `data/sources-status.json`.
   - Deduplica por enlace original. Las notas que cuentan el mismo hecho con otro título se agrupan (`group_auto`): queda la más completa y las demás pasan a «También publicaron esta noticia» (fuentes con `alsoIn: true`); sus direcciones viejas redirigen a la que quedó (`mergedIds`).
   - Descarta notas fuera de tema aunque usen palabras del rubro: lista `EXCLUDE` (aranceles médicos o notariales, accidentes, cruceros, promociones de consumo…). Se aplica también a lo que ya estaba guardado.
   - Google Noticias no trae resumen: el bot resuelve el enlace del medio (hasta `MAX_GN_RESOLVE` por corrida) y toma la descripción y la imagen que la página publica para compartir. Si no puede, la nota se muestra solo con el titular y un aviso (nunca con texto de relleno).
   - Limpia firmas al inicio de los resúmenes («Por Redacción … @…»).
   - Detecta países, categorías y si la nota menciona a Argentina.
   - Usa la imagen que publica la propia fuente (en el RSS o en la página original), con crédito.
   - Al terminar, `scripts/update_indicators.py` actualiza los indicadores de mercado: tipo de cambio mayorista (API del BCRA), precio pizarra de soja, maíz y trigo (Bolsa de Comercio de Rosario) y petróleo Brent (serie de la EIA publicada por FRED). Si una fuente falla, se conserva el último dato.
   - Después, `scripts/update_trade.py` arma `data/trade.json` con el intercambio comercial argentino del INDEC (series de tiempo de datos.gob.ar): exportaciones e importaciones por mes, por rubro, por uso económico, por destino y por origen. Es la base del panel de `/datos/`.
2. `scripts/fetch_photos.py` descarga una copia local de las fotos de archivo (`img/stock/`), usadas cuando la nota no trae imagen.
3. `scripts/build_pages.py` genera `index.html`, una página liviana por nota en `/noticias/<id>/` (con su propio título, descripción e imagen para redes), una página por sección (`/seccion/<slug>/`), por tema en desarrollo (`/tema/<id>/`) y por guía (`/guias/<slug>/`), las herramientas (`/datos/`, `/agenda/`, `/glosario/`, `/calculadora-importacion/`, `/calculadora-exportacion/`, `/guias/`…), `data/latest.json`, `sitemap.xml`, `news-sitemap.xml` y `feed.xml`. Borra las páginas que ya no corresponden.
4. Guarda los cambios en el repositorio y publica el sitio.

La página, además, vuelve a consultar `data/latest.json` cada 10 minutos y suma las notas nuevas sin recargar.

## Dónde editar

| Qué | Archivo |
|---|---|
| Estructura HTML (encabezado, footer, menús) | `templates/page.html` |
| Estilos | `assets/app.css` |
| Funcionamiento de la página | `assets/app.js` |
| Fuentes de noticias | `sources.json` |
| Notas curadas a mano e indicadores | `data/news.json` |
| Secciones del menú (4 bloques) y sus reglas | `data/taxonomy.json` |
| Guías prácticas | `data/guides.json` |
| Glosario | `data/glossary.json` |
| Fotos de archivo | `data/photos.json` |

`index.html` y todo `/noticias/` se generan solos: no los edites a mano.

### Agregar una fuente

Sumá un bloque a `sources.json`:

```json
{
  "name": "Nombre visible del medio",
  "url": "https://ejemplo.com/feed/",
  "type": "Medio especializado · Argentina",
  "enabled": true,
  "min_relevance": 1,
  "fetch_og": true,
  "topics": ["Argentina"],
  "countries": ["Argentina"],
  "tags": []
}
```

- `min_relevance`: 0 acepta todo; 1 o más exige palabras de comercio exterior (útil en medios generales).
- `fetch_og`: busca la imagen en la página original cuando el RSS no la trae.
- `aggregator: true` y `max_new`: para Google Noticias (toma el medio real de cada nota y limita cuántas notas suma por corrida).
- `use_source_images: false`: no usar las imágenes de esa fuente (queda la foto de archivo).

### Notas curadas a mano

Se cargan en `data/news.json` con el mismo formato que las existentes, sin `"label": "Automática"`. Las curadas nunca se pisan ni se borran solas, y son las únicas que se envían a los buscadores (ver abajo).

Campos opcionales de una nota curada:

- `"deadlines": [{ "date": "2026-11-02", "label": "Qué pasa ese día", "url": "fuente de la fecha (opcional)" }]`: fechas que aparecen en **Próximas fechas** (portada), en la nota y en la **Agenda** (`#agenda`). Usá `"date": "2026-11"` si la fuente solo informa el mes.
- `"story": "ormuz"`: agrupa la nota en un **tema en desarrollo**. Los temas se definen en la lista `"stories"` de la raíz de `data/news.json` (`id`, `title`, `desc` y `match`, expresiones para sumar notas automáticas del mismo tema en la página `#hilo-<id>`). Un tema aparece en la portada cuando tiene al menos dos notas.
- `"absorbs": ["id-de-nota-automática"]`: notas automáticas que repiten esta nota; el bot las retira y no las vuelve a agregar.
- `"explainer"`: el bloque **COMEX explicado** que encabeza la nota: `{ "what": "Qué pasó", "why": "Por qué importa", "who": "A quién afecta", "products": ["…"], "next": "Qué puede pasar ahora", "nextSource": { "name", "url" } }`. `next` solo se completa si una fuente lo dice (plazos, entradas en vigor, proyecciones atribuidas); nunca con predicciones propias.

### Secciones

Las secciones se definen en `data/taxonomy.json`, agrupadas en cuatro bloques (Comercio mundial, Argentina, Logística y Mercados). Una nota entra en una sección por su categoría, país, etiqueta o por palabras clave (`match`), así que las secciones nuevas se llenan solas con las notas existentes. Cada sección tiene su página en `/seccion/<slug>/`, que se indexa en buscadores cuando reúne al menos `minIndex` notas.

Las siglas y los términos técnicos de las notas curadas se explican solos con el glosario (`GLOSSARY` en `assets/app.js`, página `#glosario`).

## Criterios

- No se inventan noticias: cada nota automática es un enlace atribuido a su fuente, con la fecha que informa la fuente (o la de la primera vez que se vio, si no la informa).
- Las notas automáticas llevan `noindex` y no van al sitemap, porque solo resumen y enlazan contenido ajeno; indexarlas en masa puede perjudicar al sitio en Google. Para cambiarlo, poné `INDEX_AUTOMATIC = True` en `scripts/build_pages.py` y `indexAutomatic: true` en `assets/app.js`.
- Las imágenes de las fuentes se muestran enlazadas a su servidor (no se copian), con crédito y link a la nota original. Si una fuente lo objeta, desactivalas con `use_source_images: false`.

## Ver el sitio en tu computadora

Abrí `index.html` con doble clic (funciona incluso sin descomprimir el zip, porque la portada lleva el diseño embebido). Se ve la portada con las últimas 40 notas, y las notas se abren dentro de la misma página.

Para verlo exactamente como quedará publicado (con una dirección propia por nota), desde esta carpeta:

```
python3 scripts/build_pages.py
python3 -m http.server 8000
```

y abrí http://localhost:8000. En vistas previas sin acceso a Internet (por ejemplo, al abrir el zip en un chat), las fotos externas no cargan y se ve un recuadro azul con la categoría: es el respaldo previsto, no un error.
