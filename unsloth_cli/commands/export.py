# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

from pathlib import Path
from typing import Optional

import typer


EXPORT_FORMATS = ["merged-16bit", "merged-4bit", "gguf", "lora"]
GGUF_QUANTS = ["q4_k_m", "q5_k_m", "q8_0", "f16"]


def list_checkpoints(
    outputs_dir: Path = typer.Option(
        Path("./outputs"), "--outputs-dir", help = "Directory that holds training runs."
    ),
):
    """List checkpoints detected in the outputs directory."""
    typer.echo(
        "Error: list-checkpoints is not available in this Citi-centric repository "
        "(local export backend removed). Use your MLOps checkpoint tooling instead.",
        err = True,
    )
    raise typer.Exit(code = 2)


def export(
    checkpoint: Path = typer.Argument(..., help = "Path to checkpoint directory."),
    output_dir: Path = typer.Argument(..., help = "Directory to save exported model."),
    format: str = typer.Option(
        "merged-16bit",
        "--format",
        "-f",
        help = f"Export format: {', '.join(EXPORT_FORMATS)}",
    ),
    quantization: str = typer.Option(
        "q4_k_m",
        "--quantization",
        "-q",
        help = f"GGUF quantization method: {', '.join(GGUF_QUANTS)}",
    ),
    push_to_hub: bool = typer.Option(
        False, "--push-to-hub", help = "Push exported model to HuggingFace Hub."
    ),
    repo_id: Optional[str] = typer.Option(
        None, "--repo-id", help = "HuggingFace repo ID (username/model-name)."
    ),
    hf_token: Optional[str] = typer.Option(
        None, "--hf-token", envvar = "HF_TOKEN", help = "HuggingFace token."
    ),
    private: bool = typer.Option(
        False, "--private", help = "Make the HuggingFace repo private."
    ),
    max_seq_length: int = typer.Option(2048, "--max-seq-length"),
    load_in_4bit: bool = typer.Option(True, "--load-in-4bit/--no-load-in-4bit"),
):
    """Export a checkpoint to various formats (merged, GGUF, LoRA adapter)."""
    if format not in EXPORT_FORMATS:
        typer.echo(
            f"Error: Invalid format '{format}'. Choose from: {', '.join(EXPORT_FORMATS)}",
            err = True,
        )
        raise typer.Exit(code = 2)

    if push_to_hub and not repo_id:
        typer.echo("Error: --repo-id required when using --push-to-hub", err = True)
        raise typer.Exit(code = 2)

    typer.echo(
        "Error: The unsloth CLI export command is not available in this Citi-centric "
        "repository (local export backend removed). Use Stellar / export services instead.",
        err = True,
    )
    raise typer.Exit(code = 2)
