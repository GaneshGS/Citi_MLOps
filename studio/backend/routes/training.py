# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Training API surface for the Citi-centric Studio build.

Same URL layout as the historical stack so the UI keeps working; responses
indicate that local GPU training is delegated to external orchestration.
"""

import json
from datetime import datetime, timezone
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


class StellarDatasetRegistryRequest(BaseModel):
    train_dataset_path: str
    test_dataset_path: str | None = None


class StellarDatasetRegistryResponse(BaseModel):
    status: str
    train_dataset_id: str
    test_dataset_id: str | None
    message: str


class StellarFinetuneRequest(BaseModel):
    model_name: str
    model_catalog: str
    method: str
    train_dataset_id: str
    test_dataset_id: str | None = None
    hyperparameters: dict

logger = get_logger(__name__)

router = APIRouter()

_DISABLED = CITI_EXTERNAL_API_PLACEHOLDER


def _dummy_stellar_id(prefix: str, source: str) -> str:
    seed = source.replace("/", "_").replace("\\", "_").replace(".", "_")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"stellar_{prefix}_{seed}_{ts}"


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


@router.post("/stellar/datasets/register", response_model=StellarDatasetRegistryResponse)
async def register_stellar_datasets(
    request: StellarDatasetRegistryRequest,
    current_subject: str = Depends(get_current_subject),
):
    train_id = _dummy_stellar_id("train", request.train_dataset_path)
    test_id = (
        _dummy_stellar_id("test", request.test_dataset_path)
        if request.test_dataset_path
        else None
    )
    return StellarDatasetRegistryResponse(
        status="ok",
        train_dataset_id=train_id,
        test_dataset_id=test_id,
        message="Dummy Stellar registry: dataset IDs generated locally.",
    )


@router.post("/stellar/finetune/start")
async def start_stellar_finetune(
    request: StellarFinetuneRequest,
    current_subject: str = Depends(get_current_subject),
):
    logger.info(
        "stellar finetune dummy start model=%s catalog=%s method=%s train_id=%s",
        request.model_name,
        request.model_catalog,
        request.method,
        request.train_dataset_id,
    )
    return TrainingJobResponse(
        job_id=f"stellar_job_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        status="queued",
        message="Dummy Stellar finetuning request accepted.",
        error=None,
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
