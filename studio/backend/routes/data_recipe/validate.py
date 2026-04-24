# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""Validation endpoints for data recipe."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from core.data_recipe.service import (
    build_config_builder,
    create_data_designer,
    validate_recipe,
)
from models.data_recipe import RecipePayload, ValidateError, ValidateResponse

router = APIRouter()


def _collect_validation_errors(recipe: dict[str, Any]) -> list[ValidateError]:
    try:
        from data_designer.engine.compiler import (
            _add_internal_row_id_column_if_needed,
            _get_allowed_references,
            _resolve_and_add_seed_columns,
        )
        from data_designer.engine.validation import (
            ViolationLevel,
            validate_data_designer_config,
        )
    except ImportError:
        return []

    try:
        builder = build_config_builder(recipe)
        designer = create_data_designer(recipe)
        resource_provider = designer._create_resource_provider(  # type: ignore[attr-defined]
            "validate-configuration",
            builder,
        )
        config = builder.build()
        _resolve_and_add_seed_columns(config, resource_provider.seed_reader)
        _add_internal_row_id_column_if_needed(config)
        violations = validate_data_designer_config(
            columns = config.columns,
            processor_configs = config.processors or [],
            allowed_references = _get_allowed_references(config),
        )
    except (TypeError, ValueError, AttributeError):
        return []

    errors: list[ValidateError] = []
    for violation in violations:
        if violation.level != ViolationLevel.ERROR:
            continue
        code = getattr(violation.type, "value", None)
        path = violation.column if violation.column else None
        message = str(violation.message).strip() or "Validation failed."
        errors.append(
            ValidateError(
                message = message,
                path = path,
                code = code,
            )
        )
    return errors


def _preflight_guidance(recipe: dict[str, Any]) -> list[ValidateError]:
    errors: list[ValidateError] = []
    seed_config = recipe.get("seed_config")
    model_providers = recipe.get("model_providers") or []
    model_configs = recipe.get("model_configs") or []
    columns = recipe.get("columns") or []

    if isinstance(seed_config, dict):
        source = seed_config.get("source")
        if isinstance(source, dict) and source.get("seed_type") == "unstructured":
            path = source.get("path")
            if not isinstance(path, str) or not path.strip():
                errors.append(
                    ValidateError(
                        message = "Missing seed source file for unstructured input.",
                        code = "missing_seed_path",
                        hint = "Upload at least one PDF or document in the Seed block.",
                        field_path = "recipe.seed_config.source.path",
                        block_name = "seed",
                    )
                )

    provider_by_name = {
        provider.get("name"): provider
        for provider in model_providers
        if isinstance(provider, dict) and isinstance(provider.get("name"), str)
    }
    for model_config in model_configs:
        if not isinstance(model_config, dict):
            continue
        provider_name = model_config.get("provider")
        alias = model_config.get("alias")
        model = model_config.get("model")
        provider = provider_by_name.get(provider_name)
        if isinstance(provider_name, str) and isinstance(provider, dict):
            endpoint = provider.get("endpoint")
            if not isinstance(endpoint, str) or not endpoint.strip():
                errors.append(
                    ValidateError(
                        message = f"Model provider '{provider_name}' is missing an endpoint.",
                        code = "missing_provider_endpoint",
                        hint = "Set the GSSP endpoint URL in your model provider.",
                        field_path = "recipe.model_providers[].endpoint",
                        block_name = provider_name,
                    )
                )
            api_key = provider.get("api_key")
            api_key_env = provider.get("api_key_env")
            if (not isinstance(api_key, str) or not api_key.strip()) and (
                not isinstance(api_key_env, str) or not api_key_env.strip()
            ):
                errors.append(
                    ValidateError(
                        message = f"Model provider '{provider_name}' is missing API credentials.",
                        code = "missing_provider_api_key",
                        hint = "Set a GSSP API key or API key env var for this provider.",
                        field_path = "recipe.model_providers[].api_key",
                        block_name = provider_name,
                    )
                )
            extra_headers = provider.get("extra_headers")
            extra_body = provider.get("extra_body")
            is_gssp_provider = (
                isinstance(extra_body, dict)
                and isinstance(extra_body.get("gssp_path"), str)
            ) or (
                isinstance(endpoint, str)
                and "gssp-generation-service" in endpoint
            )
            if is_gssp_provider and isinstance(extra_headers, dict):
                mandatory_headers = {
                    "x-correlation-id": "missing_gssp_correlation_id",
                    "x-application-id": "missing_gssp_application_id",
                    "x-soeid": "missing_gssp_soeid",
                }
                for header_name, code in mandatory_headers.items():
                    value = extra_headers.get(header_name)
                    if not isinstance(value, str) or not value.strip():
                        errors.append(
                            ValidateError(
                                message = (
                                    f"GSSP provider '{provider_name}' is missing "
                                    f"required header '{header_name}'."
                                ),
                                code = code,
                                hint = (
                                    "Set required GSSP headers in Seed -> "
                                    "Advanced source options."
                                ),
                                field_path = "recipe.model_providers[].extra_headers",
                                block_name = provider_name,
                            )
                        )
        if not isinstance(model, str) or not model.strip():
            errors.append(
                ValidateError(
                    message = f"Model config '{alias or 'model_config'}' is missing deployment/model ID.",
                    code = "missing_model_deployment",
                    hint = "Set the GSSP deployment/model ID in your model config.",
                    field_path = "recipe.model_configs[].model",
                    block_name = str(alias) if isinstance(alias, str) else None,
                )
            )

    for column in columns:
        if not isinstance(column, dict):
            continue
        if column.get("column_type") != "llm-structured":
            continue
        name = str(column.get("name") or "llm_structured")
        prompt = column.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            errors.append(
                ValidateError(
                    message = f"Structured LLM block '{name}' is missing a prompt.",
                    code = "missing_prompt",
                    hint = "Add instructions that define the question/answer extraction behavior.",
                    field_path = "recipe.columns[].prompt",
                    block_name = name,
                )
            )
        output_format = column.get("output_format")
        if not isinstance(output_format, dict) or not output_format:
            errors.append(
                ValidateError(
                    message = f"Structured LLM block '{name}' is missing a response schema.",
                    code = "missing_output_schema",
                    hint = "Define a structured JSON schema with required fields.",
                    field_path = "recipe.columns[].output_format",
                    block_name = name,
                )
            )
    return errors


