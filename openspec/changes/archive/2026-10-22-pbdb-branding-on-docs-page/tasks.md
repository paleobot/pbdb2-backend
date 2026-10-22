## 1. Assets

- [x] 1.1 Fetch `https://paleobiodb.org/data1.2/images/logo_white.png` to `api/assets/pbdb-logo-white.png` and `https://paleobiodb.org/favicon.ico` to `api/assets/pbdb-favicon.ico`; check they are a 400×400 PNG and a 4-size `.ico`

## 2. Viewer

- [x] 2.1 In `api/src/plugins/openapi.js`, read both files and pass `logo` and `theme` (`title: node.name`, the favicon, the CSS: teal bar in light and dark mode, explore bar hidden, toggle at the right, 80px logo, teal in place of green) to `@fastify/swagger-ui` (design D2); note the assets' source in the module comment
- [x] 2.2 Extend the viewer test in `api/test/openapi.test.js`: title `PBDB2 API`, the favicon link is served as `image/x-icon` and the default favicon links are gone, the initializer carries the logo (design D3)
- [x] 2.3 Run `npm test` in `api/`; open `/api/v1/docs` in a browser and check the bar, logo and tab, with no explore bar, in light and dark mode

## 3. Backlog

- [x] 3.1 Reword "Docs page branding" in `docs/api-design-backlog.md`: Classic's branding is in place as a placeholder (this change); still open for PBDB2's own identity
