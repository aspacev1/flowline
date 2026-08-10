from app.text import normalize_email, slugify


def test_email_is_trimmed_and_lowercased():
    assert normalize_email("  User@Example.COM ") == "user@example.com"


def test_email_normalization_is_stable_for_dotted_capital_i():
    # Азербайджанская İ не должна давать разный результат при повторном прогоне
    once = normalize_email("İSTANBUL@example.com")
    assert normalize_email(once) == once


def test_dotless_and_dotted_i_do_not_collapse_into_the_same_email():
    # разные буквы — разные адреса, молчаливого слияния аккаунтов быть не должно
    assert normalize_email("Ismail@x.com") != normalize_email("İsmail@x.com")


def test_slug_transliterates_azerbaijani_letters():
    assert slugify("Şəhər Layihəsi") == "seher-layihesi"
    assert slugify("Çağrı Mərkəzi") == "cagri-merkezi"


def test_slug_handles_dotted_and_dotless_i():
    assert slugify("İstanbul") == "istanbul"
    assert slugify("Işıq") == "isiq"


def test_slug_transliterates_cyrillic():
    assert slugify("Редизайн сайта") == "redizayn-sayta"


def test_slug_collapses_separators_and_trims_dashes():
    assert slugify("  Acme   //  Redesign 2026!! ") == "acme-redesign-2026"


def test_slug_falls_back_when_nothing_survives():
    assert slugify("!!! ???", fallback="project") == "project"
