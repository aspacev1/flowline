# Flowline

Самостоятельно размещаемый планировщик проектов с диаграммой Ганта: категории,
задачи, сроки, критичность и история изменений с отменой. Организация — единица
изоляции данных; регистрация свободная, первый вошедший получает собственную
организацию и роль `owner`.

## Запуск

Нужен Docker с плагином `compose`.

```sh
cp .env.example .env      # отредактируй APP_SECRET и учётные данные Postgres
docker compose up
```

API слушает на <http://localhost:8000>, проверка живости — `GET
/api/health`. Схема базы накатывается автоматически (`alembic upgrade head`
выполняется перед стартом сервера), отдельного шага миграции нет.

Дальше — `POST /api/auth/register` с полями `name`, `email`, `password`:
ответ ставит куку сессии, и с ней доступны `POST /api/projects`,
`GET /api/projects/{id}` и `POST /api/projects/{id}/mutations`.

`.env` — единственный источник настроек, и в `.env.example` каждая описана
комментарием. Два значения обязательны и не имеют умолчания: `DATABASE_URL` и
`APP_SECRET`.

## Тесты

Тесты работают только с базой `<имя из DATABASE_URL>_test` и никогда с базой
из `DATABASE_URL` — `backend/tests/conftest.py` это проверяет и отказывается
запускаться иначе. Тестовую базу нужно создать один раз:

```sh
docker compose exec db createdb -U flowline flowline_test
cd backend && uv run pytest
```
