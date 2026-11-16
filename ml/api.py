from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ml.infer import run_inference


class InferencePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: str = "CPI"
    surprise_z: float | None = Field(default=None)
    consensus_overrides: dict[str, float] = Field(default_factory=dict)
    custom_news_text: str = ""
    refresh_data: bool = False
    use_finbert: bool = True


app = FastAPI(title="MacroEdge ML Service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/infer")
def infer(payload: InferencePayload) -> dict[str, Any]:
    try:
        snapshot = run_inference(payload.model_dump())
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    return {"ok": True, "snapshot": snapshot}
