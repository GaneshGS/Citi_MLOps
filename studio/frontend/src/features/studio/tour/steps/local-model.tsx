// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { ReadMore, type TourStep } from "@/features/tour";

export const studioLocalModelStep: TourStep = {
  id: "local-model",
  target: "studio-local-model",
  title: "Model catalog",
  body: (
    <>
      Pick a base model from the internal catalog (or type a model id your
      environment exposes). Select a size that fits your task and VRAM; you can
      start smaller to iterate quickly.{" "}
      <ReadMore href="https://unsloth.ai/docs/basics/fine-tuning-llms-guide" />
    </>
  ),
};
