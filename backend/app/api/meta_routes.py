from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings
from app.mail import mail_enabled

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
    #: Есть ли на установке живая лента (WebSocket). На serverless её нет, и
    #: клиенту не за чем тратить попытки подключения и пугать полоской «нет
    #: связи» там, где связи не бывает.
    live_enabled: bool


@router.get("/config", response_model=InstallConfig)
def install_config():
    settings = get_settings()
    return InstallConfig(
        mail_enabled=mail_enabled(),
        signup_mode=settings.signup_mode,
        supported_locales=settings.locales,
        default_locale=settings.default_locale,
        public_sharing_enabled=settings.public_sharing_enabled,
        live_enabled=bool(settings.live_enabled),
    )
