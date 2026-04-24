# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Inference API surface for the Citi-centric Studio build: no llama-server, no
local GGUF weights. Same URL layout as the historical full stack (including
``/v1``); chat and completion endpoints return SSE or JSON placeholders for
GSSP / Model Garden wiring.
"""

import json
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from auth.authentication import get_current_subject
from loggers import get_logger
from models.inference import (
    GenerateRequest,
    InferenceStatusResponse,
    LoadProgressResponse,
    LoadRequest,
    LoadResponse,
    UnloadRequest,
    UnloadResponse,
    ValidateModelRequest,
    ValidateModelResponse,
)
from utils.local_ml import CITI_EXTERNAL_API_PLACEHOLDER

logger = get_logger(__name__)
router = APIRouter()

_DEFAULT_INFERENCE = {
    "temperature": 0.6,
    "top_p": 0.95,
    "top_k": 20,
    "min_p": 0.0,
}


def _sse_error(msg: str) -> StreamingResponse:
    async def gen() -> AsyncIterator[str]:
        yield f"data: {json.dumps({'error': {'message': msg}})}\n\n"

    return StreamingResponse(
        gen(),
        media_type = "text/event-stream",
        headers = {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _openai_error_json(status: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code = status,
        content = {
            "error": {
                "message": message,
                "type": "citi_api_placeholder",
                "code": "local_ml_disabled",
            }
        },
    )


@router.post("/load", response_model = LoadResponse)
async def load_model(
    request: LoadRequest,
    current_subject: str = Depends(get_current_subject),
):
    return LoadResponse(
        status = "unavailable",
        model = request.model_path,
        display_name = request.model_path,
        is_vision = False,
        is_lora = False,
        is_gguf = False,
        is_audio = False,
        audio_type = None,
        has_audio_input = False,
        inference = {**_DEFAULT_INFERENCE, "_citi_api_placeholder": True},
        requires_trust_remote_code = False,
        context_length = None,
        max_context_length = None,
        native_context_length = None,
        supports_reasoning = False,
        reasoning_style = "enable_thinking",
        reasoning_always_on = False,
        supports_preserve_thinking = False,
        supports_tools = False,
        cache_type_kv = None,
        chat_template = None,
        speculative_type = None,
    )


@router.post("/validate", response_model = ValidateModelResponse)
async def validate_model(
    request: ValidateModelRequest,
    current_subject: str = Depends(get_current_subject),
):
    return ValidateModelResponse(
        valid = False,
        message = CITI_EXTERNAL_API_PLACEHOLDER,
        identifier = request.model_path,
        display_name = request.model_path,
        is_gguf = False,
        is_lora = False,
        is_vision = False,
        requires_trust_remote_code = False,
    )


@router.post("/unload", response_model = UnloadResponse)
async def unload_model(
    request: UnloadRequest,
    current_subject: str = Depends(get_current_subject),
):
    return UnloadResponse(status = "idle", model = request.model_path)


@router.post("/generate/stream")
async def generate_stream(
    request: GenerateRequest,
    current_subject: str = Depends(get_current_subject),
):
    return _sse_error(CITI_EXTERNAL_API_PLACEHOLDER)


@router.get("/status", response_model = InferenceStatusResponse)
async def get_status(
    current_subject: str = Depends(get_current_subject),
):
    return InferenceStatusResponse(
        active_model = None,
        is_vision = False,
        is_gguf = False,
        gguf_variant = None,
        is_audio = False,
        audio_type = None,
        has_audio_input = False,
        loading = [],
        loaded = [],
        inference = None,
        requires_trust_remote_code = False,
        supports_reasoning = False,
        reasoning_style = "enable_thinking",
        reasoning_always_on = False,
        supports_preserve_thinking = False,
        supports_tools = False,
        context_length = None,
        max_context_length = None,
        native_context_length = None,
        speculative_type = None,
    )


@router.get("/load-progress", response_model = LoadProgressResponse)
async def get_load_progress(
    current_subject: str = Depends(get_current_subject),
):
    return LoadProgressResponse()


@router.post("/audio/generate")
async def audio_generate(
    request: Request,
    current_subject: str = Depends(get_current_subject),
):
    return _openai_error_json(503, CITI_EXTERNAL_API_PLACEHOLDER)


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    current_subject: str = Depends(get_current_subject),
):
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        body = {}
    if body.get("stream", True):
        return _sse_error(CITI_EXTERNAL_API_PLACEHOLDER)
    return _openai_error_json(503, CITI_EXTERNAL_API_PLACEHOLDER)


@router.get("/sandbox/{session_id}/{filename}")
async def sandbox_file(
    session_id: str,
    filename: str,
    current_subject: str = Depends(get_current_subject),
):
    return Response(status_code = 404)


@router.get("/models")
async def openai_list_models(
    current_subject: str = Depends(get_current_subject),
):
    return {
        "object": "list",
        "data": [],
        "citi_api_placeholder": True,
        "message": CITI_EXTERNAL_API_PLACEHOLDER,
    }


@router.post("/completions")
async def openai_completions(
    request: Request,
    current_subject: str = Depends(get_current_subject),
):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if body.get("stream", False):
        return _sse_error(CITI_EXTERNAL_API_PLACEHOLDER)
    return _openai_error_json(503, CITI_EXTERNAL_API_PLACEHOLDER)


@router.post("/embeddings")
async def openai_embeddings(
    request: Request,
    current_subject: str = Depends(get_current_subject),
):
    return _openai_error_json(503, CITI_EXTERNAL_API_PLACEHOLDER)


@router.post("/responses")
async def openai_responses(
    request: Request,
    current_subject: str = Depends(get_current_subject),
):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if body.get("stream", False):
        return _sse_error(CITI_EXTERNAL_API_PLACEHOLDER)
    return _openai_error_json(503, CITI_EXTERNAL_API_PLACEHOLDER)


@router.post("/messages")
async def openai_messages(
    request: Request,
    current_subject: str = Depends(get_current_subject),
):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if body.get("stream", False):
        return _sse_error(CITI_EXTERNAL_API_PLACEHOLDER)
    return _openai_error_json(503, CITI_EXTERNAL_API_PLACEHOLDER)


class LlamaCppBackendStub:
    """Satisfies callers that only check load flags; no llama subprocess."""

    is_loaded = False
    is_vision = False
    model_identifier: Optional[str] = None

    def _kill_process(self) -> None:
        return None


_llama_cpp_backend = LlamaCppBackendStub()


def get_llama_cpp_backend() -> LlamaCppBackendStub:
    return _llama_cpp_backend
