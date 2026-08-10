from fastapi import FastAPI

from app.api import auth_routes

app = FastAPI(title="Flowline")
app.include_router(auth_routes.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
