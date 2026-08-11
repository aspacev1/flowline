"""Текст письма на языке адресата.

Устроено так же, как словари интерфейса (§9 спецификации): по файлу на
язык, ключи смысловые, отсутствующий ключ падает на язык по умолчанию и
пишет предупреждение в лог, а не уходит пустой строкой. Полнота словарей
проверяется тестом, а не глазами.

Подстановка идёт `format_map` по шаблону, а не по данным: имя пользователя
и ссылка попадают в текст значениями и не могут принести с собой ещё одно
поле для подстановки.
"""

import json
import logging
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path

from app.config import get_settings
from app.mail.transports import Letter, MailError

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"

# Последняя ступень отката. Совпадает с умолчанием DEFAULT_LOCALE, но задано
# отдельно: словарь на этом языке обязан существовать в репозитории, чего
# нельзя обещать про произвольное значение переменной окружения.
LAST_RESORT_LOCALE = "az"


@lru_cache
def dictionary(locale: str) -> dict[str, dict[str, str]]:
    """Словарь писем одного языка. Отсутствующий файл — пустой словарь."""
    path = _TEMPLATES_DIR / f"{locale}.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def available_locales() -> list[str]:
    return sorted(path.stem for path in _TEMPLATES_DIR.glob("*.json"))


def _lookup(template: str, field: str, locale: str) -> str:
    # dict.fromkeys, а не set: порядок отката — от языка адресата к языку
    # установки и только затем к азербайджанскому, и он должен сохраниться.
    candidates = dict.fromkeys([locale, get_settings().default_locale, LAST_RESORT_LOCALE])
    for candidate in candidates:
        text = dictionary(candidate).get(template, {}).get(field)
        if text is None:
            continue
        if candidate != locale:
            logger.warning(
                "нет шаблона письма %s.%s на языке %r, отправляю на %r",
                template,
                field,
                locale,
                candidate,
            )
        return text
    raise MailError(f"нет шаблона письма {template}.{field} ни на одном языке")


def render(template: str, locale: str, params: Mapping[str, object], *, to: str) -> Letter:
    subject = _lookup(template, "subject", locale)
    body = _lookup(template, "body", locale)
    return Letter(to=to, subject=_fill(subject, params), body=_fill(body, params))


def _fill(text: str, params: Mapping[str, object]) -> str:
    try:
        return text.format_map(params)
    except (KeyError, IndexError) as exc:
        raise MailError(f"в шаблоне письма нет данных для подстановки {exc}") from exc
