// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { TourStep } from "@/features/tour";

export const exportTourSteps: TourStep[] = [
  {
    id: "training-run",
    target: "export-training-run",
    title: "Pick training run",
    body: (
      <>
        Start by selecting the training run. Each run groups the checkpoints
        produced by that specific fine-tuning job.
      </>
    ),
  },
  {
    id: "checkpoint",
    target: "export-checkpoint",
    title: "Pick checkpoint",
    body: (
      <>
        Pick which checkpoint to export. LoRA/QLoRA runs are merged with the base
        into full safetensors. If you trained multiple checkpoints, try one or
        two and test in Chat.
      </>
    ),
  },
  {
    id: "cta",
    target: "export-cta",
    title: "Export",
    body: (
      <>
        Export to local or push to the Hub. After export, test in Chat and
        compare against base to confirm behavior is what you expect.
      </>
    ),
  },
];
