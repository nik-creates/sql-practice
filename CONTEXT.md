# Project context

Everything needed to understand, run and continue this project. Secrets are not stored here.

## What it is
A personal SQL practice website. The owner wants to write queries against PostgreSQL and MySQL from a phpMyAdmin-like web UI, with persistent history, deployed free.

- Live: https://sql-practice-in28.onrender.com
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

## Architecture
```
Browser (React SPA)
   |  /api/*  (Bearer JWT)
Express (server/src/index.js)
   |-- auth.js      login check, JWT sign/verify
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
- `server/src/sample.js`: `employees` and `departments`
- `client/src/App.jsx`: phpMyAdmin-style workspace (tree, tabs, editor, results)
- `client/src/Transfer.jsx`: Export and Import tabs
- `client/src/Settings.jsx`, `client/src/settings.js`: settings modal and persistence
- `client/src/api.js`: fetch helpers, including file download and upload
- `client/src/styles.css`: light and dark themes through CSS variables
- `Dockerfile`, `docker-start.sh`: image with Node and MySQL
- `render.yaml`: Render blueprint (reference; services were created through the API)

### Behaviours worth knowing
- An engine is enabled only if its env vars exist. `/api/engines` reports which.
- Postgres practice data uses schema `practice` (`search_path`), created on first use.
- MySQL uses the database from `MYSQL_DATABASE` (`practice` in the image).
- History table is created lazily with retry, because MySQL starts after Node in the container.
- If MySQL is missing or down, history returns empty instead of erroring.
- The settings (theme, fonts, sizes) and the engine and query draft live in browser localStorage.
- DATE values are shown as plain `YYYY-MM-DD` on both engines (`dateStrings` for MySQL, a type parser for Postgres).

### Export and import details
- Whole-database export drops tables with `CASCADE` on restore; a single-table export does not, so restoring a table that other tables reference fails with a clear error.
- Postgres dump rebuilds columns, defaults, serial and identity columns (sequences are reset after the data load), generated columns, primary, unique and check constraints, indexes, and foreign keys (added last so order does not matter).
- MySQL dump uses `SHOW CREATE TABLE`, with `FOREIGN_KEY_CHECKS` off during restore.
- Dumps start with `-- engine: postgres|mysql`. Importing into the other engine is refused with a clear message.
- Limits: 10 MB upload, 50 MB unpacked, 100,000 rows per table. Views, triggers and routines are not exported.
- CSV import: header row required, empty cell becomes NULL, types guessed (INTEGER, BIGINT, DOUBLE, DATE, else TEXT or VARCHAR), values with leading zeros stay text.

## Deployment (Render, workspace "My Workspace", region Oregon)
- Web service `sql-practice`, Docker runtime, free plan, branch `main`.
- Postgres `sqlpractice-db`, free plan, **expires 2026-12-04** (14-day grace, then deleted).
- Env vars on the service: `APP_USER`, `APP_PASS_HASH`, `JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `DATABASE_URL`. Values are in Render, not in the repo.
- Auto-deploy is set to on commit, but a push on 2026-11-05 did not trigger a deploy. A manual deploy was needed. Check the Render dashboard after pushing.
- The login username is `nks01x`. The password is set in Render as a bcrypt hash.

## Free-tier limits
- Service sleeps after 15 idle minutes. First request after sleep is slow.
- No disk on free web services: MySQL data and history are wiped on restart, redeploy and sleep. This is why Export and Import exist.
- 512 MB RAM for Node and MySQL together. MySQL is tuned small in `docker-start.sh`.
- Free Postgres expires after 30 days.
- To make MySQL persistent: use an external MySQL (`MYSQL_URL`) or a paid Render service with a disk.

## Verification status
- Tested locally against PostgreSQL: login, bad login, auth required, sample data, joins, errors, schema, no-database start, dead-Postgres start.
- Tested locally against PostgreSQL: export then drop everything then import gives an identical second export (tables with serial, identity-style defaults, jsonb, bytea, timestamptz, booleans, NULLs, quotes, newlines, unicode, unique, check, index and foreign key). Single-table and SQL-file import, CSV import with type guessing, CSV-only zip, wrong-engine and bad-file errors, and rollback on a failing import all behaved correctly.
- Tested locally in a browser: login, settings modal, dark theme, font change, Export download, Import of that file, and an invalid file error.
- **Not tested locally:** anything MySQL (queries, `_sp_history`, export, import), because no MySQL was available in the build sandbox. The Docker image was never built locally. Render built and started it, and the logs showed MySQL ready and the app listening, but nobody has yet confirmed MySQL queries, History, Export and Import in the live UI.

## Known issues and ideas
- Confirm MySQL queries, History, Export and Import on the live site.
- Free Postgres expires 2026-12-04. Then only MySQL works. Create a new free Postgres or use an external one and update `DATABASE_URL`.
- Practice queries and imports have full rights inside the practice databases. Fine for one user.
- Possible next steps: persistent external MySQL, saved queries, problem sets with auto-checking answers, scheduled auto-export.

## Working preferences of the owner
- Short, direct replies. Ask clarifying questions instead of assuming.
- Wants the reasoning behind decisions before committing to them.
