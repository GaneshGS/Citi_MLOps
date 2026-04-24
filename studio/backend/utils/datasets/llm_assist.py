# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
LLM-assisted dataset analysis (optional helper completions).

In the Citi-centric build there is no local GGUF helper; callers receive None
and heuristics in format_detection.py / vlm_processing.py carry the load.
"""

import json
import os
import re
import textwrap
from itertools import islice
from typing import Any, Optional

from loggers import get_logger

logger = get_logger(__name__)

DEFAULT_HELPER_MODEL_REPO = "unsloth/gemma-4-E2B-it-GGUF"
DEFAULT_HELPER_MODEL_VARIANT = "UD-Q4_K_XL"

README_MAX_CHARS = 1500


def _strip_think_tags(text: str) -> str:
    """Strip <think>...</think> reasoning blocks emitted by some models.

    If the model places its actual answer OUTSIDE the think block, we
    discard the think block and keep the rest.  If the entire response
    is INSIDE a think block (nothing useful outside), we extract and
    return the inner content instead of discarding everything.
    """
    if "<think>" not in text:
        return text

    # Try stripping think blocks — keep content outside them
    stripped = re.sub(r"<think>.*?</think>\s*", "", text, flags = re.DOTALL).strip()
    if stripped:
        return stripped

    # Everything was inside <think> tags — extract the inner content of the last block
    matches = re.findall(r"<think>(.*?)</think>", text, flags = re.DOTALL)
    if matches:
        return matches[-1].strip()

    return text


def precache_helper_gguf():
    """No-op: local helper GGUF is not used in the Citi-centric build."""
    return


def _run_with_helper(_prompt: str, _max_tokens: int = 256) -> Optional[str]:
    """
    Load helper model, run one chat completion, unload.

    Returns the completion text, or None on any failure.
    """
    return None


# ─── Public API ───────────────────────────────────────────────────────


def llm_generate_vlm_instruction(
    column_names: list[str],
    samples: list[dict],
    dataset_name: Optional[str] = None,
) -> Optional[dict]:
    """
    Ask a helper LLM to generate a task-specific VLM instruction.

    Called when heuristic instruction generation returns low confidence
    or falls back to generic.

    Args:
        column_names: Column names in the dataset.
        samples: 3-5 sample rows with text values (images replaced by "<image>").
        dataset_name: Optional HF dataset identifier for context.

    Returns:
        {"instruction": str, "confidence": 0.85} or None.
    """
    # Format samples for the prompt
    formatted = ""
    for i, row in enumerate(samples[:5], 1):
        parts = []
        for col in column_names:
            val = str(row.get(col, ""))[:300]
            parts.append(f"  {col}: {val}")
        formatted += f"Sample {i}:\n" + "\n".join(parts) + "\n\n"

    prompt = (
        "You are a dataset analyst. Given a vision-language dataset, generate ONE "
        "instruction sentence that describes what the model should do with each image.\n\n"
        f"Dataset: {dataset_name or 'unknown'}\n"
        f"Columns: {column_names}\n\n"
        f"{formatted}"
        "Write ONE instruction sentence. Examples:\n"
        '- "Solve the math problem shown in the image and explain your reasoning."\n'
        '- "Transcribe all text visible in this image."\n'
        '- "Answer the question about this image."\n\n'
        "Respond with ONLY the instruction sentence, nothing else."
    )

    result = _run_with_helper(prompt, max_tokens = 100)
    if not result:
        return None

    # Clean up: strip quotes, ensure it's a single sentence
    instruction = result.strip().strip('"').strip("'").strip()
    # Reject obviously bad outputs (too short, too long, or multi-line)
    if len(instruction) < 10 or len(instruction) > 200 or "\n" in instruction:
        logger.warning(f"Helper model returned unusable instruction: {instruction!r}")
        return None

    logger.info(f"LLM-generated instruction: {instruction}")
    return {
        "instruction": instruction,
        "confidence": 0.85,
    }


def llm_classify_columns(
    column_names: list[str],
    samples: list[dict],
) -> Optional[dict[str, str]]:
    """
    Ask a helper LLM to classify dataset columns into roles.

    Called when heuristic column detection fails (returns None).

    Args:
        column_names: Column names in the dataset.
        samples: 3-5 sample rows with values truncated to 200 chars.

    Returns:
        Dict mapping column_name → role ("user"|"assistant"|"system"|"metadata"),
        or None on failure.
    """
    formatted = ""
    for i, row in enumerate(samples[:5], 1):
        parts = []
        for col in column_names:
            val = str(row.get(col, ""))[:200]
            parts.append(f"  {col}: {val}")
        formatted += f"Sample {i}:\n" + "\n".join(parts) + "\n\n"

    prompt = (
        "Classify each column in this dataset into one of these roles:\n"
        "- user: The input/question/prompt from the human\n"
        "- assistant: The expected output/answer/response from the AI\n"
        "- system: Context, persona, or task description\n"
        "- metadata: IDs, scores, labels, timestamps — not part of conversation\n\n"
        f"Columns: {column_names}\n\n"
        f"{formatted}"
        "Respond with ONLY a JSON object mapping column names to roles.\n"
        'Example: {"question": "user", "answer": "assistant", "id": "metadata"}'
    )

    result = _run_with_helper(prompt, max_tokens = 200)
    if not result:
        return None

    # Parse JSON from response (may have markdown fences)
    text = result.strip()
    if text.startswith("```"):
        # Strip markdown code fence
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        text = text.strip()

    try:
        mapping = json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object in the response
        import re

        match = re.search(r"\{[^}]+\}", text)
        if match:
            try:
                mapping = json.loads(match.group())
            except json.JSONDecodeError:
                logger.warning(f"Could not parse helper model JSON: {text!r}")
                return None
        else:
            logger.warning(f"No JSON found in helper model response: {text!r}")
            return None

    if not isinstance(mapping, dict):
        return None

    # Validate: all values must be valid roles
    valid_roles = {"user", "assistant", "system", "metadata"}
    cleaned = {}
    for col, role in mapping.items():
        if (
            col in column_names
            and isinstance(role, str)
            and role.lower() in valid_roles
        ):
            cleaned[col] = role.lower()

    if not cleaned:
        return None

    # Must have at least user + assistant
    roles_present = set(cleaned.values())
    if "user" not in roles_present or "assistant" not in roles_present:
        logger.warning(f"Helper model mapping missing user/assistant: {cleaned}")
        return None

    logger.info(f"LLM-classified columns: {cleaned}")
    return cleaned


def llm_generate_dataset_warning(
    issues: list[str],
    dataset_name: Optional[str] = None,
    modality: str = "text",
    column_names: Optional[list[str]] = None,
) -> Optional[str]:
    """
    Ask the helper LLM to turn technical dataset issues into a user-friendly warning.

    Works for all modalities (text, vision, audio).

    Args:
        issues: List of technical issue descriptions found during analysis.
        dataset_name: Optional HF dataset name.
        modality: "text", "vision", or "audio".
        column_names: Optional list of column names for context.

    Returns:
        A human-friendly warning string, or None on failure.
    """
    if not issues:
        return None

    issues_text = "\n".join(f"- {issue}" for issue in issues)
    cols_text = f"\nColumns: {column_names}" if column_names else ""

    prompt = (
        "You are a helpful assistant. A user is trying to fine-tune a model on a dataset.\n"
        "The following issues were found during dataset analysis:\n\n"
        f"{issues_text}\n\n"
        f"Dataset: {dataset_name or 'unknown'}\n"
        f"Modality: {modality}"
        f"{cols_text}\n\n"
        "Write a brief, friendly explanation of what's wrong and what the user can do about it.\n"
        "Keep it under 3 sentences. Be specific about the dataset."
    )

    result = _run_with_helper(prompt, max_tokens = 200)
    if not result:
        return None

    warning = result.strip()
    # Reject obviously bad outputs
    if len(warning) < 10 or len(warning) > 500:
        return None

    logger.info(f"LLM-generated warning: {warning}")
    return warning


# ─── Dataset Conversion Advisor ──────────────────────────────────────


def _parse_json_response(text: str) -> Optional[dict]:
    """Parse JSON from LLM response, handling markdown fences and noise."""
    if not text:
        return None

    cleaned = text.strip()

    # Strip markdown code fences
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        end = -1 if lines[-1].strip().startswith("```") else len(lines)
        cleaned = "\n".join(lines[1:end]).strip()

    # Try direct parse
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    # Greedy match for outermost {...}
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            obj = json.loads(match.group())
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass

    return None


def fetch_hf_dataset_card(
    dataset_name: str, hf_token: Optional[str] = None
) -> tuple[Optional[str], Optional[dict]]:
    """
    Fetch HF dataset card (README) and metadata.

    Returns:
        (readme_text, metadata_dict) or (None, None) on failure.
    """
    try:
        from huggingface_hub import DatasetCard

        card = DatasetCard.load(dataset_name, token = hf_token)
        readme = card.text or ""

        # Truncate at sentence boundary
        if len(readme) > README_MAX_CHARS:
            cut = readme[:README_MAX_CHARS].rfind(".")
            if cut > README_MAX_CHARS // 2:
                readme = readme[: cut + 1] + "\n[...truncated]"
            else:
                readme = readme[:README_MAX_CHARS] + "\n[...truncated]"

        # Extract metadata from YAML frontmatter
        metadata = {}
        if card.data:
            for key in (
                "task_categories",
                "task_ids",
                "language",
                "size_categories",
                "tags",
                "license",
                "pretty_name",
            ):
                val = getattr(card.data, key, None)
                if val is not None:
                    metadata[key] = val

        logger.info(
            f"Fetched dataset card: {len(readme)} chars, {len(metadata)} metadata fields"
        )
        return readme, metadata

    except Exception as e:
        logger.warning(f"Could not fetch dataset card for {dataset_name}: {e}")
        return None, None


def _run_multi_pass_advisor(
    columns: list[str],
    samples: list[dict],
    dataset_name: Optional[str] = None,
    dataset_card: Optional[str] = None,
    dataset_metadata: Optional[dict] = None,
    model_name: Optional[str] = None,
    model_type: Optional[str] = None,
    hf_token: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """
    Multi-pass LLM analysis (local GGUF removed in Citi build).

    Returns None; callers use heuristics and llm_classify_columns fallback.
    """
    if os.environ.get("UNSLOTH_HELPER_MODEL_DISABLE", "").strip() in ("1", "true"):
        return None
    return None


def llm_conversion_advisor(
    column_names: list[str],
    samples: list[dict],
    dataset_name: Optional[str] = None,
    hf_token: Optional[str] = None,
    model_name: Optional[str] = None,
    model_type: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """
    Full conversion advisor: fetch HF card → multi-pass LLM analysis.

    Falls back to simple llm_classify_columns() if the multi-pass advisor fails.

    Returns:
        Dict with keys: success, suggested_mapping, system_prompt, user_template,
        assistant_template, label_mapping, dataset_type, is_conversational,
        user_notification. Or None on complete failure.
    """
    # Fetch HF dataset card if this looks like a HF dataset (has a slash)
    dataset_card = None
    dataset_metadata = None
    if dataset_name and "/" in dataset_name:
        dataset_card, dataset_metadata = fetch_hf_dataset_card(dataset_name, hf_token)

    # Try multi-pass advisor
    result = _run_multi_pass_advisor(
        columns = column_names,
        samples = samples,
        dataset_name = dataset_name,
        dataset_card = dataset_card,
        dataset_metadata = dataset_metadata,
        model_name = model_name,
        model_type = model_type,
        hf_token = hf_token,
    )

    if result and result.get("success"):
        logger.info(f"Conversion advisor succeeded: type={result.get('dataset_type')}")
        return result

    # Fallback: simple column classification
    logger.info("Advisor failed, falling back to simple column classification")
    simple_mapping = llm_classify_columns(column_names, samples)
    if simple_mapping:
        return {
            "success": True,
            "suggested_mapping": {
                col: role
                for col, role in simple_mapping.items()
                if role in ("user", "assistant", "system")
            },
            "dataset_type": None,
            "is_conversational": None,
            "user_notification": None,
        }

    return None
