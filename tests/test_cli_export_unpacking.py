# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Regression guard for unsloth_cli.commands.export in the Citi-centric tree.

The historical test exercised a fake ExportBackend and the 3-tuple unpack
contract. Local export is removed; the CLI must fail fast with a clear message
instead of crashing on a missing studio.backend.core.export import.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner


@pytest.fixture
def cli_app() -> typer.Typer:
    from unsloth_cli.commands import export as export_cmd

    app = typer.Typer()
    app.command("export")(export_cmd.export)

    @app.command("noop")
    def _noop() -> None:  # pragma: no cover
        pass

    return app


@pytest.fixture
def runner() -> CliRunner:
    return CliRunner()


@pytest.mark.parametrize(
    "format_flag,quant_flag",
    [
        ("merged-16bit", None),
        ("merged-4bit", None),
        ("gguf", "q4_k_m"),
        ("lora", None),
    ],
)
def test_cli_export_exits_with_disabled_message(
    cli_app: typer.Typer,
    runner: CliRunner,
    tmp_path: Path,
    format_flag: str,
    quant_flag: str | None,
) -> None:
    ckpt = tmp_path / "ckpt"
    ckpt.mkdir()
    out = tmp_path / "out"

    cli_args = ["export", str(ckpt), str(out), "--format", format_flag]
    if quant_flag is not None:
        cli_args += ["--quantization", quant_flag]

    result = runner.invoke(cli_app, cli_args)

    assert result.exit_code == 2, result.output
    lowered = result.output.lower()
    assert "not available" in lowered or "citi-centric" in lowered
