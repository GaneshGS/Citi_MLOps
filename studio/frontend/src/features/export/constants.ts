// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { TrainingMethod } from "@/types/training";

/** Rough size hint for merged / full safetensors exports. */
export function getCheckpointExportEstimatedSize(): string {
  return "~14.2 GB";
}

export const METHOD_LABELS: Record<TrainingMethod, string> = {
  qlora: "QLoRA",
  lora: "LoRA",
  full: "Full Fine-tune",
};

export const GUIDE_STEPS = [
  "Select a training run to export from",
  "Pick a checkpoint to export (full safetensors; LoRA/QLoRA runs merge adapters into the base model)",
  "Click Export and choose your destination",
  "Test your model in Chat if needed",
];
