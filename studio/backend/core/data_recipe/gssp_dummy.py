# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""Optional local stand-in for the Citi GSSP pass-through API (development only).

Set ``STUDIO_USE_GSSP_DUMMY=0`` and ``STUDIO_GSSP_ENDPOINT`` (and optionally
``STUDIO_GSSP_PATH``) to call a real Citi GSSP host from the pipeline.

:func:`apply_gssp_server_provider_config` on validate/job create sets the GSSP
**endpoint**, **path**, and **API key** from the server (never from the recipe UI).

* **Auth:** ``STUDIO_GSSP_AUTH_TOKEN`` or ``STUDIO_GSSP_API_KEY``, or
  ``STUDIO_GSSP_AUTH_TOKEN_FILE`` pointing to a file whose contents are the token.

* **URL / path:** ``STUDIO_USE_GSSP_DUMMY=1`` (default) uses this process;
  otherwise ``STUDIO_GSSP_ENDPOINT`` and ``STUDIO_GSSP_PATH``.

* **Pass-through headers** (never from the recipe UI): ``STUDIO_GSSP_X_CORRELATION_ID``,
  ``STUDIO_GSSP_X_APPLICATION_ID``, ``STUDIO_GSSP_X_SOEID`` (required against a real
  host), and optionally ``STUDIO_GSSP_X_AUTHORIZATION_COIN``, ``STUDIO_GSSP_X_MODEL_NAME``,
  ``STUDIO_GSSP_X_MAX_TOKENS``. When the GSSP dummy is enabled, missing required headers
  fall back to local development placeholders.

* **Request body template:** optional ``STUDIO_GSSP_REQUEST_TEMPLATE`` (replaces any
  client ``gssp_request_template`` in ``extra_body``).

The in-process pass-through is ``routes.gssp_dummy``.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

# Default on so Training Data Recipe runs without external GSSP. Disable for
# integration with real Citi GSSP.
STUDIO_USE_GSSP_DUMMY_ENV = "STUDIO_USE_GSSP_DUMMY"
# Override base URL when no Request (e.g. tests); default matches common dev port.
STUDIO_GSSP_DUMMY_BASE_URL_ENV = "STUDIO_GSSP_DUMMY_BASE_URL"
# When STUDIO_USE_GSSP_DUMMY=0, the pipeline calls this host (Citi GSSP) — not from UI.
STUDIO_GSSP_ENDPOINT_ENV = "STUDIO_GSSP_ENDPOINT"
# Pass-through path (must match the route your GSSP service exposes).
STUDIO_GSSP_PATH_ENV = "STUDIO_GSSP_PATH"
# Bearer / API key for upstream GSSP (not from the Studio UI). `STUDIO_GSSP_API_KEY` is a synonym.
STUDIO_GSSP_AUTH_TOKEN_ENV = "STUDIO_GSSP_AUTH_TOKEN"
STUDIO_GSSP_API_KEY_ENV = "STUDIO_GSSP_API_KEY"
# Optional: read secret from a file (e.g. K8s secret mount). If set, overrides env token.
STUDIO_GSSP_AUTH_TOKEN_FILE_ENV = "STUDIO_GSSP_AUTH_TOKEN_FILE"
DEFAULT_GSSP_PATH = "/api/gssp-generation-service/v1/generate-pass-through"
# GSSP pass-through HTTP headers and template (server only; not from Studio UI).
STUDIO_GSSP_X_CORRELATION_ID_ENV = "STUDIO_GSSP_X_CORRELATION_ID"
STUDIO_GSSP_X_APPLICATION_ID_ENV = "STUDIO_GSSP_X_APPLICATION_ID"
STUDIO_GSSP_X_SOEID_ENV = "STUDIO_GSSP_X_SOEID"
STUDIO_GSSP_X_AUTHORIZATION_COIN_ENV = "STUDIO_GSSP_X_AUTHORIZATION_COIN"
STUDIO_GSSP_X_MODEL_NAME_ENV = "STUDIO_GSSP_X_MODEL_NAME"
STUDIO_GSSP_X_MAX_TOKENS_ENV = "STUDIO_GSSP_X_MAX_TOKENS"
STUDIO_GSSP_REQUEST_TEMPLATE_ENV = "STUDIO_GSSP_REQUEST_TEMPLATE"

