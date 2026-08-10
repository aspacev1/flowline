from fastapi import FastAPI

app = FastAPI(title="Flowline")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
