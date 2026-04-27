# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""
Data Recipe core (DataDesigner wrapper + job runner).

Eagerly importing the job subprocess stack breaks lightweight imports (e.g. tests
for GSSP helper code). Expose the job API via :func:`__getattr__` instead.
"""

from __future__ import annotations

__all__ = ["JobManager", "get_job_manager"]


def __getattr__(name: str) -> object:
    if name == "JobManager":
        from .jobs import JobManager

        return JobManager
    if name == "get_job_manager":
        from .jobs import get_job_manager

        return get_job_manager
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