# PDF Document QA (GSSP): prompt and JSON schema are defined only on the server.
# The Studio UI does not edit them; clients may omit or send placeholders.
GSSP_PDF_GROUNDED_QA_PROMPT = (
    "Given ONLY this chunk: {{ chunk_text }} generate one answerable question, "
    "answer, and exact supporting quote from chunk. If not answerable, skip."
)
GSSP_PDF_GROUNDED_QA_OUTPUT_FORMAT: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["question", "answer", "evidence_quote"],
    "properties": {
        "question": {"type": "string"},
        "answer": {"type": "string"},
        "evidence_quote": {"type": "string"},
    },
}


def gssp_dummy_enabled() -> bool:
    return os.environ.get(STUDIO_USE_GSSP_DUMMY_ENV, "1").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def resolve_local_base_url_for_request(request: Any) -> str:
    """Return ``http://127.0.0.1:<port>`` for the current ASGI app."""
    from urllib.parse import urlparse  # local import

    from fastapi import Request

    if not isinstance(request, Request):
        return os.environ.get(STUDIO_GSSP_DUMMY_BASE_URL_ENV, "http://127.0.0.1:8888").rstrip(
            "/"
        )

    port: Any = getattr(request.app.state, "server_port", None)
    if not isinstance(port, int) or port <= 0:
        server = request.scope.get("server")
        if (
            isinstance(server, tuple)
            and len(server) >= 2
            and isinstance(server[1], int)
            and server[1] > 0
        ):
            port = server[1]
        else:
            parsed = urlparse(str(request.base_url))
            port = parsed.port if parsed.port is not None else 8888
    return f"http://127.0.0.1:{int(port)}"


def resolve_gssp_auth_token_from_server() -> str | None:
    """
    GSSP API key is configured only on the server (env or file), never from
    the Training Data Recipe UI. Returns stripped secret or None if unset.
    """
    file_path = os.environ.get(STUDIO_GSSP_AUTH_TOKEN_FILE_ENV, "").strip()
    if file_path:
        try:
            raw = Path(file_path).read_text(encoding = "utf-8")
        except OSError:
            return None
        t = raw.strip()
        return t or None
    t = os.environ.get(STUDIO_GSSP_AUTH_TOKEN_ENV, "").strip() or os.environ.get(
        STUDIO_GSSP_API_KEY_ENV, ""
    ).strip()
    return t or None


def _is_gssp_model_provider(p: dict[str, Any]) -> bool:
    if p.get("name") == "gssp_provider":
        return True
    eb = p.get("extra_body")
    if isinstance(eb, dict) and isinstance(eb.get("gssp_path"), str) and eb.get("gssp_path"):
        return True
    return False


def _gssp_pass_through_headers_from_server() -> dict[str, str]:
    """GSSP pass-through ``extra_headers``; env-based, with dev defaults if dummy is on."""
    use_dummy = gssp_dummy_enabled()

    def pick(env_name: str, dummy_default: str) -> str:
        v = os.environ.get(env_name, "").strip()
        if v:
            return v
        if use_dummy and dummy_default:
            return dummy_default
        return ""

    raw = {
        "x-correlation-id": pick(
            STUDIO_GSSP_X_CORRELATION_ID_ENV, "studio-dummy-corr"
        ),
        "x-application-id": pick(
            STUDIO_GSSP_X_APPLICATION_ID_ENV, "studio-dummy-app"
        ),
        "x-soeid": pick(STUDIO_GSSP_X_SOEID_ENV, "studio-dummy-soeid"),
        "x-Authorization-Coin": pick(STUDIO_GSSP_X_AUTHORIZATION_COIN_ENV, ""),
        "x-model-name": pick(STUDIO_GSSP_X_MODEL_NAME_ENV, ""),
        "x-max-tokens": pick(STUDIO_GSSP_X_MAX_TOKENS_ENV, ""),
    }
    return {k: v for k, v in raw.items() if v}


