FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

# Окружение живёт вне /app намеренно. В режиме разработки поверх /app
# монтируется рабочая копия с хоста, и venv, лежащий внутри /app, оказался бы
# ею закрыт: контейнер стартовал бы без единой установленной зависимости и
# падал на первом же импорте. Снаружи каталога монтирование его не задевает.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Манифесты копируются отдельно от кода: слой с зависимостями пересобирается
# только при их изменении, а не на каждую правку модуля.
COPY pyproject.toml uv.lock ./

# Боевой образ не тащит pytest и httpx, но образ для разработки — тащит:
# иначе `docker compose exec api pytest` не с чем запускать, и тесты
# оказываются доступны только тому, у кого локально стоит Python нужной
# версии. Значение приходит из docker-compose.dev.yml.
ARG INSTALL_DEV=false
RUN if [ "$INSTALL_DEV" = "true" ]; then \
        uv sync --no-install-project; \
    else \
        uv sync --no-dev --no-install-project; \
    fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
