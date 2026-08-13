"""Проверка адреса LLM перед исходящим запросом: защита от SSRF.

Адрес модели задаёт администратор организации — то есть пользователь, а
запрос по нему выполняет сервер из своей сети. Без проверки это готовый
SSRF: адресом назначается `http://169.254.169.254/…` или внутренний сервис
установки, и «подключение LLM» превращается в прокси в приватную сеть от
имени сервера.

Правила: схема — только https; хост обязан резолвиться только в публичные
адреса (проверяются все A/AAAA-записи — одной приватной достаточно для
отказа). Резолв здесь не устраняет TOCTOU с последующим резолвом в самом
запросе полностью, но закрывает дешёвый путь; редиректы запрещены отдельно
(см. provider), чтобы публичный адрес не переадресовал внутрь.

`AI_ALLOW_PRIVATE_URLS=true` отключает проверку целиком — осознанная ручка
для self-hosted установки с локальной моделью (llama.cpp, vLLM) в той же
сети: обещание «можно подсунуть локальную модель» без неё стало бы ложью.
"""

import ipaddress
import socket
from urllib.parse import urlsplit

from app.ai.provider import LlmError
from app.config import get_settings


def ensure_public_https(url: str) -> None:
    """Поднимает LlmError, если по адресу нельзя ходить с сервера."""
    if get_settings().ai_allow_private_urls:
        return

    parsed = urlsplit(url)
    if parsed.scheme != "https":
        raise LlmError("llm_url_not_https", f"адрес LLM обязан быть https, а не {parsed.scheme!r}")
    host = parsed.hostname
    if not host:
        raise LlmError("llm_url_invalid", "в адресе LLM нет хоста")

    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except OSError as error:
        raise LlmError("llm_unreachable", f"хост {host!r} не резолвится: {error}") from error

    for *_, sockaddr in infos:
        address = ipaddress.ip_address(sockaddr[0])
        # is_global отвергает и приватные диапазоны, и loopback, и
        # link-local (169.254.0.0/16 — облачные метаданные), и CGN разом.
        if not address.is_global:
            raise LlmError(
                "llm_url_private",
                f"хост {host!r} резолвится в непубличный адрес {address}",
            )