def apply_gssp_server_provider_config(
    recipe: dict[str, Any],
    *,
    request: Any | None,
) -> None:
    """
    In-place: set GSSP base URL and pass-through path from server env (not from
    the Studio UI). When the dummy is enabled, point at this process; otherwise
    use ``STUDIO_GSSP_ENDPOINT`` and optional ``STUDIO_GSSP_PATH``.
    """
    gssp_touched = False
    path_from_env = os.environ.get(STUDIO_GSSP_PATH_ENV, DEFAULT_GSSP_PATH).strip() or DEFAULT_GSSP_PATH
    for p in recipe.get("model_providers") or []:
        if not isinstance(p, dict):
            continue
        if not _is_gssp_model_provider(p):
            continue
        p.pop("api_key_env", None)
        p.pop("api_key", None)
        extra_body = p.get("extra_body")
        if not isinstance(extra_body, dict):
            extra_body = {}
            p["extra_body"] = extra_body
        extra_body["gssp_path"] = path_from_env
        tmpl = os.environ.get(STUDIO_GSSP_REQUEST_TEMPLATE_ENV, "").strip()
        if tmpl:
            extra_body["gssp_request_template"] = tmpl
        else:
            extra_body.pop("gssp_request_template", None)
        p["provider_type"] = str(p.get("provider_type") or "openai")

        auth = resolve_gssp_auth_token_from_server()
        if gssp_dummy_enabled():
            if request is not None:
                base = resolve_local_base_url_for_request(request)
            else:
                base = os.environ.get(
                    STUDIO_GSSP_DUMMY_BASE_URL_ENV, "http://127.0.0.1:8888"
                ).rstrip("/")
            p["endpoint"] = base
            p["api_key"] = auth or "dummy"
        else:
            host = os.environ.get(STUDIO_GSSP_ENDPOINT_ENV, "").strip()
            if host:
                p["endpoint"] = host.rstrip("/")
            p["api_key"] = auth
        p["extra_headers"] = _gssp_pass_through_headers_from_server()
        gssp_touched = True

    if gssp_touched:
        for mc in recipe.get("model_configs") or []:
            if not isinstance(mc, dict):
                continue
            if mc.get("provider") == "gssp_provider" or (
                isinstance(mc.get("model"), str) and "gssp" in str(mc.get("model", ""))
            ):
                mc["skip_health_check"] = True


# Backwards compatible name (tests + older imports)
apply_gssp_dummy_provider_to_recipe = apply_gssp_server_provider_config


def apply_gssp_pdf_grounded_qa_llm_defaults(recipe: dict[str, Any]) -> None:
    """Set server-side prompt and response schema for GSSP structured LLM columns.

    Applies to ``llm-structured`` columns whose ``model_alias`` is ``gssp_default``
    (Training Data Recipe — PDF Document QA). Overwrites any client-supplied values.
    """
    for column in recipe.get("columns") or []:
        if not isinstance(column, dict):
            continue
        if column.get("column_type") != "llm-structured":
            continue
        alias = column.get("model_alias")
        if not isinstance(alias, str) or alias.strip() != "gssp_default":
            continue
        column["prompt"] = GSSP_PDF_GROUNDED_QA_PROMPT
        column["output_format"] = dict(GSSP_PDF_GROUNDED_QA_OUTPUT_FORMAT)


def gssp_dummy_assistant_text(body: dict[str, Any]) -> str:
    """Build assistant message string (JSON) for a dummy GSSP pass-through call."""
    rf = body.get("response_format")
    if isinstance(rf, dict):
        jso = rf.get("json_schema")
        if isinstance(jso, dict):
            inner = jso.get("json_schema")
            schema: dict[str, Any] = (
                inner if isinstance(inner, dict) else jso
            )
            props = schema.get("properties")
            req = schema.get("required")
            if isinstance(props, dict):
                out: dict[str, Any] = {}
                keys = list(req) if isinstance(req, list) else list(props.keys())
                for k in keys:
                    if not isinstance(k, str):
                        continue
                    pdef = props.get(k)
                    t = pdef.get("type", "string") if isinstance(pdef, dict) else "string"
                    if t == "integer" or t == "number":
                        out[k] = 0
                    else:
                        out[k] = f"dummy_{k}"
                if out:
                    return json.dumps(out, ensure_ascii = False)
    return json.dumps(
        {
            "question": "What is stated in the provided chunk (dummy GSSP output)?",
            "answer": (
                "Set STUDIO_USE_GSSP_DUMMY=0 in the server environment to use your "
                "real GSSP endpoint. This is a local placeholder for development."
            ),
            "evidence_quote": "dummy_quote",
        },
        ensure_ascii = False,
    )


def gssp_openai_style_completion(body: dict[str, Any]) -> dict[str, Any]:
    """Shape returned by the dummy to satisfy OpenAI-compatible clients in the engine."""
    content = gssp_dummy_assistant_text(body)
    now = int(time.time())
    return {
        "id": f"chatcmpl-gssp-dummy-{now}",
        "object": "chat.completion",
        "created": now,
        "model": str(body.get("model") or "gssp-pass-through"),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }
