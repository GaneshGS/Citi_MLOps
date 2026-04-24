# Copyright 2023-present Daniel Han-Chen & the Unsloth team. All rights reserved.
#
# Citi MLOps Studio fork: the upstream `import unsloth` path no longer loads
# PyTorch, Triton, or the full finetuning stack. Use:
#   from unsloth.chat_templates import get_chat_template
# Training-era modules (models/, kernels/, optimizers/) were removed from this tree.

from unsloth._version import __version__

__all__ = ["__version__"]
