from fastapi import FastAPI

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
