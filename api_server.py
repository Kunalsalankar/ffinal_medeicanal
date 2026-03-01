import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import numpy as np

try:
    from scipy import signal as _signal  # type: ignore
except Exception:
    _signal = None

from kuan import run_multi_agent_pipeline_structured

app = FastAPI(title="Multi-Agent Gemini Pipeline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    user_request: str
    simulation_data: dict | None = None
    iso_limits: dict | None = None


class VentilatorWhatIfRequest(BaseModel):
    compliance: float
    resistance: float
    leak: float
    rr_bpm: float | None = None
    sensor_noise_pct: float | None = None
    sim_pulse: float | None = None
    duration_s: float = 6.0
    fs_hz: int = 50


_dist_dir = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.isdir(_dist_dir):
    app.mount("/", StaticFiles(directory=_dist_dir, html=True), name="frontend")

    @app.get("/")
    def index():
        return FileResponse(os.path.join(_dist_dir, "index.html"))


@app.post("/api/run")
def run_pipeline(req: RunRequest):
    result = run_multi_agent_pipeline_structured(
        req.user_request,
        simulation_data=req.simulation_data,
        iso_limits=req.iso_limits,
    )
    return result


def _lowpass(x: np.ndarray, fs_hz: int, cutoff_hz: float = 6.0) -> np.ndarray:
    if _signal is None:
        return x
    nyq = fs_hz / 2.0
    wn = min(0.99, cutoff_hz / nyq)
    b, a = _signal.butter(2, wn, btype="low")
    return _signal.filtfilt(b, a, x)


@app.post("/api/ventilator/whatif")
def ventilator_whatif(req: VentilatorWhatIfRequest):
    """SciPy-based ventilator waveform simulation for What-If analysis."""
    fs = int(req.fs_hz)
    duration = float(req.duration_s)
    n = max(10, int(fs * duration))
    t = np.linspace(0.0, duration, n)

    # Simple virtual patient model (P = R*Flow + V/C + PEEP)
    C = max(5.0, float(req.compliance))  # mL/cmH2O
    R = max(1.0, float(req.resistance))  # cmH2O/L/s
    leak = max(0.0, float(req.leak)) / 100.0
    sim_pulse = float(req.sim_pulse or 0.0)

    # Convert compliance to L/cmH2O
    C_l = C / 1000.0
    peep = 5.0

    # Driving pattern
    rr_bpm = float(req.rr_bpm) if req.rr_bpm is not None else 22.0
    rr_hz = max(0.2, rr_bpm / 60.0)

    # Choose a bounded volume waveform (mL) to avoid drift and keep PV loop realistic.
    # Vt increases with compliance and decreases with resistance/leak.
    vt_ml_target = 450.0 + (C - 25.0) * 18.0 - (R - 10.0) * 4.0 - leak * 500.0
    vt_ml_target = float(np.clip(vt_ml_target, 200.0, 800.0))
    v_offset = 250.0
    volume_ml = v_offset + 0.5 * vt_ml_target * (1.0 + np.sin(2 * np.pi * rr_hz * t - np.pi / 2.0))
    volume_ml = _lowpass(volume_ml, fs, cutoff_hz=4.0)

    # Flow derived from dV/dt (convert to L/min)
    dt = float(t[1] - t[0])
    flow_ls = np.gradient(volume_ml / 1000.0, dt)
    flow_lpm = flow_ls * 60.0
    flow_lpm = flow_lpm * max(0.7, 1.0 - 0.01 * (R - 10.0) - 0.5 * leak) + sim_pulse * 0.4
    flow_lpm = _lowpass(flow_lpm, fs, cutoff_hz=6.0)
    flow_ls = flow_lpm / 60.0

    # Pressure model (cmH2O): PEEP + elastic + resistive
    # Elastic term uses compliance (mL/cmH2O): Pelastic = V/C.
    pressure = peep + (volume_ml / max(5.0, C)) + (R * flow_ls)
    pressure = _lowpass(pressure, fs, cutoff_hz=6.0)

    noise_pct = float(req.sensor_noise_pct) if req.sensor_noise_pct is not None else 0.0
    if noise_pct > 0.0:
        rng = np.random.default_rng(7)
        p_scale = max(1.0, float(np.max(np.abs(pressure))))
        f_scale = max(1.0, float(np.max(np.abs(flow_lpm))))
        v_scale = max(1.0, float(np.max(np.abs(volume_ml))))
        pressure = pressure + rng.normal(0.0, (noise_pct / 100.0) * p_scale, size=pressure.shape)
        flow_lpm = flow_lpm + rng.normal(0.0, (noise_pct / 100.0) * f_scale, size=flow_lpm.shape)
        volume_ml = volume_ml + rng.normal(0.0, (noise_pct / 100.0) * v_scale, size=volume_ml.shape)

    pressure_data = [{"t": float(tt), "y": float(pp)} for tt, pp in zip(t, pressure)]
    flow_data = [{"t": float(tt), "y": float(ff)} for tt, ff in zip(t, flow_lpm)]
    volume_data = [{"t": float(tt), "y": float(vv)} for tt, vv in zip(t, volume_ml)]

    # Predicted summary metrics
    pip = float(np.max(pressure))
    vt_ml = float(np.max(volume_ml) - np.min(volume_ml))
    ve_l_min = float((vt_ml / 1000.0) * rr_hz * 60.0)

    return {
        "pressureData": pressure_data,
        "flowData": flow_data,
        "volumeData": volume_data,
        "predicted": {"pip": round(pip, 1), "vt": round(vt_ml, 0), "ve": round(ve_l_min, 1)},
        "meta": {"fs_hz": fs, "duration_s": duration, "scipy": _signal is not None},
    }
