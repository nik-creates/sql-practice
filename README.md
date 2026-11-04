# SQL Practice

A phpMyAdmin-style web app for practising SQL on **PostgreSQL** and **MySQL**.

**Live:** https://sql-practice-in28.onrender.com

> Hosted on Render's free tier. After 15 idle minutes the service sleeps and the first load takes up to a minute. MySQL data and query history reset on every restart. Login is single-user; the credentials are not in this repo.

## Features
- Browse, Structure, SQL and History tabs, with a table tree like phpMyAdmin
- Switch between PostgreSQL and MySQL from the server dropdown
- SQL editor with syntax highlighting for each dialect. Run with Go or Ctrl/Cmd+Enter
- Persistent query history, stored in a MySQL table, covering both engines
- One-click sample data (`employees`, `departments`)
- Settings (gear icon): light, dark or system theme, interface and code fonts, font sizes, editor height, line numbers, line wrap, table density, striped rows. Saved in the browser
- Safety limits: 10 s query timeout, 1000 rows displayed, login rate limit

## Stack
| Part | Tech |
| --- | --- |
| Frontend | React 18, Vite, CodeMirror 6 |
| Backend | Node 22, Express, `pg`, `mysql2`, JWT, bcrypt |
| Databases | PostgreSQL 16 (Render), MySQL 8.4 (Docker, in the same container) |
| Hosting | Render free web service (Docker) |

## How the engines work
PostgreSQL and MySQL are independent adapters in `server/src/db.js`. Each turns on only when its own env vars are set, and one failing never affects the other. When the free Render Postgres expires, the app keeps running on MySQL.

Query history is stored only in MySQL, in the table `_sp_history`, which is hidden from the table list. Without MySQL, history is empty.

## Run locally
Requires Node 20+ and at least one database.

```bash
git clone https://github.com/nik-creates/sql-practice.git
cd sql-practice
npm run build                      # installs deps and builds the client

# make a password hash (run from server/ after install)
cd server && node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD',10))" && cd ..

export APP_USER=me APP_PASS_HASH='<hash>' JWT_SECRET=$(openssl rand -hex 24)
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
| `PORT` | no | Defaults to 3000 (10000 in the Docker image) |

## API
All routes except `/api/health` and `/api/login` need `Authorization: Bearer <token>`.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `POST /api/login` | `{username, password}` returns `{token}` |
| `GET /api/engines` | Which engines are configured |
| `GET /api/schema?engine=` | Tables and columns |
| `POST /api/query` | `{engine, sql}` runs a query and logs it |
| `POST /api/sample` | Creates the sample tables |
| `GET` / `DELETE /api/history` | List or clear history |

## Deploy on Render
The `Dockerfile` builds one image containing the app and the official `mysql:8.4`. `render.yaml` describes the web service and a Postgres database.

1. Push the repo to GitHub (public, or give Render access).
2. Create the Postgres and a Docker web service from the repo, or use New > Blueprint.
3. Set `APP_USER`, `APP_PASS_HASH`, `JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` and `DATABASE_URL` (the Postgres internal URL).

## Free-tier limits
- MySQL has no disk on a free web service. Data and history are lost on restart, redeploy and sleep.
- 512 MB RAM is shared by Node and MySQL. MySQL is tuned small (64 MB buffer pool).
- Free Render Postgres expires 30 days after creation.
- For persistent MySQL, point `MYSQL_URL` at an external MySQL.

## Security notes
Meant for one trusted user. Queries run with full rights inside the configured databases, and Postgres queries can reach other schemas. Use `PRACTICE_PG_URL` for isolation.

## More
See [CONTEXT.md](CONTEXT.md) for design decisions, deployment details and known issues.
