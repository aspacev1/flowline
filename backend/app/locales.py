"""Выбор языка при первом появлении человека.

Спецификация: язык хранится в профиле; при первом входе берётся из
`Accept-Language`, если тот просит один из поддерживаемых, иначе —
азербайджанский. Дальше — только то, что человек выбрал сам.
"""

from app.config import get_settings


def _weight(part: str) -> float:
    """Вес языка из `;q=`. Без него порядок предпочтений теряется.

    Испорченный вес — это не отказ разбирать заголовок целиком: заголовок
    приходит из браузера, но пройти он мог через что угодно.
    """
    for parameter in part.split(";")[1:]:
        key, _, value = parameter.partition("=")
        if key.strip().casefold() == "q":
            try:
                return float(value)
            except ValueError:
                return 0.0
    return 1.0


def preferred_locale(header: str | None, supported: list[str], default: str) -> str:
    """Первый поддерживаемый язык из `Accept-Language`.

    Регистр приводится инвариантно (`casefold`), а не в локали процесса:
    в азербайджанской локали `"I"` превращается в `ı`, и один и тот же
    заголовок начинал бы разбираться по-разному в зависимости от того, чья
    локаль оказалась активной у сервера.

    Сравнивается только основной подтег: `ru-RU` — это русский, и требовать
    от браузера ровно `ru` значило бы не понимать половину живых заголовков.
    Регион при этом не сохраняется: продукт различает три языка, а не
    диалекты.
    """
    known = {code.casefold(): code for code in supported}

    ranked = []
    for part in (header or "").split(","):
        tag = part.split(";")[0].strip().casefold()
        if not tag or tag == "*":
            continue
        primary = tag.split("-")[0]
        if primary in known:
            ranked.append((_weight(part), known[primary]))

    if not ranked:
        return default
    # max по весу; при равных весах побеждает тот, кто раньше в заголовке —
    # поэтому сортировка устойчивая, а не max() по одному ключу.
    return sorted(ranked, key=lambda item: item[0], reverse=True)[0][1]


def locale_from_request(header: str | None) -> str:
    settings = get_settings()
    return preferred_locale(header, settings.locales, settings.default_locale)
