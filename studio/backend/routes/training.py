# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Training API surface for the Citi-centric Studio build.

Same URL layout as the historical stack so the UI keeps working; responses
indicate that local GPU training is delegated to external orchestration.
"""

import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from auth.authentication import get_current_subject
from loggers import get_logger
from pydantic import BaseModel

from models import (
    TrainingJobResponse,
    TrainingStartRequest,
    TrainingStatus,
)
from models.responses import TrainingMetricsResponse, TrainingStopResponse
from utils.local_ml import CITI_EXTERNAL_API_PLACEHOLDER


class TrainingStopRequest(BaseModel):
    save: bool = True

logger = get_logger(__name__)

router = APIRouter()

_DISABLED = CITI_EXTERNAL_API_PLACEHOLDER


def _sse(data: str, event: str, event_id: int) -> str:
    return f"id: {event_id}\nevent: {event}\ndata: {data}\n\n"


@router.get("/hardware")
async def get_hardware_utilization(
    current_subject: str = Depends(get_current_subject),
):
    return {
        "available": False,
        "backend": None,
        "gpu_utilization_pct": None,
        "temperature_c": None,
        "vram_used_gb": None,
        "vram_total_gb": None,
        "vram_utilization_pct": None,
        "power_draw_w": None,
        "power_limit_w": None,
        "power_utilization_pct": None,
    }


@router.get("/hardware/visible")
async def get_visible_hardware_utilization(
    current_subject: str = Depends(get_current_subject),
):
    return {
        "available": False,
        "backend": None,
        "parent_visible_gpu_ids": [],
        "devices": [],
        "index_kind": "relative",
    }


@router.post("/start")
async def start_training(
    request: TrainingStartRequest,
    current_subject: str = Depends(get_current_subject),
):
    logger.info("training: rejected /start (Citi-centric build; no local trainer)")
    return TrainingJobResponse(
        job_id = "",
        status = "error",
        message = _DISABLED,
        error = "local_ml_disabled",
    )


@router.post("/stop", response_model = TrainingStopResponse)
async def stop_training(
    body: TrainingStopRequest = TrainingStopRequest(),
    current_subject: str = Depends(get_current_subject),
):
    # Same request body as full ``/stop``; ignored when local ML is off.
    _ = body.save
    return TrainingStopResponse(status = "idle", message = _DISABLED)


@router.post("/reset")
async def reset_training(
    current_subject: str = Depends(get_current_subject),
):
    return {"status": "ok"}


@router.get("/status")
async def get_training_status(
    current_subject: str = Depends(get_current_subject),
):
    return TrainingStatus(
        job_id = "",
        phase = "idle",
        is_training_running = False,
        eval_enabled = False,
        message = _DISABLED,
        error = None,
        details = None,
        metric_history = None,
    )


@router.get("/metrics", response_model = TrainingMetricsResponse)
async def get_training_metrics(
    current_subject: str = Depends(get_current_subject),
):
    return TrainingMetricsResponse()


@router.get("/progress")
async def stream_training_progress(
    request: Request,
    current_subject: str = Depends(get_current_subject),
):
    """Minimal SSE: one ``complete`` event so clients that open the stream exit cleanly."""

    idle_payload = {
        "job_id": "",
        "step": 0,
        "total_steps": 0,
        "loss": None,
        "learning_rate": None,
        "progress_percent": 0.0,
        "epoch": None,
        "elapsed_seconds": None,
        "eta_seconds": None,
        "grad_norm": None,
        "num_tokens": None,
        "eval_loss": None,
    }

    async def gen() -> AsyncIterator[str]:
        yield _sse(json.dumps(idle_payload), "complete", 0)

    return StreamingResponse(
        gen(),
        media_type = "text/event-stream",
        headers = {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
