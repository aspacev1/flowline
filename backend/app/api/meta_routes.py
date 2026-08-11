from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings
from app.mail import get_mailer

router = APIRouter(prefix="/api", tags=["meta"])


class InstallConfig(BaseModel):
    """То, что интерфейсу нужно знать об установке до всякого входа.

    Только рубильники, не значения: адреса, ключи и секреты сюда не попадают
    и попасть не могут — маршрут открыт всякому, кто открыл страницу.
    """

    #: Показывать ли кнопку «Отправить письмо». При MAIL_TRANSPORT=none её нет
    #: вовсе, остаётся только копирование ссылки — установка без почтового
    #: сервера должна оставаться полноценной.
    mail_enabled: bool
    #: `open` / `invite_only` / `closed`: рисовать ли форму регистрации.
    signup_mode: str
    supported_locales: list[str]
    default_locale: str
    public_sharing_enabled: bool


@router.get("/config", response_model=InstallConfig)
def install_config():
    settings = get_settings()
    return InstallConfig(
        mail_enabled=get_mailer().enabled,
        signup_mode=settings.signup_mode,
        supported_locales=settings.locales,
        default_locale=settings.default_locale,
        public_sharing_enabled=settings.public_sharing_enabled,
    )
