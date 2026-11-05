# Project context

Everything needed to understand, run and continue this project. Secrets are not stored here.

## What it is
A personal SQL practice website. The owner wants to write queries against PostgreSQL and MySQL from a phpMyAdmin-like web UI, with persistent history, deployed free.

- Live: https://sql-practice-in28.onrender.com
- Planned custom domain: https://practisesql.iamnikhil.dev (behind Cloudflare proxy; setup status below)
- Repo: https://github.com/nik-creates/sql-practice (public)
- Built in a Claude session on 2026-11-04 and 2026-11-05

## Requirements given by the owner
1. Website for SQL practice with a UI and a persistent database.
2. PostgreSQL and MySQL as query engines.
3. React frontend, JavaScript or TypeScript backend (JavaScript chosen as easier).
4. Deploy on Render or Cloudflare (Render chosen).
5. Code pushed to GitHub using the GITHUB tool.
6. Features wanted: free query playground, query history. Login only for one user.
7. UI should look like the phpMyAdmin web version.
8. MySQL should run from a Docker image, for free, on Render.
9. Engines kept separate. History stored in its own MySQL table. Keep the design open to other engines.
10. UX settings: font changer and more (all options were added).
11. Save tables to the disk, upload them back later, and download again. Whole database and single table. Any format that works; a zip was chosen.
12. Views and triggers must be saved and restored too (both).
13. Harden the public site: global API rate limiter keyed on `CF-Connecting-IP`, Cloudflare Turnstile on login, custom domain `practisesql.iamnikhil.dev` behind Cloudflare (DNS, Full strict SSL, Bot Fight Mode, AI bot blocking, WAF rate rule for `/api/*`).
14. Turnstile is skipped in local development (`NODE_ENV` not production) and fails closed in production when `TURNSTILE_SECRET` is unset (owner's choice).

## Decisions and why
| Decision | Reason |
| --- | --- |
| Express (JS) backend, no TypeScript | Owner left it open. Fewer build steps |
| One Docker image with Node and `mysql:8.4` | Render has no managed MySQL, and free web services cannot reach a private-service MySQL (private services are paid) |
| MySQL runs inside the web service container | Only free way to run Docker MySQL on Render |
| Render Postgres (free) for PostgreSQL | Managed, no Docker needed |
| History in MySQL table `_sp_history` | Owner request. Postgres free tier expires in 30 days, so the app must not depend on it |
| Engines as adapters in `db.js` | Independent failure, easy to add another engine |
| CodeMirror 6 with per-dialect SQL mode | Light, good highlighting |
| Single user from env vars, bcrypt hash, JWT | Owner wanted only their login. No user table needed |
| Repo made public | Render could not read the private repo (no GitHub access granted). No secrets are committed |
| CSS variables for theme and fonts | Settings change live without rebuilding anything |
| Export as one zip: `dump.sql` plus `csv/` | The SQL dump restores structure and data exactly; the CSVs open in Excel. One file keeps it simple, and it covers both whole database and single table |
| Import takes .zip, .sql or .csv | Zip restores from `dump.sql`; a bare CSV creates a table with guessed types |
| Postgres data exported as `::text` | Values restore exactly (dates, jsonb, bytea, booleans) with no timezone or float drift |
| Postgres import runs as one multi-statement query | One implicit transaction, so a failed import changes nothing |
| Triggers and their functions are created last in the dump | Triggers must not fire while data is restored |
| Global limiter on `/api` before auth: 120 per minute per visitor, `/api/health` excluded | Slows scraping and brute force on every route. The numbers were chosen by the assistant (not specified) and sit in `server/src/index.js` |
| Rate limit key is `CF-Connecting-IP`, falling back to `req.ip` | Behind Cloudflare `req.ip` is the Cloudflare edge, which would put all visitors in one bucket. Caveat: spoofable if the Render URL is hit directly |
| Turnstile is verified before the password check, and the token is sent in the login body | Cheap bot filtering first, no bcrypt work for bots. Tokens are single use, so the widget is reset after a failed login |
| Turnstile skipped only when `NODE_ENV` is not production and the secret is unset | Local dev works without keys; production fails closed. `NODE_ENV=production` is set in the `Dockerfile` and `render.yaml` so Render never falls into the skip |
| Site key through `VITE_TURNSTILE_SITE_KEY` (`ARG` in the `Dockerfile`) | Vite bakes it into the client at build time. It is public, so a build arg is fine |
| MySQL `DEFINER` and `` `db`. `` prefixes are removed from views and triggers | The importing user (`app`) lacks the privilege to set another definer, and the database name may differ between servers |

## Architecture
```
Browser (React SPA)
   |  /api/*  (Bearer JWT)
Express (server/src/index.js)
   |-- auth.js      login check, JWT sign/verify
   |-- turnstile.js Cloudflare Turnstile token verification for login
   |-- db.js        adapters: postgres (pg), mysql (mysql2); history in MySQL
   |-- transfer.js  zip export, zip/sql/csv import
   |-- sample.js    sample tables, valid on both engines
   `-- serves client/dist in production

Render container:  docker-start.sh -> mysqld (background) + node server
Render Postgres:   schema `practice` for practice data
```

### File map
- `server/src/index.js`: routes, middleware, static hosting
- `server/src/db.js`: engine adapters, query shaping (1000-row cap, 10 s timeout), history
- `server/src/transfer.js`: export to zip, import from zip/sql/csv
- `server/src/auth.js`: credentials check (timing-safe), JWT
- `server/src/turnstile.js`: Turnstile `siteverify` call (5 s timeout, fail closed)
- `server/src/sample.js`: `employees` and `departments`
- `client/src/App.jsx`: phpMyAdmin-style workspace (tree, tabs, editor, results)
- `client/src/Transfer.jsx`: Export and Import tabs
- `client/src/Settings.jsx`, `client/src/settings.js`: settings modal and persistence
- `client/src/Login.jsx`: login form with the Turnstile widget (explicit render, reset after a failed login)
- `client/src/api.js`: fetch helpers, including file download, upload and `login()`
- `client/src/styles.css`: light and dark themes through CSS variables
- `Dockerfile`, `docker-start.sh`: image with Node and MySQL
- `render.yaml`: Render blueprint (reference; services were created through the API)

### Behaviours worth knowing
- Order on `/api`: health, global limiter, login (login limiter, Turnstile, password), then `requireAuth` for everything else. Limiter responses are JSON (`{error}`, status 429).
- Login without `VITE_TURNSTILE_SITE_KEY` shows no widget and does not wait for a token; the server decides (skip locally, refuse in production).
- An engine is enabled only if its env vars exist. `/api/engines` reports which.
- Postgres practice data uses schema `practice` (`search_path`), created on first use.
- MySQL uses the database from `MYSQL_DATABASE` (`practice` in the image).
- History table is created lazily with retry, because MySQL starts after Node in the container.
- If MySQL is missing or down, history returns empty instead of erroring.
- The settings (theme, fonts, sizes) and the engine and query draft live in browser localStorage.
- DATE values are shown as plain `YYYY-MM-DD` on both engines (`dateStrings` for MySQL, a type parser for Postgres).
- `/api/schema` returns each object with `kind` (`table` or `view`). Views show in the tree with a different icon and are dropped with `DROP VIEW`.

### Export and import details
- Whole-database export drops tables and views with `CASCADE` on restore (Postgres); a single-table export does not, so restoring a table that other tables or views depend on fails with a clear error.
- Dump order: drop views (reverse dependency order), drop and create tables, load data, sequence resets and indexes, foreign keys, create views (dependency order), trigger functions, triggers.
- Postgres dump rebuilds columns, defaults, serial and identity columns, generated columns, primary, unique and check constraints, indexes and foreign keys. Views come from `pg_get_viewdef`, ordered with `pg_depend`. Triggers come from `pg_get_triggerdef`, and the functions they call from `pg_get_functiondef` (only functions in schema `practice`).
- MySQL dump uses `SHOW CREATE TABLE`, `SHOW CREATE VIEW` and `SHOW CREATE TRIGGER`, with `FOREIGN_KEY_CHECKS` off during restore. View order comes from `information_schema.view_table_usage`.
- A single table export includes that table's triggers. A single view export has the view definition and a CSV of its rows, and needs the underlying tables to exist when restored.
- Dumps start with `-- engine: postgres|mysql`. Importing into the other engine is refused with a clear message.
- Limits: 10 MB upload, 50 MB unpacked, 100,000 rows per table. Not exported: materialized views, functions other than trigger functions, procedures, events, grants.
- CSV import: header row required, empty cell becomes NULL, types guessed (INTEGER, BIGINT, DOUBLE, DATE, else TEXT or VARCHAR), values with leading zeros stay text.

## Deployment (Render, workspace "My Workspace", region Oregon)
- Web service `sql-practice`, Docker runtime, free plan, branch `main`.
- Postgres `sqlpractice-db`, free plan, **expires 2026-12-04** (14-day grace, then deleted).
- Env vars on the service: `APP_USER`, `APP_PASS_HASH`, `JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `DATABASE_URL`, plus `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` (needed from the Turnstile PR on). Values are in Render, not in the repo.
- **Deploy order:** set `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` on Render before the Turnstile PR is deployed. The image sets `NODE_ENV=production`, so without the secret every login is refused.
- Auto-deploy is set to on commit, but pushes did not trigger a deploy. A manual deploy was needed each time. Check the Render dashboard after pushing.
- The login username is `nks01x`. The password is set in Render as a bcrypt hash.

### Custom domain and Cloudflare (owner's checklist, status: not done by the assistant)
The assistant had no tool for Render custom domains or the Cloudflare dashboard, so these steps are for the owner:
1. Render: add custom domain `practisesql.iamnikhil.dev` to `sql-practice`.
2. Cloudflare DNS: `CNAME practisesql` to `sql-practice-in28.onrender.com`, proxied.
3. Cloudflare SSL/TLS: Full (strict).
4. Cloudflare: Bot Fight Mode on, AI bot blocking on, WAF rate limiting rule for `/api/*`.
5. Cloudflare Turnstile: widget for `practisesql.iamnikhil.dev`; site key to `VITE_TURNSTILE_SITE_KEY`, secret to `TURNSTILE_SECRET` on Render; redeploy (the site key is baked in at build time).
6. Optional hardening: make the app accept requests only through Cloudflare (origin secret header), so the `onrender.com` address cannot be used to spoof `CF-Connecting-IP`.

## Free-tier limits
- Service sleeps after 15 idle minutes. First request after sleep is slow.
- No disk on free web services: MySQL data and history are wiped on restart, redeploy and sleep. This is why Export and Import exist.
- 512 MB RAM for Node and MySQL together. MySQL is tuned small in `docker-start.sh`.
- Free Postgres expires after 30 days.
- To make MySQL persistent: use an external MySQL (`MYSQL_URL`) or a paid Render service with a disk.

## Verification status
- Tested locally against PostgreSQL: login, bad login, auth required, sample data, joins, errors, schema, no-database start, dead-Postgres start.
- Tested locally against PostgreSQL: export, drop everything, import gives an identical second export. Covered serial columns, jsonb, bytea, timestamptz, booleans, NULLs, quotes, newlines, unicode, unique, check, index, foreign keys, two views where one uses the other, and a trigger with its function. After restore the views worked, the trigger did not fire during the data load and did fire on later updates. Single-table export carried its trigger, a single view exported and restored, and restoring a table that a view depends on failed cleanly. Also SQL-file import, CSV import with type guessing, CSV-only zip, wrong-engine and bad-file errors, and rollback on a failing import.
- Unit-tested: view dependency ordering (chain, diamond, cycle) and the MySQL `DEFINER` and database-prefix cleanup.
- Tested locally in a browser: login, settings modal, dark theme, font change, Export download, Import of that file, and an invalid file error.
- Tested locally for the Turnstile and rate-limit change (Cloudflare's `siteverify` was faked, because the sandbox cannot reach Cloudflare): production without secret refuses login (503); dev without secret skips and logs a warning; with a secret, missing token and bad token are refused (400), good token with wrong password gives 401, good token with right password gives a JWT, and `siteverify` receives the secret, token and the `CF-Connecting-IP` value as `remoteip`. Global limiter returned 429 (JSON) after 120 requests from one IP, `/api/health` stayed open, and another IP was not affected. Login limiter returned 429 after 20 attempts. Browser test with a fake widget: button disabled until a token exists, token sent in the login body, widget reset and button disabled again after a failed login. **Not tested:** the real Turnstile widget and the real `siteverify` call, the Docker build argument on Render, and Cloudflare in front of the app.
- **Not tested:** anything MySQL (queries, `_sp_history`, export, import, MySQL views and triggers), because no MySQL was available in the build sandbox. The Docker image was never built locally. Render built and started it, and the logs showed MySQL ready and the app listening, but nobody has yet confirmed MySQL behaviour in the live UI.

## Known issues and ideas
- The rate limits can be bypassed by calling the `onrender.com` address directly with a fake `CF-Connecting-IP`. See the optional hardening step above.
- Confirm MySQL queries, History, Export and Import (including views and triggers) on the live site.
- Free Postgres expires 2026-12-04. Then only MySQL works. Create a new free Postgres or use an external one and update `DATABASE_URL`.
- Practice queries and imports have full rights inside the practice databases. Fine for one user.
- Possible next steps: persistent external MySQL, saved queries, problem sets with auto-checking answers, scheduled auto-export, listing triggers in the Structure view.

## Working preferences of the owner
- Short, direct replies. Ask clarifying questions instead of assuming.
- Wants the reasoning behind decisions before committing to them.
