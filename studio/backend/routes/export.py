# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Export routes for the Citi-centric Studio build (no local export subprocess).

Same paths as the historical ``routes.export``; operations return ``success=False``
with ``citi_api_placeholder`` in ``details`` until Stellar / export APIs are wired.
"""

import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from auth.authentication import get_current_subject
from loggers import get_logger
from models import (
    ExportMergedModelRequest,
    ExportBaseModelRequest,
    ExportGGUFRequest,
    ExportLoRAAdapterRequest,
    LoadCheckpointRequest,
    ExportOperationResponse,
    ExportStatusResponse,
)
from utils.local_ml import CITI_EXTERNAL_API_PLACEHOLDER

logger = get_logger(__name__)
router = APIRouter()

_DETAILS = {"citi_api_placeholder": True}


def _noop_op() -> ExportOperationResponse:
    return ExportOperationResponse(
        success = False,
        message = CITI_EXTERNAL_API_PLACEHOLDER,
        details = _DETAILS,
    )


def _format_sse(data: str, event: str, event_id: int = 0) -> str:
    lines = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    lines.append(f"data: {data}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


@router.post("/load-checkpoint", response_model = ExportOperationResponse)
async def load_checkpoint(
    request: LoadCheckpointRequest,
    current_subject: str = Depends(get_current_subject),
):
    return _noop_op()


@router.post("/cleanup", response_model = ExportOperationResponse)
async def cleanup_export(
    current_subject: str = Depends(get_current_subject),
):
    return _noop_op()


@router.get("/status", response_model = ExportStatusResponse)
async def get_export_status(
    current_subject: str = Depends(get_current_subject),
):
    return ExportStatusResponse(
        current_checkpoint = None,
        is_vision = False,
        is_peft = False,
    )


@router.post("/export/merged", response_model = ExportOperationResponse)
async def export_merged(
    request: ExportMergedModelRequest,
    current_subject: str = Depends(get_current_subject),
):
    return _noop_op()


@router.post("/export/base", response_model = ExportOperationResponse)
async def export_base(
    request: ExportBaseModelRequest,
    current_subject: str = Depends(get_current_subject),
):
    return _noop_op()


@router.post("/export/gguf", response_model = ExportOperationResponse)
async def export_gguf(
    request: ExportGGUFRequest,
    current_subject: str = Depends(get_current_subject),
):
    return _noop_op()


@router.post("/export/lora", response_model = ExportOperationResponse)
async def export_lora(
    request: ExportLoRAAdapterRequest,
    current_subject: str = Depends(get_current_subject),
):
    return _noop_op()


@router.get("/logs/stream")
async def stream_export_logs(
    request: Request,
    since: int | None = None,
    current_subject: str = Depends(get_current_subject),
):
    async def gen() -> AsyncIterator[str]:
        yield "retry: 3000\n\n"
        yield _format_sse(
            json.dumps({"stream": "stdout", "line": CITI_EXTERNAL_API_PLACEHOLDER, "ts": None}),
            event = "log",
            event_id = 1,
        )
        yield _format_sse("{}", event = "complete", event_id = 2)

    return StreamingResponse(
        gen(),
        media_type = "text/event-stream",
        headers = {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