def _dedupe_validation_errors(errors: list[ValidateError]) -> list[ValidateError]:
    deduped: list[ValidateError] = []
    seen: set[tuple[str, str | None, str | None]] = set()
    for error in errors:
        key = (error.message.strip(), error.code, error.field_path)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(error)
    return deduped


def _patch_local_providers(recipe: dict[str, Any]) -> None:
    """Strip is_local and fill a dummy endpoint so validation doesn't choke.

    Uses a strict `is True` check to match _inject_local_providers in
    jobs.py - malformed payloads with truthy but non-boolean is_local
    values should not be treated as local.
    """
    for provider in recipe.get("model_providers", []):
        if not isinstance(provider, dict):
            continue
        if provider.pop("is_local", None) is True:
            provider["endpoint"] = "http://127.0.0.1"


@router.post("/validate", response_model = ValidateResponse)
def validate(payload: RecipePayload) -> ValidateResponse:
    recipe = payload.recipe
    if not recipe.get("columns"):
        return ValidateResponse(
            valid = False,
            errors = [ValidateError(message = "Recipe must include columns.")],
        )

    _patch_local_providers(recipe)

    try:
        validate_recipe(recipe)
    except RuntimeError as exc:
        raise HTTPException(status_code = 503, detail = str(exc)) from exc
    except Exception as exc:
        detail = str(exc).strip() or "Validation failed."
        parsed_errors = _collect_validation_errors(recipe)
        parsed_errors.extend(_preflight_guidance(recipe))
        return ValidateResponse(
            valid = False,
            errors = _dedupe_validation_errors(parsed_errors)
            or [ValidateError(message = detail)],
            raw_detail = detail,
        )

    guidance = _preflight_guidance(recipe)
    if guidance:
        return ValidateResponse(
            valid = False,
            errors = _dedupe_validation_errors(guidance),
        )
    return ValidateResponse(valid = True)
