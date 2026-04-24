# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

from pathlib import Path
from typing import Optional

import typer

from unsloth_cli.config import Config, load_config
from unsloth_cli.options import add_options_from_config


@add_options_from_config(Config)
def train(
    config: Optional[Path] = typer.Option(
        None,
        "--config",
        "-c",
        help = "Path to YAML/JSON config file. CLI flags override config values.",
    ),
    hf_token: Optional[str] = typer.Option(
        None, "--hf-token", envvar = "HF_TOKEN", help = "Hugging Face token if needed."
    ),
    wandb_token: Optional[str] = typer.Option(
        None, "--wandb-token", envvar = "WANDB_API_KEY", help = "Weights & Biases API key."
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help = "Show resolved config and exit without training.",
    ),
    config_overrides: dict = None,
):
    """Launch training using the existing Unsloth training backend."""
    try:
        cfg = load_config(config)
    except FileNotFoundError as e:
        typer.echo(f"Error: {e}", err = True)
        raise typer.Exit(code = 2)

    cfg.apply_overrides(**config_overrides)

    # CLI/env tokens take precedence over config
    # Handle case where typer.Option isn't resolved (decorator interaction)
    from typer.models import OptionInfo

    if isinstance(hf_token, OptionInfo):
        hf_token = None
    if isinstance(wandb_token, OptionInfo):
        wandb_token = None
    hf_token = hf_token or cfg.logging.hf_token
    wandb_token = wandb_token or cfg.logging.wandb_token

    if dry_run:
        import yaml

        data = cfg.model_dump()
        data["training"]["output_dir"] = str(data["training"]["output_dir"])
        typer.echo(yaml.dump(data, default_flow_style = False, sort_keys = False))
        raise typer.Exit(code = 0)

    if not cfg.model:
        typer.echo("Error: provide --model or set model in --config", err = True)
        raise typer.Exit(code = 2)

    if not cfg.data.dataset and not cfg.data.local_dataset:
        typer.echo(
            "Error: provide --dataset or --local-dataset (or via --config)", err = True
        )
        raise typer.Exit(code = 2)

    # Check if the model path is a LoRA adapter (has adapter_config.json)
    model_path = Path(cfg.model) if cfg.model else None
    model_is_lora = (
        model_path
        and model_path.is_dir()
        and (model_path / "adapter_config.json").exists()
    )
    use_lora = cfg.training.training_type.lower() == "lora"

    if model_is_lora and not use_lora:
        typer.echo(
            "Error: Cannot do full finetuning on a LoRA adapter. "
            "Use --training-type lora or provide a base model.",
            err = True,
        )
        raise typer.Exit(code = 2)

    typer.echo(
        "Error: The unsloth CLI train command is not available in this Citi-centric "
        "repository. Use your orchestration training services instead.",
        err = True,
    )
    raise typer.Exit(code = 2)
