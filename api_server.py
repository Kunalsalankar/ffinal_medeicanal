import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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
