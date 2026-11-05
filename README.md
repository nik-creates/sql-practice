# SQL Practice

A phpMyAdmin-style web app for practising SQL on **PostgreSQL** and **MySQL**.

**Live:** https://sql-practice-in28.onrender.com

**Custom domain (planned):** https://practisesql.iamnikhil.dev, behind the Cloudflare proxy. See [Custom domain and Cloudflare](#custom-domain-and-cloudflare).

> Hosted on Render's free tier. After 15 idle minutes the service sleeps and the first load takes up to a minute. MySQL data and query history reset on every restart, so use Export to save your tables to disk and Import to bring them back. Login is single-user; the credentials are not in this repo.

## Features
- Browse, Structure, SQL, Export, Import and History tabs, with a table tree like phpMyAdmin
- Switch between PostgreSQL and MySQL from the server dropdown
- SQL editor with syntax highlighting for each dialect. Run with Go or Ctrl/Cmd+Enter
- **Save to disk and restore:** export the whole database or one table or view as a .zip, import it again later. Tables, data, views and triggers are all kept
- Persistent query history, stored in a MySQL table, covering both engines
- One-click sample data (`employees`, `departments`)
- Settings (gear icon): light, dark or system theme, interface and code fonts, font sizes, editor height, line numbers, line wrap, table density, striped rows. Saved in the browser
- Login protected by Cloudflare Turnstile (human check), checked on the server
- Safety limits: 10 s query timeout, 1000 rows displayed, rate limits (120 requests per minute per visitor on `/api`, 20 login attempts per 15 minutes)

## Save and restore your work
The free host wipes MySQL on restart, so keep your work on your own disk.

**Export tab** downloads a .zip containing:
- `dump.sql`: tables (structure and data), views and triggers. Restores them exactly
- `csv/<table>.csv`: one CSV per table, opens in Excel (empty cell = NULL)

Export the whole database, or pick one table (it brings its own triggers) or one view.

**Import tab** accepts:
- a `.zip` made by Export (restores from `dump.sql`)
- a `.sql` dump
- a `.csv` (file name becomes the table name, column types are guessed)

### What is saved
| Object | PostgreSQL | MySQL |
| --- | --- | --- |
| Tables, columns, defaults, keys, indexes | yes | yes |
| Data | yes | yes |
| Auto-increment / serial / identity | yes (sequence reset after load) | yes |
| Foreign keys | yes (added last) | yes |
| Views | yes (dependency order) | yes (dependency order) |
| Triggers | yes, with the functions they call | yes (`DEFINER` removed so any user can restore) |
| Other functions, procedures, events, grants | no | no |
| Materialized views | no | n/a |

Triggers are created after the data is loaded, so they do not fire during a restore.

Rules: tables and views with the same names are replaced. A dump only imports into the engine it came from. Max 10 MB per upload and 100,000 rows per table. A failed PostgreSQL import changes nothing (it runs as one transaction). Restoring a single table that other tables or views depend on fails with a clear error instead of dropping them.

## Stack
| Part | Tech |
| --- | --- |
| Frontend | React 18, Vite, CodeMirror 6 |
| Backend | Node 22, Express, `pg`, `mysql2`, `fflate` (zip), JWT, bcrypt |
| Databases | PostgreSQL 16 (Render), MySQL 8.4 (Docker, in the same container) |
| Hosting | Render free web service (Docker) |

## How the engines work
PostgreSQL and MySQL are independent adapters in `server/src/db.js`. Each turns on only when its own env vars are set, and one failing never affects the other. When the free Render Postgres expires, the app keeps running on MySQL.

Query history is stored only in MySQL, in the table `_sp_history`, which is hidden from the table list and never exported. Without MySQL, history is empty.

## Run locally
Requires Node 20+ and at least one database.

```bash
git clone https://github.com/nik-creates/sql-practice.git
cd sql-practice
npm run build                      # installs deps and builds the client

# make a password hash (run from server/ after install)
cd server && node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD',10))" && cd ..

export APP_USER=me APP_PASS_HASH='<hash>' JWT_SECRET=$(openssl rand -hex 24)
# Turnstile is skipped locally (NODE_ENV is not production and TURNSTILE_SECRET is unset)
export DATABASE_URL=postgres://user:pass@localhost:5432/sqlpractice   # enables PostgreSQL
export MYSQL_URL=mysql://user:pass@localhost:3306/practice             # enables MySQL
export PG_SSL=false MYSQL_SSL=false                                    # local DBs without TLS
npm start                          # http://localhost:3000
```

For development run `npm run dev:server` and `npm run dev:client` in two terminals. Vite proxies `/api` to port 3000.

