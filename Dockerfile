# One container: Node app + MySQL 8.4 (official image). Built for Render free web service.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm --prefix server install --omit=dev && npm --prefix client install
COPY server server
COPY client client
RUN npm --prefix client run build

FROM mysql:8.4
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app/server server
COPY --from=build /app/client/dist client/dist
COPY docker-start.sh /usr/local/bin/docker-start.sh
RUN chmod +x /usr/local/bin/docker-start.sh
ENV MYSQL_DATABASE=practice \
    MYSQL_USER=app \
    MYSQL_HOST=127.0.0.1 \
    MYSQL_PORT=3306 \
    MYSQL_SSL=false \
    PORT=10000
EXPOSE 10000
ENTRYPOINT ["docker-start.sh"]
