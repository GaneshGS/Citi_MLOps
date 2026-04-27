// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import { ChartContainer } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useTrainingActions,
  useTrainingConfigStore,
  validateTrainingConfig,
} from "@/features/training";
import {
  ChartAverageIcon,
  CleanIcon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

const chartConfig = {
  loss: { label: "Loss", color: "#3b82f6" },
} satisfies ChartConfig;

const placeholderData = [
  { step: 0, loss: 2.5 },
  { step: 10, loss: 2.1 },
  { step: 20, loss: 1.7 },
  { step: 30, loss: 1.3 },
  { step: 40, loss: 1.0 },
  { step: 50, loss: 0.8 },
];

export function TrainingSection() {
  const store = useTrainingConfigStore();
  const { isStarting, startError, startTrainingRun } = useTrainingActions();
  const isLoadingModel = store.isLoadingModelDefaults || store.isCheckingVision;
  const isModelCapabilitiesSettled = !!store.selectedModel && !isLoadingModel;
  const isIncompatible =
    isModelCapabilitiesSettled &&
    ((!store.isVisionModel && store.isDatasetImage === true) ||
      (!store.isAudioModel && store.isDatasetAudio === true));
  const configValidation = validateTrainingConfig(store);
  const hasMessage = !!(startError || isIncompatible || (!configValidation.ok && configValidation.message));

  const handleResetConfig = () => {
    store.resetToModelDefaults();
    toast.success("Parameters reset to model defaults");
  };

  return (
    <div data-tour="studio-training" className="min-w-0">
      <SectionCard
        icon={<HugeiconsIcon icon={ChartAverageIcon} className="size-5" />}
        title="Training"
        description="Monitor and control training"
        accent="blue"
        className={hasMessage ? "min-h-studio-config-column" : "h-studio-config-column"}
      >
        <div className="flex flex-col gap-4">
        {/* Loss chart */}
        <div className="relative  ">
          <ChartContainer
            config={chartConfig}
            className="h-[180px] w-full relative right-8 blur"
          >
            <LineChart data={placeholderData} accessibilityLayer={true}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="step"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={10}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={10}
              />
              <Line
                type="monotone"
                dataKey="loss"
                stroke="var(--color-loss)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <HugeiconsIcon
              icon={ChartAverageIcon}
              className="size-5 text-muted-foreground/50"
            />
            <p className="text-sm font-medium text-muted-foreground">
              No training data yet
            </p>
            <p className="text-xs text-muted-foreground/60">
              Start training to see loss progress
            </p>
          </div>
        </div>

        {/* Start/Stop */}
        <Button
          data-tour="studio-start"
          className="w-full cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => void startTrainingRun()}
          disabled={isStarting || isIncompatible || store.isCheckingDataset || isLoadingModel || !configValidation.ok}
        >
          <HugeiconsIcon icon={Rocket01Icon} className="size-4" />
          {isStarting ? "Starting..." : isLoadingModel ? "Loading model..." : store.isCheckingDataset ? "Checking dataset..." : "Start Training"}
        </Button>
        {startError && (
          <p className="text-xs text-red-500 leading-relaxed">{startError}</p>
        )}
        {isIncompatible && (
          <p className="text-xs text-red-500 leading-relaxed">
            {!store.isAudioModel && store.isDatasetAudio === true
              ? "This model does not support audio. Switch to an audio-capable model or choose a non-audio dataset."
              : "Text model is not compatible with a multimodal dataset. Switch to a vision model or choose a text-only dataset."}
          </p>
        )}
        {!configValidation.ok && configValidation.message && !isIncompatible && (
          <p className="text-xs text-red-500 leading-relaxed">{configValidation.message}</p>
        )}

        {/* Stellar integration status */}
        <p className="text-xs text-muted-foreground">Stellar Finetune Inputs</p>
        <div className="rounded-lg border bg-muted/20 px-3.5 py-3 text-[11px] text-muted-foreground">
          <p className="text-xs font-medium text-foreground">Registered dataset IDs</p>
          <p className="mt-1">Model catalog: {store.selectedModel ?? "--"}</p>
          <p>Method: {store.trainingMethod}</p>
          <p className="mt-1">Dataset IDs</p>
          <p className="mt-1">Train: {store.stellarTrainDatasetId ?? "--"}</p>
          <p>Test: {store.stellarTestDatasetId ?? "--"}</p>
          <p className="mt-2">
            Start Training sends these IDs with the hyperparameters from the Parameters tab.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={handleResetConfig}
                disabled={!store.selectedModel}
              >
                <HugeiconsIcon icon={CleanIcon} className="size-3.5" />
                Reset
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset hyperparameters to model defaults</TooltipContent>
          </Tooltip>
        </div>
        </div>
      </SectionCard>
    </div>
  );
}
