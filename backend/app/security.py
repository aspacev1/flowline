import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    """Проверка пароля. Любой отказ argon2 — это неудачный вход, а не авария.

    VerifyMismatchError (неверный пароль) — лишь один из случаев: испорченная
    или обрезанная строка хеша поднимает InvalidHashError, прочие поломки —
    VerificationError. Все они раньше долетали до клиента пятисоткой, хотя
    правильный ответ на них тот же самый: войти не удалось.

    UnicodeEncodeError в том же списке не по недосмотру: argon2 кодирует
    строку хеша в ascii и на нелатинском мусоре в колонке падает ещё до
    разбора формата. Пароль это не затрагивает — он кодируется в utf-8.
    """
    try:
        return _hasher.verify(hashed, raw)
    except (VerificationError, InvalidHashError, UnicodeEncodeError):
        return False


def new_token() -> tuple[str, str]:
    """Открытый токен и его хеш. Открытый показывается один раз, хранится хеш."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
