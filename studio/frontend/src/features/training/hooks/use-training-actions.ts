// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { useCallback } from "react";
import { resetTraining, startStellarFinetuning, stopTraining } from "../api/train-api";
import { syncTrainingRuntimeFromBackend } from "../lib/sync-runtime";
import { validateTrainingConfig } from "../lib/validation";
import { useTrainingConfigStore } from "../stores/training-config-store";
import { useTrainingRuntimeStore } from "../stores/training-runtime-store";
import type { TrainingConfigState } from "../types/config";
import { toast } from "sonner";

function normalizeTrainingStartError(message: string): string {
  const normalized = message.toLowerCase();
  const isLegacyDatasetScriptError =
    normalized.includes("failed to check dataset format") &&
    normalized.includes("dataset scripts are no longer supported");

  if (isLegacyDatasetScriptError) {
    return "This Hub dataset relies on a legacy custom script and isn’t supported in this training flow.";
  }

  return message;
}

export function useTrainingActions() {
  const isStarting = useTrainingRuntimeStore((state) => state.isStarting);
  const startError = useTrainingRuntimeStore((state) => state.startError);

  const startTrainingRun = useCallback(async (): Promise<boolean> => {
    const config = useTrainingConfigStore.getState();
    const runtimeStore = useTrainingRuntimeStore.getState();

    runtimeStore.setStartError(null);
    const validation = validateTrainingConfig(config);
    if (!validation.ok) {
      runtimeStore.setStartError(validation.message);
      return false;
    }
    if (!config.stellarTrainDatasetId) {
      runtimeStore.setStartError("Register train/test data first to get Stellar dataset IDs.");
      return false;
    }

    runtimeStore.setStarting(true);

    try {
      const latestConfig = useTrainingConfigStore.getState();
      const trainDatasetId = latestConfig.stellarTrainDatasetId;
      if (!trainDatasetId) {
        runtimeStore.setStartError("Train dataset ID missing. Register datasets again.");
        runtimeStore.setStarting(false);
        return false;
      }
      const response = await startStellarFinetuning({
        model_name: latestConfig.selectedModel!,
        model_catalog: latestConfig.selectedModel!,
        method: latestConfig.trainingMethod,
        train_dataset_id: trainDatasetId,
        test_dataset_id: latestConfig.stellarTestDatasetId,
        hyperparameters: buildStellarHyperparameters(latestConfig),
      });

      if (response.status === "error") {
        const rawMessage = response.error || response.message;
        const safeMessage = normalizeTrainingStartError(rawMessage);
        runtimeStore.setStartError(safeMessage);
        runtimeStore.setStarting(false);
        return false;
      }

      runtimeStore.setStartQueued(response.job_id, response.message);
      await syncTrainingRuntimeFromBackend();
      return true;
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Failed to start training";
      const safeMessage = normalizeTrainingStartError(rawMessage);
      runtimeStore.setStartError(safeMessage);
      runtimeStore.setStarting(false);
      return false;
    }
  }, []);

  const stopTrainingRun = useCallback(async (save = true): Promise<boolean> => {
    const runtimeStore = useTrainingRuntimeStore.getState();
    runtimeStore.setStartError(null);

    try {
      await stopTraining(save);
      await syncTrainingRuntimeFromBackend();
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to stop training";
      runtimeStore.setRuntimeError(message);
      return false;
    }
  }, []);

  const dismissTrainingRun = useCallback(async (): Promise<void> => {
    try {
      await resetTraining();
      useTrainingRuntimeStore.getState().resetRuntime();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Stop training first, then return to configuration.";
      toast.error("Training still active", {
        description: message,
      });
      await syncTrainingRuntimeFromBackend();
    }
  }, []);

  return {
    isStarting,
    startError,
    startTrainingRun,
    stopTrainingRun,
    dismissTrainingRun,
  };
}

function buildStellarHyperparameters(config: TrainingConfigState): Record<string, unknown> {
  return {
    training_method: config.trainingMethod,
    epochs: config.epochs,
    max_steps: config.maxSteps,
    context_length: config.contextLength,
    learning_rate: config.learningRate,
    batch_size: config.batchSize,
    gradient_accumulation: config.gradientAccumulation,
    warmup_steps: config.warmupSteps,
    save_steps: config.saveSteps,
    eval_steps: config.evalSteps,
    optimizer: config.optimizerType,
    lr_scheduler_type: config.lrSchedulerType,
    weight_decay: config.weightDecay,
    random_seed: config.randomSeed,
    lora_rank: config.loraRank,
    lora_alpha: config.loraAlpha,
    lora_dropout: config.loraDropout,
    target_modules: config.targetModules,
    train_on_completions: config.trainOnCompletions,
    gradient_checkpointing: config.gradientCheckpointing,
  };
}
