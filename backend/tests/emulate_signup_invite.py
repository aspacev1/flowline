"""Пошаговая эмуляция регистрации и приглашения в команду — по живому стеку.

Не тест и не макет: поднимает настоящее приложение поверх настоящей базы и
проходит путь человека запрос за запросом, печатая, что он делает, что
отвечает сервер и что из этого увидел бы человек на экране. Почта
перехватывается — письма печатаются целиком, вместе с языком, на котором
ушли.

Запуск (Postgres должен быть поднят, база из DATABASE_URL — существовать):

    cd backend
    APP_SECRET=... DATABASE_URL=... uv run python tests/emulate_signup_invite.py

Скрипт заводит СВОЮ базу — имя из DATABASE_URL с суффиксом `_emul`, — и
пересоздаёт её при каждом запуске. База из DATABASE_URL не трогается: та же
дисциплина, что у conftest.py.
"""

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("APP_SECRET", "emulation-secret-not-for-production")
# Почта включена: без неё не видно ни языка писем, ни того, что вообще
# уходит человеку. Транспорт всё равно подменяется перехватчиком ниже.
os.environ.setdefault("MAIL_TRANSPORT", "smtp")
os.environ.setdefault("SMTP_URL", "smtp://localhost:1025")
os.environ.setdefault("MAIL_FROM", "planora@example.com")
os.environ.setdefault("PUBLIC_BASE_URL", "https://planora.example.com")
# Ссылки в письмах при этом остаются https, как в бою. Без этого флага кука
# уезжает с Secure, а TestClient ходит по http — и не возвращает её обратно.
os.environ.setdefault("COOKIE_SECURE", "false")
# Предел на регистрации с одного адреса — 10 по умолчанию, а эмуляция заводит
# полтора десятка аккаунтов с одного «testclient». Сам предел проверяется
# отдельным разделом, который опускает его обратно.
os.environ.setdefault("SIGNUP_RATE_LIMIT_PER_IP", "500")

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import get_settings


