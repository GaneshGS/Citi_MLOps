# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Model routes for the Citi-centric Studio build (no local cache scans / torch stack).

Same URL surface as the historical ``routes.models``; responses are empty or
carry ``citi_api_placeholder`` hints for Model Garden integration.
"""

from fastapi import APIRouter, Depends, Query

from auth.authentication import get_current_subject
from models import (
    CheckpointListResponse,
    ModelDetails,
    ModelListResponse,
    LoRAScanResponse,
)
from models.models import (
    GgufVariantsResponse,
)
from models.responses import (
    EmbeddingCheckResponse,
    LoRABaseModelResponse,
    VisionCheckResponse,
)
from utils.local_ml import CITI_EXTERNAL_API_PLACEHOLDER

router = APIRouter()

_PLACEHOLDER_CONFIG = {
    "_citi_api_placeholder": True,
    "_message": CITI_EXTERNAL_API_PLACEHOLDER,
}


@router.get("/list")
async def list_models(
    current_subject: str = Depends(get_current_subject),
):
    return ModelListResponse(models = [], default_models = [])


@router.get("/config/{model_name:path}")
async def get_model_config(
    model_name: str,
    hf_token: str | None = Query(None),
    current_subject: str = Depends(get_current_subject),
):
    return ModelDetails(
        id = model_name,
        model_name = model_name,
        name = model_name.split("/")[-1] if "/" in model_name else model_name,
        config = _PLACEHOLDER_CONFIG,
        is_vision = False,
        is_embedding = False,
        is_lora = False,
        is_gguf = False,
        is_audio = False,
        audio_type = None,
        has_audio_input = False,
        model_type = "text",
        base_model = None,
        max_position_embeddings = None,
        model_size_bytes = None,
    )


@router.get("/loras")
async def scan_loras(
    outputs_dir: str = Query(default = "."),
    current_subject: str = Depends(get_current_subject),
):
    return LoRAScanResponse(loras = [], outputs_dir = outputs_dir)


@router.get("/loras/{lora_path:path}/base-model", response_model = LoRABaseModelResponse)
async def get_lora_base_model(
    lora_path: str,
    current_subject: str = Depends(get_current_subject),
):
    return LoRABaseModelResponse(lora_path = lora_path, base_model = "")


@router.get("/check-vision/{model_name:path}", response_model = VisionCheckResponse)
async def check_vision(
    model_name: str,
    current_subject: str = Depends(get_current_subject),
):
    return VisionCheckResponse(model_name = model_name, is_vision = False)


@router.get("/check-embedding/{model_name:path}", response_model = EmbeddingCheckResponse)
async def check_embedding(
    model_name: str,
    current_subject: str = Depends(get_current_subject),
):
    return EmbeddingCheckResponse(model_name = model_name, is_embedding = False)


@router.get("/gguf-variants", response_model = GgufVariantsResponse)
async def list_gguf_variants(
    repo_id: str = Query(...),
    hf_token: str | None = Query(None),
    current_subject: str = Depends(get_current_subject),
):
    return GgufVariantsResponse(
        repo_id = repo_id,
        variants = [],
        has_vision = False,
        default_variant = None,
    )


@router.get("/checkpoints", response_model = CheckpointListResponse)
async def list_checkpoints(
    outputs_dir: str = Query(default = "."),
    current_subject: str = Depends(get_current_subject),
):
    return CheckpointListResponse(outputs_dir = outputs_dir, models = [])