## Environment variables
| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_USER`, `APP_PASS_HASH` | yes | The single login. Hash is bcrypt. Login fails closed if unset |
| `JWT_SECRET` | yes | Signs session tokens (7 days) |
| `DATABASE_URL` | for PostgreSQL | Practice data lives in schema `practice` |
| `PRACTICE_PG_URL` | no | Separate Postgres for practice queries |
| `MYSQL_URL` | for MySQL | Or use `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| `PG_SSL`, `MYSQL_SSL` | no | Set `false` for local databases |
| `TURNSTILE_SECRET` | in production | Turnstile secret key. With `NODE_ENV=production` and no secret, every login is refused (fails closed). Not production and unset: the check is skipped |
| `VITE_TURNSTILE_SITE_KEY` | in production | Turnstile site key (public). Read at **client build time**, so changing it needs a rebuild. Unset: the widget is not shown |
| `NODE_ENV` | no | Set to `production` in the Docker image and `render.yaml`. Anything else counts as local development |
| `PORT` | no | Defaults to 3000 (10000 in the Docker image) |

## API
All routes except `/api/health` and `/api/login` need `Authorization: Bearer <token>`. Every route except `/api/health` is rate limited (429 with a JSON `error`).

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `POST /api/login` | `{username, password, turnstileToken}` returns `{token}` |
| `GET /api/engines` | Which engines are configured |
| `GET /api/schema?engine=` | Tables and views with their columns (`kind` is `table` or `view`) |
| `POST /api/query` | `{engine, sql}` runs a query and logs it |
| `POST /api/sample` | Creates the sample tables |
| `GET /api/export?engine=&table=` | Downloads a .zip. Leave `table` out for the whole database; `table` can be a table or a view |
| `POST /api/import?engine=&name=` | Raw file body (.zip, .sql or .csv) |
| `GET` / `DELETE /api/history` | List or clear history |

## Deploy on Render
The `Dockerfile` builds one image containing the app and the official `mysql:8.4`. `render.yaml` describes the web service and a Postgres database.

1. Push the repo to GitHub (public, or give Render access).
2. Create the Postgres and a Docker web service from the repo, or use New > Blueprint.
3. Set `APP_USER`, `APP_PASS_HASH`, `JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` and `DATABASE_URL` (the Postgres internal URL).
4. Set `NODE_ENV=production` (the image already does), `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`. **Set both Turnstile values before deploying this version**, otherwise login is refused. The `Dockerfile` declares `ARG VITE_TURNSTILE_SITE_KEY`, which Render fills from the service env var at build time.

## Custom domain and Cloudflare
Target: `practisesql.iamnikhil.dev` in front of the Render service, proxied by Cloudflare.

1. Render: add the custom domain `practisesql.iamnikhil.dev` to the service.
2. Cloudflare DNS: `CNAME practisesql` pointing to `sql-practice-in28.onrender.com`, **proxied** (orange cloud).
3. Cloudflare SSL/TLS mode: **Full (strict)**.
4. Cloudflare Security: turn on Bot Fight Mode and AI bot blocking.
5. Cloudflare WAF: add a rate limiting rule for paths starting with `/api/`.
6. Cloudflare Turnstile: create a widget for `practisesql.iamnikhil.dev`. Put the site key in `VITE_TURNSTILE_SITE_KEY` and the secret in `TURNSTILE_SECRET` on Render, then redeploy.

## Free-tier limits
- MySQL has no disk on a free web service. Data and history are lost on restart, redeploy and sleep. Export before you leave.
- 512 MB RAM is shared by Node and MySQL. MySQL is tuned small (64 MB buffer pool).
- Free Render Postgres expires 30 days after creation.
- For persistent MySQL, point `MYSQL_URL` at an external MySQL.

## Security notes
Meant for one trusted user. Queries and imports run with full rights inside the configured databases, and Postgres queries can reach other schemas. Use `PRACTICE_PG_URL` for isolation.

- **Turnstile on login.** The browser gets a one-time token from the widget and sends it with the login request. The server checks it with Cloudflare (`siteverify`, with the visitor IP) before it looks at the password. A failed check, a Cloudflare timeout or a missing token all refuse the login. In production a missing `TURNSTILE_SECRET` refuses every login.
- **Rate limits.** `/api` allows 120 requests per minute per visitor (not counting `/api/health`), and login allows 20 attempts per 15 minutes. Visitors are told apart by the `CF-Connecting-IP` header, falling back to `req.ip`.
- **Trust in `CF-Connecting-IP`.** The header is only honest when the request really came through Cloudflare. The original `sql-practice-in28.onrender.com` address stays reachable and bypasses Cloudflare, so a client hitting it directly can fake the header and dodge the limits (the Turnstile check and the password still apply). To close this, block direct access, for example with a Cloudflare origin secret header that the app requires.
- Secrets (`TURNSTILE_SECRET`, `APP_PASS_HASH`, `JWT_SECRET`) live only in the host's env vars. The Turnstile site key is public by design.

## More
See [CONTEXT.md](CONTEXT.md) for design decisions, deployment details and known issues.
