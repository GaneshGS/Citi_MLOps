# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""In-process dummy for GSSP `generate-pass-through` (Citi) — development / offline runs."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.responses import Response

from core.data_recipe.gssp_dummy import (
    gssp_dummy_enabled,
    gssp_openai_style_completion,
)
from loggers import get_logger

logger = get_logger(__name__)

router = APIRouter()


def _as_jsonable_body(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    return {}


@router.post(
    "/api/gssp-generation-service/v1/generate-pass-through",
    response_model = None,
)
async def gssp_pass_through(request: Request) -> Response:
    if not gssp_dummy_enabled():
        return JSONResponse(
            status_code = 503,
            content = {
                "error": {
                    "message": "GSSP dummy is disabled (STUDIO_USE_GSSP_DUMMY=0).",
                    "type": "gssp_dummy_disabled",
                }
            },
        )
    try:
        body: dict[str, Any] = _as_jsonable_body(await request.json())
    except (TypeError, ValueError) as exc:
        logger.debug("GSSP dummy: empty or non-JSON body: %s", exc)
        body = {}

    logger.info(
        "GSSP dummy pass-through (keys: %s)",
        sorted(str(k) for k in body.keys()) if body else "empty",
    )

    if body.get("stream"):
        completion = gssp_openai_style_completion(body)

        async def _sse() -> AsyncIterator[str]:
            line = f"data: {json.dumps(completion, ensure_ascii = False)}\n\n"
            yield line
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            _sse(),
            media_type = "text/event-stream",
            headers = {
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    return JSONResponse(content = gssp_openai_style_completion(body))


@router.get("/api/gssp-generation-service/healthz")
def gssp_dummy_health() -> dict[str, str]:
    if not gssp_dummy_enabled():
        return {"status": "disabled", "gssp_dummy": "off"}
    return {"status": "ok", "gssp_dummy": "on"}

