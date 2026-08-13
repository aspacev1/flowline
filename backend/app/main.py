from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.api import (
    ai_routes,
    auth_routes,
    invite_routes,
    live_routes,
    meta_routes,
    org_routes,
    project_routes,
    public_routes,
    share_routes,
)

app = FastAPI(title="Flowline")


_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _origin_host(value: str) -> str | None:
    host = urlsplit(value).hostname
    return host.lower() if host else None


@app.middleware("http")
async def reject_cross_origin_writes(request: Request, call_next):
    """CSRF в глубину: пишущий запрос с чужого сайта отвергается по Origin.

    Первая линия — SameSite=Lax на куке, но она защищает не всех: старые
    браузеры, встраивание в webview и будущие правки атрибутов куки не должны
    оставлять запись без второй линии. Браузер выставляет Origin на все
    cross-site запросы с телом, и подделать его со страницы нельзя.

    Сверяется хост, а не строка целиком: тот же сайт за прокси виден
    приложению по внутреннему имени, и сравнение со схемой/портом дало бы
    ложные отказы. Ожидаемые хосты — свой Host, X-Forwarded-Host от прокси и
    хост PUBLIC_BASE_URL. Запрос без Origin и Referer проходит: это не
    браузер (curl, тесты, здоровье), и CSRF ему не грозит — кука без
    браузера не подставляется сама.
    """
    if request.method in _WRITE_METHODS and request.url.path.startswith("/api/"):
        stated = request.headers.get("origin") or request.headers.get("referer")
        if stated:
            source = _origin_host(stated)
            allowed = {
                _origin_host(f"//{request.headers.get('host', '')}"),
                _origin_host(f"//{request.headers.get('x-forwarded-host', '')}"),
                _origin_host(get_settings().public_base_url),
            }
            allowed.discard(None)
            if source not in allowed:
                return JSONResponse(status_code=403, content={"detail": "csrf_origin_mismatch"})
    return await call_next(request)
app.include_router(meta_routes.router)
app.include_router(auth_routes.router)
app.include_router(org_routes.router)
app.include_router(invite_routes.router)
app.include_router(invite_routes.public_router)
app.include_router(project_routes.router)
app.include_router(share_routes.router)
app.include_router(public_routes.router)
app.include_router(live_routes.router)
app.include_router(ai_routes.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
