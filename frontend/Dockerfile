# Сборка идёт в образе с Node, а наружу выходит только статика: итоговый
# образ не содержит ни Node, ни исходников, ни node_modules — то есть ни
# одного из тех гигабайт, которые нужны ровно один раз.
FROM node:22-alpine AS build

WORKDIR /app

# Манифесты копируются отдельно от кода: слой с зависимостями пересобирается
# только при их изменении, а не на каждую правку компонента.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine

COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
