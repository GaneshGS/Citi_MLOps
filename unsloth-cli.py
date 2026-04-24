#!/usr/bin/env python3
"""
Legacy local fine-tuning script removed in the Citi MLOps Studio fork.

Use the Typer entry point: ``unsloth studio ...`` or your orchestration training services.
"""
import sys

def main() -> None:
    print(
        "This script is not available in the Citi-centric repository: "
        "local Unsloth FastLanguageModel finetuning was removed. "
        "Use `unsloth studio` for Studio, or external training per your MLOps plan.",
        file = sys.stderr,
    )
    sys.exit(2)

if __name__ == "__main__":
    main()
