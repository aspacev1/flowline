from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    app_secret: str

    public_base_url: str = "http://localhost:8000"
    default_locale: str = "az"
    supported_locales: str = "az,en,ru"
    signup_mode: str = "open"

    mail_transport: str = "none"
    smtp_url: str = ""
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

    @property
    def locales(self) -> list[str]:
        return [item.strip() for item in self.supported_locales.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
