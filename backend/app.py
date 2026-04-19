from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, List
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LEFT_KEYS = ["L_BIG_TOE", "L_TOES", "L_BALL", "L_ARCH", "L_HEEL"]
RIGHT_KEYS = ["R_BIG_TOE", "R_TOES", "R_BALL", "R_ARCH", "R_HEEL"]

FOREFOOT_KEYS = ["L_BIG_TOE", "L_TOES", "L_BALL", "R_BIG_TOE", "R_TOES", "R_BALL"]
HEEL_KEYS = ["L_HEEL", "R_HEEL"]

ZONE_LABELS = {
    "L_BIG_TOE": "Left big toe",
    "L_TOES": "Left toes",
    "L_BALL": "Left ball of foot",
    "L_ARCH": "Left arch",
    "L_HEEL": "Left heel",
    "R_BIG_TOE": "Right big toe",
    "R_TOES": "Right toes",
    "R_BALL": "Right ball of foot",
    "R_ARCH": "Right arch",
    "R_HEEL": "Right heel",
}

class SensorFrame(BaseModel):
    timestamp: float
    values: Dict[str, float]

class InferRequest(BaseModel):
    frames: List[SensorFrame]

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/infer")
def infer(req: InferRequest):
    latest = req.frames[-1].values if req.frames else {}

    left = sum(latest.get(k, 0) for k in LEFT_KEYS)
    right = sum(latest.get(k, 0) for k in RIGHT_KEYS)
    total = max(left + right, 1)

    left_pct = round(100 * left / total)
    right_pct = 100 - left_pct

    forefoot = sum(latest.get(k, 0) for k in FOREFOOT_KEYS)
    heel = sum(latest.get(k, 0) for k in HEEL_KEYS)

    if latest:
        peak_zone_key, peak_value = max(latest.items(), key=lambda kv: kv[1])
    else:
        peak_zone_key, peak_value = "L_HEEL", 0

    stability_cue = "Stable"
    risk_level = "Low"
    risk_reason = "Pressure distribution within expected range"

    if right_pct >= 60:
        stability_cue = "Leaning Right"
    elif left_pct >= 60:
        stability_cue = "Leaning Left"
    elif forefoot > heel + 40:
        stability_cue = "Leaning Forward"
    elif heel > forefoot + 40:
        stability_cue = "Leaning Back"

    if peak_value >= 85:
        risk_level = "Moderate"
        risk_reason = f"High pressure concentration at {ZONE_LABELS.get(peak_zone_key, peak_zone_key)}"

    return {
        "balance_left_pct": left_pct,
        "balance_right_pct": right_pct,
        "peak_pressure_zone": ZONE_LABELS.get(peak_zone_key, peak_zone_key),
        "peak_value": peak_value,
        "stability_cue": stability_cue,
        "risk_level": risk_level,
        "risk_reason": risk_reason,
    }