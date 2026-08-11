"""Контракт API зафиксирован снимком `app.openapi()` в backend/openapi.json.

Любая правка маршрутов, параметров или схем меняет снимок, и тест требует
сделать это осознанно: обновить файл и перегенерировать фронтовые типы
(frontend/src/api/schema.d.ts строится из этого же снимка, `npm run gen:api`).
Так дрейф контракта перестаёт быть молчаливым: он виден в диффе PR и ломает
CI, если фронт не узнал об изменении.
"""

import json
import os
from pathlib import Path

from app.main import app

SNAPSHOT = Path(__file__).resolve().parents[1] / "openapi.json"

HOW_TO_UPDATE = (
    "контракт API изменился. Если это задумано:\n"
    "  UPDATE_OPENAPI_SNAPSHOT=1 uv run pytest tests/test_openapi_contract.py\n"
    "  cd ../frontend && npm run gen:api\n"
    "и закоммить оба файла (backend/openapi.json, frontend/src/api/schema.d.ts)."
)


def _render(schema: dict) -> str:
    # sort_keys — чтобы дифф снимка не зависел от порядка регистрации
    # маршрутов; ensure_ascii=False — русские описания читаемы в диффе.
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def test_openapi_matches_snapshot():
    current = _render(app.openapi())

    if os.environ.get("UPDATE_OPENAPI_SNAPSHOT") == "1":
        SNAPSHOT.write_text(current, encoding="utf-8")

    assert SNAPSHOT.exists(), f"снимка {SNAPSHOT} нет. {HOW_TO_UPDATE}"
    assert SNAPSHOT.read_text(encoding="utf-8") == current, HOW_TO_UPDATE
