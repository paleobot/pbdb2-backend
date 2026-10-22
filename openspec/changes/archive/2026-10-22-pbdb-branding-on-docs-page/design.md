## Context

`api/src/plugins/openapi.js` registers `@fastify/swagger-ui` (6.1.2) with only `routePrefix`, so
the page at `/api/v1/docs` gets the plugin's defaults: the title "Swagger UI", Fastify's
`favicon-16x16.png` / `favicon-32x32.png`, and Fastify's `logo.svg` swapped into Swagger UI's
near-black top bar. The plugin exposes `logo` and `theme` options for all of these.

Classic's data service docs (`https://paleobiodb.org/data1.2/`, fetched 2026-10-22) provide:

| Asset | Source | Form |
|---|---|---|
| Logo | `/data1.2/images/logo_white.png` | 400×400 PNG, 19,704 bytes, white emblem on transparent |
| Favicon | `/favicon.ico` (site root; none under `/data1.2/`) | `.ico`, 32,988 bytes, 16/24/32/64 px, black emblem on transparent |
| Bar colour | `.banner { background-color: #00A0A0 }` in `/data1.2/css/dsdoc.css` | teal |

Use is approved; it is a stopgap until PBDB2 has its own identity.

## Goals / Non-Goals

**Goals:** the docs page reads as PBDB's: tab title, favicon, top-bar logo and colour.

**Non-Goals:** PBDB2's own visual identity; restyling the rest of Swagger UI; a text title in the
top bar beside the logo (data1.2 has one; Swagger UI's bar holds only the logo link, and the tab
title covers it); a favicon that reads on dark tab strips (Classic's own has the same limit).

## Decisions

**D1. Commit the files; don't fetch them.** Copies live in `api/assets/` as
`pbdb-logo-white.png` and `pbdb-favicon.ico`, read with `readFile` when the plugin registers. A
runtime fetch would tie our startup to paleobiodb.org and change under us. Their source URLs and
fetch date are recorded here and in `openapi.js`'s comment; `api/assets/` holds only these two
files, so no README. (The `api/` workspace has no `files` list in `package.json`, so nothing more is
needed for them to ship.)

**D2. Plugin options, not a custom page.**
- `logo: { type: 'image/png', content }`. The plugin inlines it as a data URI into its initializer
  and sets `img.height = 40`, which suits a square emblem. No `href`: the plugin's default points the
  logo at the docs root, which is where it should go.
- `theme.title: node.name` (`PBDB2 API`), the same name the version index and the OpenAPI `info`
  use, so the three cannot drift.
- `theme.favicon: [{ filename: 'favicon.ico', rel: 'icon', type: 'image/x-icon', sizes: '16x16
  24x24 32x32 64x64', content }]`. Setting any favicon drops the plugin's two default `<link>`s.
- `theme.css: [{ filename: 'theme.css', content }]` with these rules:
  - `.swagger-ui .topbar, html.dark-mode .swagger-ui .topbar { background: #00A0A0; }`. A white
    logo needs the teal bar, and the teal is the point anyway. Swagger UI has a dark-mode toggle in
    the bar, and its stylesheet greys the bar (`#2a2e30`) under `html.dark-mode`, which outranks
    `.swagger-ui .topbar` alone; naming that selector too keeps the bar teal in both modes.
  - `.swagger-ui .topbar .download-url-wrapper { display: none; }` hides the explore bar (URL
    input and green Explore button). It loads another API description into the viewer, which this
    page never needs, and its green clashes with the teal. The bar is left with the logo and the
    dark-mode toggle, close to data1.2's banner.
  - `.dark-mode-toggle { margin-left: auto; }` keeps the toggle at the bar's right edge. The hidden
    explore bar was what pushed it there (`margin-left: auto`); without it the toggle sits next
    to the logo.
  - `.topbar a img { height: 80px; }` overrides the plugin's `img.height = 40`, at which the
    emblem's detail is lost (data1.2 shows it at 7em, 112px). The bar grows with it.
  - Swagger UI's green becomes the teal where it shows on this page: the `OAS 3.1` version stamp
    (`#89bf04`; `#1d632e` in dark mode) and the response's Accept-header control (`green`). POST's
    green (`#49cc90`) and the Authorize button's are left alone: no POST route is documented and
    there is no security scheme, so neither appears, and the method colours are semantic.

**D3. Test what the plugin emits, not how it looks.** The viewer test checks that the HTML's
`<title>` is `PBDB2 API`, that its icon link resolves to a 200 `image/x-icon` and no
`favicon-32x32.png` link remains, and that `/api/v1/docs/static/swagger-initializer.js` carries the
logo's data URI. Colour, layout and the hidden explore bar are checked by eye, in light and dark
mode.

## Risks / Trade-offs

- **The plugin's injection is selector-based** (`#swagger-ui > section > div.topbar > div > div >
  a`); a Swagger UI upgrade that changes the bar's markup would silently bring back the stock logo.
  The test on the initializer would not catch that; checking by eye after an upgrade would.
- **Classic may change its branding.** Our copies would then be stale, which is acceptable for a
  stopgap.

## Migration Plan

None: a restart picks it up.
