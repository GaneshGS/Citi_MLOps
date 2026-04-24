# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Citi-centric Studio: local GPU training, export workers, and llama-server are
removed from this tree. This module only holds copy used in API placeholders.
"""


# Shown in API payloads when operations are delegated to external services.
CITI_EXTERNAL_API_PLACEHOLDER = (
    "Local Studio ML is disabled (UNSLOTH_LOCAL_ML=0). "
    "Wire Citi Model Garden, GSSP/GS inference, Stellar register/store, "
    "and export/training services here."
)
