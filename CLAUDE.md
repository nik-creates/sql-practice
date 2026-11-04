# CLAUDE.md

Read [CONTEXT.md](CONTEXT.md) first. It holds the requirements, decisions, architecture, deployment details and known issues.

## Commands
- `npm run build`: install server and client deps, build the client into `client/dist`
- `npm start`: run the server, which also serves `client/dist`
- `npm run dev:server` / `npm run dev:client`: development (Vite proxies `/api` to port 3000)

## Rules for this repo
- Never commit secrets (passwords, `DATABASE_URL`, JWT secret). The repo is public.
- Keep PostgreSQL and MySQL independent. A failure in one engine must not stop the other or the app.
- History lives only in the MySQL table `_sp_history`. Do not move it to Postgres.
- New engines go in `server/src/db.js` as adapters with `query(sql)` and `schema()`.
- Theme and font settings use CSS variables in `client/src/styles.css`. Add a variable instead of hard-coding colors.
- The free Render tier wipes MySQL on restart. Do not promise persistence for MySQL data.
- After pushing, check the Render dashboard. Auto-deploy did not trigger once and needed a manual deploy.

## Style
- Plain JavaScript (ES modules) on the server, React with JSX on the client.
- Keep replies to the owner short and direct. Ask questions rather than assume.
