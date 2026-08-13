# Сборка идёт в образе с Node, а наружу выходит только статика: итоговый
# образ не содержит ни Node, ни исходников, ни node_modules — то есть ни
# одного из тех гигабайт, которые нужны ровно один раз.

# Манифесты копируются отдельно от кода: слой с зависимостями пересобирается
# только при их изменении, а не на каждую правку компонента. Отдельная стадия
# нужна ещё и потому, что на неё опирается dev: там npm ci уже сделан, а
# `npm run build` — нет, и dev-серверу нечего ждать.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Стадия разработки: тот же Vite, что и при `npm run dev` на хосте, только
# внутри контейнера — чтобы для правки интерфейса не требовалось ставить Node
# локально. Собирается только по `target: dev` из docker-compose.dev.yml.
FROM deps AS dev
COPY frontend/ ./
EXPOSE 8080
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]

FROM deps AS build
COPY frontend/ ./
RUN npm run build

# Последняя стадия — та, что собирается по умолчанию, без указания target.
FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS runtime
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
# Не root: Caddy слушает 8080 (непривилегированный) и пишет только в свои
# каталоги данных — им и отдаётся владелец. adduser -S — системный
# пользователь без пароля и домашнего каталога.
RUN adduser -S -u 10001 web && chown -R web /data /config
USER web
