import os
from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Вынесено в имя, потому что ниже с ним сравнивают: «значение осталось
# умолчанием» — единственный доступный признак того, что PUBLIC_BASE_URL никто
# не задавал, а угадывать домен поверх заданного руками нельзя.
_LOCAL_BASE_URL = "http://localhost:8000"

#: Режимы регистрации. `open` — кто угодно, `invite_only` — только по
#: приглашению, `closed` — вход есть, регистрации нет.
SIGNUP_MODES = ("open", "invite_only", "closed")

# Что обязано быть задано при каждом транспорте почты. Транспортов без
# требований в списке нет: у выключенной почты и у записи в журнал требований
# нет по определению.
_MAIL_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    "smtp": ("smtp_url", "mail_from"),
    "api": ("mail_api_url", "mail_api_key", "mail_from"),
}
#: Транспорты почты, которые умеет эта установка. `none` — писем нет вовсе, и
#: интерфейс не показывает кнопку отправки; `log` — та же запись в журнал, но
#: установка считается почтовой (кнопка на месте, письмо ищется в логе) —
#: разница нужна при разработке.
MAIL_TRANSPORTS: tuple[str, ...] = ("none", "log", *_MAIL_REQUIREMENTS)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_REPO_ROOT / ".env", extra="ignore")

    database_url: str
    app_secret: str

    public_base_url: str = _LOCAL_BASE_URL
    default_locale: str = "az"
    supported_locales: str = "az,en,ru"
    signup_mode: str = "open"

    mail_transport: str = "none"
    smtp_url: str = ""
    mail_api_key: str = ""
    mail_api_url: str = ""
    mail_from: str = ""
    invite_ttl_days: int = 7
    invite_rate_limit: int = 20

    public_sharing_enabled: bool = True
    guest_comment_rate_limit: int = 10

    ai_max_questions: int = 12
    ai_schema_retries: int = 2
    ai_request_timeout: int = 60

    max_tasks_per_project: int = 2000
    max_text_len: int = 4000
    log_level: str = "INFO"

    @field_validator("database_url")
    @classmethod
    def _spell_out_the_driver(cls, value: str) -> str:
        """Дописывает драйвер к адресу базы, если его там нет.

        Управляемые базы (Neon, Supabase, Vercel Marketplace) выдают строку
        подключения в виде `postgresql://…`, а некоторые — ещё и наследием
        Heroku в виде `postgres://…`. SQLAlchemy по первой пойдёт искать
        psycopg2, которого в зависимостях нет, а на второй просто откажется
        разбирать адрес. Раньше это чинилось руками при каждом копировании
        строки из панели — и ломалось молча, если интеграция вписывала
        переменную сама и править было нечего.

        Заданный драйвер не трогаем: `postgresql+psycopg` уже верен, а
        `postgresql+asyncpg` — осознанный выбор того, кто его написал.
        """
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return f"postgresql+psycopg://{value[len(prefix):]}"
        return value

    @field_validator("signup_mode")
    @classmethod
    def _reject_a_value_nobody_implements(cls, value: str) -> str:
        """Отвергает незнакомое значение рубильника при старте, а не при первом
        обращении к нему.

        Опечатка в `SIGNUP_MODE` иначе тихо превращает установку в закрытую
        (сравнение с `open` не сходится) — отказ, неотличимый от задуманного
        поведения и потому ищущийся часами; отказ стартовать находится за
        секунду. То же самое про `MAIL_TRANSPORT` проверяется ниже, вместе с
        переменными, которых транспорт требует.
        """
        if value not in SIGNUP_MODES:
            raise ValueError(f"допустимые значения: {', '.join(SIGNUP_MODES)}")
        return value

    @model_validator(mode="after")
    def _borrow_the_domain_from_the_platform(self) -> Self:
        """Выводит PUBLIC_BASE_URL из домена, который выдала платформа.

        На Vercel домен известен только после первого деплоя, поэтому задать
        переменную заранее нельзя: получается круг — сначала деплой, потом
        значение, потом деплой заново. А до второго деплоя кука сессии уезжает
        по https без флага Secure, потому что он выводится отсюда
        (см. app.api.auth_routes).

        VERCEL_PROJECT_PRODUCTION_URL — постоянный домен проекта,
        VERCEL_URL — адрес конкретного деплоя; обе платформа выставляет сама,
        обе без схемы. Первая красивее и переживает передеплой, вторая есть
        всегда — отсюда порядок.

        Заданное значение имеет приоритет: свой домен, привязанный к проекту,
        платформа в этих переменных не показывает.
        """
        if self.public_base_url != _LOCAL_BASE_URL:
            return self

        host = os.getenv("VERCEL_PROJECT_PRODUCTION_URL") or os.getenv("VERCEL_URL")
        if host:
            self.public_base_url = f"https://{host}"
        return self

    @model_validator(mode="after")
    def _refuse_a_mail_setup_that_cannot_send(self) -> Self:
        """Не даёт приложению стартовать с наполовину заданной почтой.

        Без этой проверки `MAIL_TRANSPORT=smtp` при пустом `SMTP_URL`
        обнаружился бы только на первом письме — то есть на регистрации
        первого же пользователя, и молча: письмо не ушло, в журнале строчка,
        которую никто не читает. Опечатка в самом значении (`MAIL_TRANSPORT=
        stmp`) тем более не должна тихо превращаться в «почта выключена».

        Выключенная почта проверок не требует: установка без почтового
        сервера — законный вариант развёртывания, а не недонастроенный.
        """
        if self.mail_transport not in MAIL_TRANSPORTS:
            raise ValueError(
                f"MAIL_TRANSPORT={self.mail_transport!r}: допустимы "
                f"{', '.join(MAIL_TRANSPORTS)}"
            )

        missing = [
            name.upper()
            for name in _MAIL_REQUIREMENTS.get(self.mail_transport, ())
            if not getattr(self, name)
        ]
        if missing:
            raise ValueError(
                f"MAIL_TRANSPORT={self.mail_transport}, но не задано: {', '.join(missing)}"
            )
        return self

    @property
    def mail_enabled(self) -> bool:
        """Есть ли куда отправлять письма.

        При `none` интерфейс не показывает кнопку отправки вовсе — остаётся
        копирование ссылки, а само письмо уходит в журнал. `log` пишет туда
        же, но установка считается почтовой: при разработке кнопка нужна на
        месте, а письмо читается в логе.
        """
        return self.mail_transport != "none"

    @property
    def locales(self) -> list[str]:
        return [item.strip() for item in self.supported_locales.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
