import re
import unicodedata

# Азербайджанский. Обе формы каждой буквы заданы явно: полагаться на
# «убрать диакритику» нельзя, İ и I — разные буквы, а не украшения.
_AZ = {
    "ə": "e", "Ə": "e",
    "ğ": "g", "Ğ": "g",
    "ı": "i", "I": "i",
    "i": "i", "İ": "i",
    "ö": "o", "Ö": "o",
    "ş": "s", "Ş": "s",
    "ü": "u", "Ü": "u",
    "ç": "c", "Ç": "c",
}

_RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}
_RU.update({k.upper(): v for k, v in _RU.items() if k})

_TRANSLIT = {**_AZ, **_RU}


def normalize_email(raw: str) -> str:
    """Форма адреса для сравнения и уникальности.

    NFKC приводит совместимые формы к одной, casefold не зависит от локали
    процесса — в отличие от приведения регистра в локали пользователя,
    где I превращается в ı и ломает поиск.
    """
    return unicodedata.normalize("NFKC", raw.strip()).casefold()


# Ширина колонок slug в organizations и projects (models.py). Слаг длиннее
# уезжал бы в базу как есть и возвращался DataError на усечении — то есть
# пятисоткой, а не адресом. Транслитерация умеет удлинять текст («щ» → «sch»),
# поэтому граница на входе формы недостаточна: укорачивает сама slugify.
SLUG_MAX_LEN = 100


def slugify(raw: str, fallback: str = "project", *, max_length: int = SLUG_MAX_LEN) -> str:
    transliterated = "".join(_TRANSLIT.get(ch, ch) for ch in raw)
    lowered = transliterated.lower()
    stripped = unicodedata.normalize("NFKD", lowered)
    ascii_only = "".join(ch for ch in stripped if not unicodedata.combining(ch))
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    slug = slug[:max_length].rstrip("-")
    return slug or fallback
