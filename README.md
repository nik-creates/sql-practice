# SQL Practice

phpMyAdmin-style web app for practising SQL on PostgreSQL and MySQL.
React (Vite) frontend, Node/Express backend, persistent query history.

## Features
- Single-user login (credentials from env vars, bcrypt hash)
- PostgreSQL and MySQL engines (MySQL appears once `MYSQL_URL` or `MYSQL_HOST` is set)
- Table tree, Browse / Structure / SQL / History tabs
- Persistent query history in Postgres (`app.query_history`)
- Practice data: Postgres schema `practice`, MySQL database `practice`
- "Load sample data" creates `employees` and `departments`
- 10 s query timeout, 1000-row display cap

## Run locally
```bash
cp .env.example .env        # fill values, export them in your shell
npm run build
npm start                   # http://localhost:3000
# dev: npm run dev:server  +  npm run dev:client
```

Make the password hash:
```bash
node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD',10))"
```
Run it from `server/` after `npm install`.

## Deploy on Render (free, Docker)
The `Dockerfile` builds one image: the Node app plus the official `mysql:8.4` image, so MySQL runs inside the same free web service.
1. New > Blueprint, pick this repo (uses `render.yaml`: Docker web service + Postgres).
2. Set env vars: `APP_USER`, `APP_PASS_HASH`. MySQL passwords are generated.

Free-tier caveats:
- MySQL data is wiped on every restart, redeploy and 15-minute spin-down (no disk on free web services). Use "Load sample data" to recreate tables.
- 512 MB RAM is tight for MySQL plus Node. MySQL is tuned low (64 MB buffer pool).
- Free Render Postgres expires after 30 days.
- To use an external MySQL instead, set `MYSQL_URL`.

## Notes
- Practice queries run with full rights inside the configured databases. This is meant for one trusted user.
- Postgres practice queries use `search_path=practice`, but can still reach other schemas. Use `PRACTICE_PG_URL` for a separate database if you want isolation.
