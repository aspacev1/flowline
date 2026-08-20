"""Проверка адреса сайта Jira перед исходящим запросом: защита от SSRF.

Тот же риск и то же лекарство, что у app/ai/netguard.py: адрес задаёт
администратор организации — то есть пользователь, — а ходит по нему сервер.
Без проверки «подключение Jira» превращается в прокси в приватную сеть от
имени сервера, стоит указать `http://169.254.169.254/…` или внутренний
хост установки.

Логика намеренно повторяет app/ai/netguard.py один в один, а не переиспользует
её: два вызывающих (LLM и Jira) поднимают разные исключения со своими кодами,
и общая функция с параметром-фабрикой исключения усложнила бы модуль, где уже
разобрались с SSRF, ради одного дополнительного вызывающего.
"""

import ipaddress
import socket
from urllib.parse import urlsplit

from app.config import get_settings
from app.jira.errors import JiraError


def ensure_public_https(url: str) -> None:
    """Поднимает JiraError, если по адресу нельзя ходить с сервера."""
    if get_settings().jira_allow_private_urls:
        return

    parsed = urlsplit(url)
    if parsed.scheme != "https":
        raise JiraError(
            "jira_url_not_https", f"адрес Jira обязан быть https, а не {parsed.scheme!r}"
        )
    host = parsed.hostname
    if not host:
        raise JiraError("jira_url_invalid", "в адресе Jira нет хоста")

    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except OSError as error:
        raise JiraError("jira_unreachable", f"хост {host!r} не резолвится: {error}") from error

    for *_, sockaddr in infos:
        address = ipaddress.ip_address(sockaddr[0])
        # is_global отвергает и приватные диапазоны, и loopback, и
        # link-local (169.254.0.0/16 — облачные метаданные), и CGN разом.
        if not address.is_global:
            raise JiraError(
                "jira_url_private",
                f"хост {host!r} резолвится в непубличный адрес {address}",
            )
