"""Симметричное шифрование секретом приложения.

Нужно ровно одному значению — ключу LLM организации. Ключ шифрования выводится
из `APP_SECRET`, а не хранится отдельно: второй секрет пришлось бы задавать
тому, кто разворачивает, и половина установок оставила бы его умолчанием.

Ротация `APP_SECRET` требует перешифровки ключей — это записано в
спецификации как известное следствие, а не как недосмотр.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class DecryptionError(Exception):
    """Значение не расшифровывается этим секретом.

    Обычно это значит, что `APP_SECRET` сменили, а ключи не перешифровали.
    Отдельный класс, потому что это не «ключа нет» — это «ключ есть, но
    прочитать его нечем», и путать их нельзя: первое чинится вводом ключа,
    второе — возвратом прежнего секрета.
    """


def _key() -> bytes:
    # SHA-256 от секрета, а не сам секрет: Fernet требует ровно 32 байта в
    # base64, а APP_SECRET — произвольная строка от деплойщика.
    digest = hashlib.sha256(get_settings().app_secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt(value: str) -> str:
    return Fernet(_key()).encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return Fernet(_key()).decrypt(value.encode()).decode()
    except InvalidToken as error:
        raise DecryptionError("значение не расшифровывается текущим APP_SECRET") from error
