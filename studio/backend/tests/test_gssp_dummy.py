# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import json
import os
from typing import Any

from core.data_recipe.gssp_dummy import (
    GSSP_PDF_GROUNDED_QA_PROMPT,
    apply_gssp_pdf_grounded_qa_llm_defaults,
    apply_gssp_server_provider_config,
    gssp_dummy_enabled,
    gssp_openai_style_completion,
)


def test_gssp_dummy_default_enabled() -> None:
    os.environ.pop("STUDIO_USE_GSSP_DUMMY", None)
    assert gssp_dummy_enabled() is True
    os.environ["STUDIO_USE_GSSP_DUMMY"] = "0"
    assert gssp_dummy_enabled() is False


def test_apply_gssp_dummy_rewrites_and_headers() -> None:
    os.environ["STUDIO_USE_GSSP_DUMMY"] = "1"
    os.environ["STUDIO_GSSP_DUMMY_BASE_URL"] = "http://127.0.0.1:7777"
    recipe = {
        "model_providers": [
            {
                "name": "gssp_provider",
                "endpoint": "https://real-gssp.example.com",
                "provider_type": "openai",
                "api_key": "",
                "extra_body": {
                    "gssp_path": "/api/gssp-generation-service/v1/generate-pass-through",
                },
                "extra_headers": {},
            }
        ],
        "model_configs": [
            {
                "alias": "gssp_default",
                "model": "gssp-pass-through",
                "provider": "gssp_provider",
            }
        ],
    }
    apply_gssp_server_provider_config(recipe, request = None)
    assert recipe["model_providers"][0]["endpoint"] == "http://127.0.0.1:7777"
    assert recipe["model_providers"][0]["api_key"] == "dummy"
    h = recipe["model_providers"][0]["extra_headers"]
    assert h.get("x-correlation-id")
    assert recipe["model_configs"][0].get("skip_health_check") is True

    # Disabled: no rewrite
    os.environ["STUDIO_USE_GSSP_DUMMY"] = "0"
    recipe2 = {
        "model_providers": [
            {
                "name": "gssp_provider",
                "endpoint": "https://keep.example",
                "extra_body": {"gssp_path": "/p"},
            }
        ]
    }
    apply_gssp_server_provider_config(recipe2, request = None)
    assert recipe2["model_providers"][0]["endpoint"] == "https://keep.example"


def test_apply_gssp_pdf_grounded_qa_llm_defaults() -> None:
    recipe: dict[str, Any] = {
        "columns": [
            {
                "column_type": "llm-structured",
                "name": "llm_structured_1",
                "model_alias": "gssp_default",
                "prompt": "",
            },
        ]
    }
    apply_gssp_pdf_grounded_qa_llm_defaults(recipe)
    col = recipe["columns"][0]
    assert col["prompt"] == GSSP_PDF_GROUNDED_QA_PROMPT
    assert col["output_format"].get("type") == "object"


def test_gssp_openai_shape() -> None:
    body: dict[str, Any] = {"model": "gssp-pass-through", "messages": []}
    out = gssp_openai_style_completion(body)
    assert "choices" in out
    assert out["choices"][0]["message"]["role"] == "assistant"
    text = out["choices"][0]["message"]["content"]
    assert "dummy" in text.lower() or "question" in text

    with_schema = gssp_openai_style_completion(
        {
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "a",
                    "json_schema": {
                        "type": "object",
                        "properties": {
                            "a": {"type": "string"},
                        },
                        "required": ["a"],
                    },
                },
            }
        }
    )
    content = with_schema["choices"][0]["message"]["content"]
    data = json.loads(content)
    assert "a" in data