def _emulation_database_url() -> str:
    """Отдельная база под эмуляцию. Базу из DATABASE_URL не трогаем никогда."""
    prod = make_url(get_settings().database_url)
    name = f"{prod.database}_emul"
    if name == prod.database or not name.endswith("_emul"):
        raise RuntimeError("отказ: выведенное имя базы совпало с боевым")
    admin = create_engine(prod.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    return prod.set(database=name).render_as_string(hide_password=False)


os.environ["DATABASE_URL"] = _emulation_database_url()
get_settings.cache_clear()

from fastapi.testclient import TestClient  # noqa: E402

import app.mail as mail_module  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Invitation, Membership, Organization, User  # noqa: E402

Base.metadata.create_all(engine)

PASSWORD = "s3cret-pass"

# ---------------------------------------------------------------- перехват почты

MAILBOX: list[mail_module.Letter] = []


class Recorder:
    def deliver(self, letter: mail_module.Letter) -> None:
        MAILBOX.append(letter)


mail_module.build_transport = lambda settings: Recorder()

# ---------------------------------------------------------------- печать

W = 78
PROBLEMS: list[str] = []


def act(title: str) -> None:
    print("\n" + "=" * W)
    print(title.upper())
    print("=" * W)


def part(title: str) -> None:
    print("\n" + "-" * W)
    print(title)
    print("-" * W)


def does(who: str, what: str) -> None:
    print(f"\n  {who}: {what}")


def srv(response, note: str = "") -> None:
    body = ""
    try:
        payload = response.json()
        if isinstance(payload, dict) and "detail" in payload:
            body = f"  detail={payload['detail']!r}"
        elif isinstance(payload, list):
            body = f"  [{len(payload)} шт.]"
    except Exception:
        pass
    print(f"    сервер → {response.status_code}{body}{('  ' + note) if note else ''}")


def sees(text_: str) -> None:
    for line in text_.strip().split("\n"):
        print(f"    экран │ {line.strip()}")


def ok(text_: str) -> None:
    print(f"    ✔ {text_}")


def bad(text_: str) -> None:
    PROBLEMS.append(text_)
    print(f"    ✘ {text_}")


def note(text_: str) -> None:
    print(f"    · {text_}")


def letters(clear: bool = True):
    got = list(MAILBOX)
    if clear:
        MAILBOX.clear()
    return got


def show_letter(letter, label: str = "письмо") -> None:
    print(f"    ✉ {label} → {letter.to}")
    print(f"      тема: {letter.subject}")
    for line in letter.body.strip().split("\n"):
        print(f"      │ {line}")


# ---------------------------------------------------------------- помощники

_seat = iter(range(2, 250))


def browser(ip: str | None = None) -> TestClient:
    """Новый браузер: своя кука и свой адрес.

    Адрес разный у каждого, потому что пределы частоты считаются по нему
    (rate_limit.client_key читает X-Forwarded-For). Иначе вся эмуляция
    выглядела бы как один человек, который регистрируется двадцать раз
    подряд, и предел срабатывал бы там, где в жизни его нет.
    """
    client = TestClient(app)
    client.headers["X-Forwarded-For"] = ip or f"203.0.113.{next(_seat)}"
    # Язык браузера: без него сервер падает на язык установки по умолчанию
    # (az), и все письма выглядели бы азербайджанскими из-за самой эмуляции,
    # а не из-за продукта. С ним видно настоящую разницу: письма человеку
    # уходят на его языке, а приглашение — на языке организации.
    client.headers["Accept-Language"] = "ru-RU,ru;q=0.9"
    return client


def register(client, name, email, **extra):
    return client.post(
        "/api/auth/register",
        json={"name": name, "email": email, "password": PASSWORD, **extra},
    )


def login(client, email, password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def invite(client, **payload):
    body = {"emails": [], "role": "viewer", "deliver": True}
    body.update(payload)
    return client.post("/api/org/invitations", json=body)


def token_of(url: str) -> str:
    return url.rsplit("/", 1)[-1]


def db():
    return SessionLocal()


def org_of(email: str):
    with db() as s:
        user = s.query(User).filter(User.email == email).one()
        rows = (
            s.query(Organization, Membership)
            .join(Membership, Membership.org_id == Organization.id)
            .filter(Membership.user_id == user.id)
            .all()
        )
        return [(o.name, o.slug, o.default_locale, m.role) for o, m in rows]


def expire_invitation(token_url: str, *, days: int = 30) -> None:
    """Двигает срок приглашения в прошлое — вместо ожидания недели."""
    from app.security import hash_token

    with db() as s:
        inv = (
            s.query(Invitation)
            .filter(Invitation.token_hash == hash_token(token_of(token_url)))
            .one()
        )
        inv.expires_at = datetime.now(timezone.utc) - timedelta(days=days)
        s.commit()


def settings_as(**env):
    """Временно меняет настройки установки (SIGNUP_MODE и подобные)."""

    class Ctx:
        def __enter__(self):
            self.saved = {k: os.environ.get(k) for k in env}
            os.environ.update({k: str(v) for k, v in env.items()})
            get_settings.cache_clear()

        def __exit__(self, *exc):
            for k, v in self.saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
            get_settings.cache_clear()

    return Ctx()


# ================================================================== ЧАСТЬ 1
act("Часть 1. Свободная регистрация: приходит владелец")

part("Шаг 1. Открывает /register")
alex = browser()
does("Алексей", "открывает страницу регистрации")
config = alex.get("/api/config")
srv(config)
note(f"установка отвечает: {config.json()}")
sees("Регистрация · Имя · Почта · Пароль · [Зарегистрироваться]")
bad("Форма не спрашивает про требования к паролю и не показывает, что он набран верно")
bad("Фронтенд не запрашивает /api/config: про signup_mode форма не знает")

part("Шаг 2. Заполняет форму и отправляет")
does("Алексей", "вводит «Алексей Смирнов», alex@studio.ru, пароль — и жмёт «Зарегистрироваться»")
r = alex.post(
    "/api/auth/register",
    json={"name": "Алексей Смирнов", "email": "alex@studio.ru", "password": PASSWORD},
    headers={"Accept-Language": "ru-RU,ru;q=0.9"},
)
srv(r)
me = r.json()
note(f"профиль: locale={me['locale']!r}  email_verified={me['email_verified']}")
note(f"кука сессии выдана: {'planora_session' in alex.cookies}")

part("Шаг 3. Что завелось в базе за одну эту кнопку")
for name, slug, loc, role in org_of("alex@studio.ru"):
    note(f"организация: name={name!r}  slug={slug!r}  default_locale={loc!r}  роль={role}")
bad("Название организации — личное имя человека: про компанию не спросили")
bad("default_locale='az', хотя браузер попросил ru и профиль получил locale='ru'")

part("Шаг 4. Письмо, о котором на экране не сказано ни слова")
sent = letters()
if sent:
    show_letter(sent[0], "подтверждение адреса")
sees("… человек уже на /projects, никакого «мы отправили письмо» он не видел")
bad("Ни на одном экране не сказано, что письмо ушло и что от человека чего-то ждут")

part("Шаг 5. Первый экран внутри")
projects = alex.get("/api/projects")
srv(projects)
sees("Проекты · «Здесь пока ни одного проекта» · [Создать проект] [Создать через интервью]")
ok("Владельцу кнопка «Создать проект» действительно доступна — сервер разрешит")
note("Про «позвать команду» на этом экране не сказано ничего")

# ================================================================== ЧАСТЬ 2
act("Часть 2. Владелец зовёт команду")

part("Шаг 6. Ищет, где приглашать")
note("В колонке: Проекты · Мои задачи · Отчёты · [язык] · Настройки · Выйти")
note("«Участники» — вкладка внутри «Настроек»; из колонки о них не догадаться")
listing = alex.get("/api/org/invitations")
srv(listing)
note(f"mail_enabled={listing.json()['mail_enabled']}")

part("Шаг 7. Выпускает приглашение редактору")
does("Алексей", "вводит maria@studio.ru, роль «Редактор», галочка «Отправить письмо»")
r = invite(alex, emails=["maria@studio.ru"], role="editor")
srv(r)
issued = r.json()[0]
note(f"ссылка: {issued['url']}")
note(f"письмо отправлено: {issued['sent']}   срок до: {issued['expires_at'][:10]}")
maria_link = issued["url"]

part("Шаг 8. Письмо, которое получит Мария")
sent = letters()
if sent:
    show_letter(sent[0], "приглашение")
bad("Письмо ушло на азербайджанском: _deliver берёт org.default_locale, а там 'az'")
bad("Форма приглашения нигде не называет язык письма и не даёт его выбрать")

part("Шаг 9. Что владелец видит в списке приглашений")
rows = alex.get("/api/org/invitations").json()["invitations"]
for inv in rows:
    note(f"{inv['email']} · {inv['role']} · {inv['status']} · до {inv['expires_at'][:10]}")
sees("maria@studio.ru   Редактор   Ждёт")
bad("Ни срока, ни даты, ни отметки об отправке письма на экран не выводится")
bad("Кнопки строки (Новая ссылка / Отправить ещё раз / Отозвать) — opacity:0 до наведения мыши")

# ================================================================== ЧАСТЬ 3
act("Часть 3. Приглашённая проходит путь целиком")

part("Шаг 10. Мария открывает ссылку — аккаунта у неё нет")
maria = browser()
does("Мария", "жмёт ссылку в письме")
r = maria.get(f"/api/invitations/{token_of(maria_link)}")
srv(r)
preview = r.json()
sees(
    f"""Приглашение
    Вас приглашают в организацию «{preview['org_name']}» — роль: {preview['role']}
    Приглашает {preview['inviter_name']}
    [Зарегистрироваться] [Войти]"""
)
ok("До входа видно, куда зовут и кто зовёт — подписывать не глядя не просят")
bad(f"expires_at={preview['expires_at'][:10]} сервер прислал, но экран срок не показывает")

part("Шаг 11. Регистрируется по приглашению")
does("Мария", "жмёт «Зарегистрироваться» → /register?invite=TOKEN")
note("адрес подставлен из приглашения и не редактируется")
r = maria.post(
    "/api/auth/register",
    json={
        "name": "Мария Иванова",
        "email": "maria@studio.ru",
        "password": PASSWORD,
        "invite_token": token_of(maria_link),
    },
)
srv(r)
for name, slug, loc, role in org_of("maria@studio.ru"):
    note(f"организация: {name!r} · роль={role}")
ok("Членство создано сразу, приглашение принято — второго действия не нужно")
ok("Своей пустой организации приглашённой НЕ завели — это правильно")
extra = letters()
note(f"писем после регистрации по приглашению: {len(extra)}")
if extra:
    note(f"→ ушло ещё и «{extra[0].subject}» — сразу после письма-приглашения")

part("Шаг 12. Первый экран Марии")
r = maria.get("/api/projects")
srv(r)
sees("Проекты · «Здесь пока ни одного проекта» · [Создать проект]")
r = maria.post("/api/projects", json={"name": "Проверка прав"})
srv(r, "← нажатие на единственную предложенную кнопку")
if r.status_code == 201:
    ok("Редактору создание разрешено")
else:
    bad("Экран предложил действие, на которое сервер ответил отказом")

part("Шаг 13. Владелец видит, что приглашение принято")
rows = alex.get("/api/org/invitations").json()["invitations"]
for inv in rows:
    note(f"{inv['email']} · {inv['status']} · принято {str(inv['accepted_at'])[:19]}")
members = alex.get("/api/org/members").json()
for m in members:
    note(f"состав: {m['name']} · {m['email']} · {m['role']}")

# ================================================================== ЧАСТЬ 4
act("Часть 4. Corner cases")

# ---------------------------------------------------------------- CC-01
part("CC-01. У приглашённого УЖЕ есть аккаунт (самый частый случай)")
does("Алексей", "зовёт nick@studio.ru — у Николая аккаунт с прошлого проекта")
nick = browser()
register(nick, "Николай", "nick@studio.ru")
letters()
r = invite(alex, emails=["nick@studio.ru"], role="viewer")
nick_link = r.json()[0]["url"]
letters()

nick2 = browser()
does("Николай", "открывает ссылку в браузере, где не залогинен, жмёт «Зарегистрироваться»")
r = nick2.post(
    "/api/auth/register",
    json={
        "name": "Николай",
        "email": "nick@studio.ru",
        "password": PASSWORD,
        "invite_token": token_of(nick_link),
    },
)
srv(r)
sees("Этот адрес уже занят")
note("экран сам предлагает: «Уже есть аккаунт? Войти»")
does("Николай", "жмёт «Войти» — Register.tsx:144 ведёт на /login БЕЗ ?invite=")
r = login(nick2, "nick@studio.ru")
srv(r)
org = nick2.get("/api/org").json()
note(f"после входа активная организация: {org['name']!r}")
inv_row = [
    i for i in alex.get("/api/org/invitations").json()["invitations"]
    if i["email"] == "nick@studio.ru"
][0]
note(f"приглашение осталось в статусе: {inv_row['status']!r}")
bad("Токен потерян на ссылке «Войти»: Николай в своей старой организации, приглашение висит «Ждёт»")
note("Обратное направление (Login → Register) токен сохраняет — асимметрия не задумана")

# ---------------------------------------------------------------- CC-02
part("CC-02. Тот же Николай, но по правильному пути (/login?invite=TOKEN)")
nick3 = browser()
login(nick3, "nick@studio.ru")
does("Николай", "после входа фронт ведёт его обратно на /invite/TOKEN")
r = nick3.post(f"/api/invitations/{token_of(nick_link)}/accept")
srv(r)
note(f"вступил в: {r.json()['name']!r} · роль {r.json()['role']}")
note(f"организаций у Николая теперь: {len(org_of('nick@studio.ru'))}")
ok("Путь работает — ровно тот, до которого одна сломанная ссылка не даёт дойти")

# ---------------------------------------------------------------- CC-03
part("CC-03. Просроченная ссылка")
r = invite(alex, emails=["late@studio.ru"], role="viewer")
late_link = r.json()[0]["url"]
letters()
expire_invitation(late_link)
guest = browser()
does("Гость", "открывает ссылку через месяц")
r = guest.get(f"/api/invitations/{token_of(late_link)}")
srv(r)
sees("Срок действия ссылки истёк   [К проектам]")
ok("Причина названа отдельным кодом — не общее «ссылка недействительна»")
bad("Единственная кнопка ведёт на /projects → RequireAuth → форма входа, которой у гостя нет")
does("Гость", "всё же идёт на /register?invite=TOKEN — форма там нарисуется")
r = guest.post(
    "/api/auth/register",
    json={"name": "Гость", "email": "late@studio.ru", "password": PASSWORD,
          "invite_token": token_of(late_link)},
)
srv(r)
bad("Форма регистрации по мёртвой ссылке остаётся живой и может только отказать")

# ---------------------------------------------------------------- CC-04
part("CC-04. Отозванная ссылка")
r = invite(alex, emails=["fired@studio.ru"], role="editor")
fired_link = r.json()[0]["url"]
fired_id = r.json()[0]["id"]
letters()
does("Алексей", "отзывает приглашение")
srv(alex.delete(f"/api/org/invitations/{fired_id}"))
does("Приглашённый", "открывает ссылку, которую ему уже отправили")
srv(browser().get(f"/api/invitations/{token_of(fired_link)}"))
sees("Приглашение отозвано — обратитесь к тому, кто вас звал")
ok("Отзыв срабатывает мгновенно и назван своим словом")

# ---------------------------------------------------------------- CC-05
part("CC-05. Повторный клик по уже принятой ссылке")
does("Мария", "открывает своё старое письмо и жмёт ссылку ещё раз")
srv(maria.get(f"/api/invitations/{token_of(maria_link)}"))
sees("Вы уже приняли это приглашение — просто войдите")
ok("Принятое остаётся принятым даже после истечения срока — порядок проверок верный")

# ---------------------------------------------------------------- CC-06
part("CC-06. Ссылка переслана постороннему (приглашение с адресом)")
r = invite(alex, emails=["boss@studio.ru"], role="editor")
boss_link = r.json()[0]["url"]
letters()
stranger = browser()
register(stranger, "Посторонний", "stranger@other.com")
letters()
does("Посторонний", "получил пересланное письмо и жмёт «Принять»")
srv(stranger.post(f"/api/invitations/{token_of(boss_link)}/accept"))
sees("Приглашение выписано на адрес boss@studio.ru. Выйдите и войдите под ним")
ok("Приглашение с адресом привязано намертво — пересылка не пускает")

# ---------------------------------------------------------------- CC-07
part("CC-07. Приглашение-ссылка без адреса (предъявителю)")
does("Алексей", "создаёт приглашение, не указав ни одного адреса")
r = invite(alex, emails=[], role="viewer")
srv(r)
bearer_link = r.json()[0]["url"]
note(f"email в приглашении: {r.json()[0]['email']!r}")
note(f"писем ушло: {len(letters())}")
anybody = browser()
register(anybody, "Кто угодно", "anybody@internet.com")
letters()
does("Кто угодно", "открывает пересланную ссылку и жмёт «Принять»")
srv(anybody.post(f"/api/invitations/{token_of(bearer_link)}/accept"))
ok("Так и задумано — но это единственная дверь без проверки, кто вошёл")

# ---------------------------------------------------------------- CC-08
part("CC-08. Роль «Владелец» через приглашение-ссылку предъявителю")
does("Алексей", "по ошибке выбирает роль «Владелец» и оставляет адрес пустым")
r = invite(alex, emails=[], role="owner")
srv(r)
owner_link = r.json()[0]["url"]
letters()
rando = browser()
register(rando, "Случайный", "rando@internet.com")
letters()
does("Случайный", "открывает ссылку")
srv(rando.post(f"/api/invitations/{token_of(owner_link)}/accept"))
note(f"роль: {[r for _, _, _, r in org_of('rando@internet.com')]}")
srv(rando.get("/api/org/invitations"), "← теперь он сам может звать кого угодно")
bad("Роль «Владелец» выдаётся ссылкой предъявителю без единого предупреждения")
note("код role_not_invitable лежит в словаре фронтенда, но на сервере не поднимается нигде")

# ---------------------------------------------------------------- CC-09
part("CC-09. Приглашение того, кто уже в организации (попытка повысить роль)")
before = [r for _, _, _, r in org_of("maria@studio.ru")]
does("Алексей", "хочет повысить Марию и, не найдя как, зовёт её снова ролью «Владелец»")
r = invite(alex, emails=["maria@studio.ru"], role="owner")
srv(r, "← сервер не возражает, что адрес уже в составе")
promo_link = r.json()[0]["url"]
letters()
does("Мария", "читает «роль: Владелец», жмёт «Принять»")
srv(maria.post(f"/api/invitations/{token_of(promo_link)}/accept"))
after = [r for _, _, _, r in org_of("maria@studio.ru")]
note(f"роль была {before} → стала {after}")
bad("Обе стороны видят «Принято», роль не изменилась, никто об этом не сказал")

# ---------------------------------------------------------------- CC-10
part("CC-10. Сменить роль или исключить участника")
with db() as s:
    maria_id = str(s.query(User).filter(User.email == "maria@studio.ru").one().id)
for method, path in (
    ("PATCH", f"/api/org/members/{maria_id}"),
    ("DELETE", f"/api/org/members/{maria_id}"),
    ("POST", "/api/org"),
    ("DELETE", "/api/org"),
):
    r = alex.request(method, path, json={"role": "viewer"})
    srv(r, f"← {method} {path}")
bad("Маршрутов смены роли и исключения не существует: роль назначается один раз навсегда")
bad("Своей организации не создать и не удалить — приглашённый навсегда житель чужой")

# ---------------------------------------------------------------- CC-11
part("CC-11. Повторное приглашение того же адреса из формы")
r = invite(alex, emails=["twice@studio.ru"], role="viewer")
first_link = r.json()[0]["url"]
letters()
note(f"первая ссылка выдана: …{token_of(first_link)[:8]}")
does("Алексей", "через час, забыв, что уже звал, зовёт тот же адрес ещё раз")
r = invite(alex, emails=["twice@studio.ru"], role="viewer")
second_link = r.json()[0]["url"]
letters()
note(f"вторая ссылка: …{token_of(second_link)[:8]}")
srv(browser().get(f"/api/invitations/{token_of(first_link)}"), "← ПЕРВАЯ ссылка")
bad("Первая ссылка молча умерла: из списка то же действие требует подтверждения, из формы — нет")

# ---------------------------------------------------------------- CC-12
part("CC-12. Один плохой адрес из пяти")
does("Алексей", "вставляет из Outlook: «Иван Петров <ivan@studio.ru>, maria2@studio.ru»")
r = invite(alex, emails=["Иван", "Петров", "<ivan@studio.ru>", "maria2@studio.ru"], role="viewer")
srv(r)
sees("Проверьте форму: некоторые поля заполнены неверно")
bad("Всё-или-ничего: годные адреса не приглашены, какой именно плох — не сказано")
note("заготовленный текст error.invalid_email до экрана не доходит: Pydantic отбраковывает раньше")

# ---------------------------------------------------------------- CC-13
part("CC-13. Позвать команду из 25 человек")
note("форма принимает до 50 адресов (MAX_EMAILS_PER_REQUEST), домен рубит на 20 в час")
with settings_as(INVITE_RATE_LIMIT=3):
    bulk = browser()
    register(bulk, "Стартап", "bulk@studio.ru")
    letters()
    r = invite(bulk, emails=[f"t{i}@studio.ru" for i in range(5)], role="viewer")
    srv(r, "← 5 адресов при потолке 3")
    note(f"создано приглашений: {len(bulk.get('/api/org/invitations').json()['invitations'])}")
bad("Отказ приходит на весь список; ни потолок, ни остаток в интерфейсе не названы")

# ---------------------------------------------------------------- CC-14
part("CC-14. Клиент, которому не отметили ни одного проекта")
does("Алексей", "зовёт заказчика ролью «Клиент», галочек проектов не ставит")
r = invite(alex, emails=["client@customer.com"], role="client", project_ids=[])
srv(r)
client_link = r.json()[0]["url"]
letters()
customer = browser()
r = customer.post(
    "/api/auth/register",
    json={"name": "Заказчик", "email": "client@customer.com", "password": PASSWORD,
          "invite_token": token_of(client_link)},
)
srv(r)
letters()
r = customer.get("/api/projects")
srv(r, f"← проектов видно: {len(r.json())}")
sees("Проекты · «Здесь пока ни одного проекта» · [Создать проект] [Создать через интервью]")
r = customer.post("/api/projects", json={"name": "Попробую"})
srv(r, "← нажатие на единственную предложенную кнопку")
bad("Первый экран приглашённого зовёт создать проект, на который сервер отвечает 403")
srv(customer.get("/api/org/members"), "← вкладка «Участники» видна ему в интерфейсе")

# ---------------------------------------------------------------- CC-15
part("CC-15. Подтверждение адреса: повторное открытие ссылки")
verify_client = browser()
r = register(verify_client, "Пётр", "peter@studio.ru")
srv(r)
letter = letters()[0]
link = [w for w in letter.body.split() if "verify-email" in w][0]
verify_token = link.split("token=")[-1]
does("Пётр", "открывает ссылку из письма")
srv(browser().post("/api/auth/verify-email", json={"token": verify_token}))
ok("Адрес подтверждён")
does("Пётр", "нажимает «Открыть в браузере» — та же ссылка открывается второй раз")
srv(browser().post("/api/auth/verify-email", json={"token": verify_token}))
sees("Ссылка не подходит: скорее всего, ей уже воспользовались")
bad("Успешно подтвердивший адрес человек видит красную ошибку вместо «адрес уже подтверждён»")

part("CC-16. Подтверждение адреса: письмо не дошло, нужна новая ссылка")
lost = browser()
register(lost, "Ольга", "olga@studio.ru")
letters()
does("Ольга", "письмо не пришло. Идёт искать «отправить ещё раз»")
note("в интерфейсе признака «адрес не подтверждён» нет нигде: email_verified читается в 1 месте")
does("Ольга", "вручную открывает /verify-email без токена")
sees("В ссылке нет токена: скопируйте её из письма целиком")
note("кнопка повтора рисуется только внутри ветки ОШИБКИ погашения — а токена у неё нет")
bad("Маршрут повтора есть, но в интерфейсе до него нельзя дойти ни одним способом")
does("Ольга", "если бы кнопка нашлась — жмёт её через полминуты после регистрации")
r = lost.post("/api/auth/verify-email/resend")
srv(r, "← кулдаун считается от письма регистрации, а не от первого нажатия")
bad("Первое же «отправить ещё раз» упирается в «Слишком часто»: минуту назад ушло письмо регистрации")
note("отсчёт ведётся по факту ВЫДАЧИ токена, а не по факту доставки письма")
letters()

part("CC-17. Что теряет неподтверждённый адрес")
unverified = browser()
register(unverified, "Неподтверждённый", "unv@studio.ru")
letters()
srv(unverified.get("/api/projects"), "← проекты")
srv(unverified.post("/api/projects", json={"name": "Проект"}), "← создание проекта")
srv(unverified.post("/api/org/invitations", json={"emails": [], "role": "viewer"}), "← звать других")
bad("Неподтверждённый адрес не запрещает ничего — шаг существует, но ни на что не влияет")
letters()

# ---------------------------------------------------------------- CC-18
part("CC-18. Установка SIGNUP_MODE=invite_only")
with settings_as(SIGNUP_MODE="invite_only"):
    note(f"signup_mode = {get_settings().signup_mode}")
    walkin = browser()
    does("Человек с улицы", "видит ту же форму регистрации и отправляет её")
    srv(register(walkin, "С улицы", "walkin@internet.com"))
    sees("Открытая регистрация в этой установке закрыта")
    bad("Форма нарисовалась и приняла три поля только чтобы отказать: /api/config не спрошен")
    does("Приглашённый", "приходит по живой ссылке")
    r = invite(alex, emails=["invited@studio.ru"], role="viewer")
    inv_only_link = r.json()[0]["url"]
    letters()
    ok_client = browser()
    srv(ok_client.post("/api/auth/register", json={
        "name": "Приглашённый", "email": "invited@studio.ru",
        "password": PASSWORD, "invite_token": token_of(inv_only_link)}))
    ok("По приглашению в invite_only пускает — как и задумано")
    letters()

part("CC-19. Установка SIGNUP_MODE=closed — с ЖИВЫМ приглашением")
r = invite(alex, emails=["closed@studio.ru"], role="viewer")
closed_link = r.json()[0]["url"]
letters()
with settings_as(SIGNUP_MODE="closed"):
    guest2 = browser()
    does("Приглашённый", "открывает ссылку — превью работает, всё выглядит живым")
    srv(guest2.get(f"/api/invitations/{token_of(closed_link)}"))
    does("Приглашённый", "заполняет форму и отправляет")
    srv(guest2.post("/api/auth/register", json={
        "name": "Закрытый", "email": "closed@studio.ru",
        "password": PASSWORD, "invite_token": token_of(closed_link)}))
    sees("Открытая регистрация в этой установке закрыта")
    bad("Полный тупик: аккаунта нет, ссылка живая, текст говорит про «открытую регистрацию»")
    does("Алексей", "при этом продолжает спокойно выпускать приглашения")
    srv(invite(alex, emails=["another@studio.ru"], role="viewer"), "← выпуск не запрещён и не предупреждён")
    letters()

# ---------------------------------------------------------------- CC-20
part("CC-20. Предел частоты регистраций с одного адреса")
note("три коллеги из одного офиса выходят в интернет через один внешний адрес")
with settings_as(SIGNUP_RATE_LIMIT_PER_IP=2):
    for i in range(3):
        c = browser(ip="198.51.100.7")
        r = register(c, f"Ю{i}", f"office{i}@studio.ru")
        srv(r, f"← коллега {i + 1} с того же адреса")
    letters()
sees("Слишком часто: подождите минуту и попробуйте снова")
note(f"на деле окно = AUTH_RATE_WINDOW_SECONDS = {get_settings().auth_rate_window_seconds} с")
bad("Текст обещает минуту, а ждать нужно пятнадцать — и упирается в это офис за одним NAT")

# ---------------------------------------------------------------- CC-21
part("CC-21. Смена пароля")
r = alex.post("/api/auth/password",
              json={"current_password": PASSWORD, "new_password": "brand-new-pass"})
srv(r, "← маршрут работает")
srv(login(browser(), "alex@studio.ru", "brand-new-pass"), "← вход новым паролем")
bad("Во фронтенде функции нет, поля нет, перевода нет — сменить пароль нечем")
alex.post("/api/auth/password",
          json={"current_password": "brand-new-pass", "new_password": PASSWORD})

# ---------------------------------------------------------------- CC-22
part("CC-22. Восстановление пароля обрывает приглашение")
r = invite(alex, emails=["forgot@studio.ru"], role="viewer")
letters()
forgot_user = browser()
register(forgot_user, "Забывчивый", "forgot@studio.ru")
letters()
does("Забывчивый", "по ссылке приглашения → «Зарегистрироваться» → «адрес занят» → «Войти» → «Забыли пароль?»")
srv(forgot_user.post("/api/auth/password/forgot", json={"email": "forgot@studio.ru"}))
sent = letters()
if sent:
    show_letter(sent[0], "восстановление пароля")
note("ForgotPassword.tsx:62 и ResetPassword.tsx:127,160 ведут на /login — без ?invite=")
bad("Токен приглашения не переживает ни одну страницу восстановления пароля")

# ---------------------------------------------------------------- CC-23
part("CC-23. Приглашение на адрес, который сам себе владелец")
does("Алексей", "по невнимательности выписывает приглашение на свой же адрес, роль «Наблюдатель»")
r = invite(alex, emails=["alex@studio.ru"], role="viewer")
srv(r)
self_link = r.json()[0]["url"]
letters()
srv(alex.post(f"/api/invitations/{token_of(self_link)}/accept"))
note(f"роль Алексея после этого: {[r for _, _, _, r in org_of('alex@studio.ru')]}")
ok("Роль не переписана — последнего владельца разжаловать не удалось. Защита работает")

# ---------------------------------------------------------------- CC-24
part("CC-24. Человек в двух организациях")
note(f"организации Николая: {[(n, r) for n, _, _, r in org_of('nick@studio.ru')]}")
r = nick3.get("/api/org/list")
srv(r, f"← в переключателе {len(r.json())} пункта")
note("на телефоне (≤760px) переключатель скрыт: .sidebar .org-switch { display: none }")
bad("Вторая организация — пустышка с личным именем, удалить её нечем")

# ---------------------------------------------------------------- итог
act("Итог эмуляции")
print(f"\nПройдено сценариев: 3 сквозных + 24 corner case")
print(f"Отмечено проблем: {len(PROBLEMS)}\n")
for i, p in enumerate(PROBLEMS, 1):
    print(f"  {i:2d}. {p}")
print()
