# SQL Practice

phpMyAdmin-style web app for practising SQL on PostgreSQL and MySQL.
React (Vite) frontend, Node/Express backend, persistent query history.

## Features
- Single-user login (credentials from env vars, bcrypt hash)
- PostgreSQL and MySQL engines (MySQL appears once `MYSQL_URL` is set)
- Table tree, Browse / Structure / SQL / History tabs
- Persistent query history in Postgres (`app.query_history`)
- Practice data persists: Postgres schema `practice`, MySQL database from `MYSQL_URL`
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

## Deploy on Render
1. New > Blueprint, pick this repo (uses `render.yaml`: web service + Postgres).
2. Set env vars: `APP_USER`, `APP_PASS_HASH`, and optionally `MYSQL_URL`.
3. Render has no managed MySQL. Use any external MySQL and put its URL in `MYSQL_URL`.

## Notes
- Practice queries run with full rights inside the configured databases. This is meant for one trusted user.
- Postgres practice queries use `search_path=practice`, but can still reach other schemas. Use `PRACTICE_PG_URL` for a separate database if you want isolation.
