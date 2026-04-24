// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTrainingConfigStore } from "@/features/training";
import {
  AlertCircleIcon,
  InformationCircleIcon,
  PackageIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ModelCheckpoints } from "./api/export-api";
import {
  cleanupExport,
  exportBase,
  exportMerged,
  exportLoRA,
  fetchCheckpoints,
  loadCheckpoint,
} from "./api/export-api";
import { ExportDialog } from "./components/export-dialog";
import { GUIDE_STEPS, getCheckpointExportEstimatedSize } from "./constants";
import { GuidedTour, useGuidedTourController } from "@/features/tour";
import { exportTourSteps } from "./tour";

export function ExportPage() {
  const { hfToken, setHfToken } = useTrainingConfigStore(
    useShallow((s) => ({
      hfToken: s.hfToken,
      setHfToken: s.setHfToken,
    })),
  );

  const [models, setModels] = useState<ModelCheckpoints[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(true);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  const [selectedModelIdx, setSelectedModelIdx] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [destination, setDestination] = useState<"local" | "hub">("local");
  const [hfUsername, setHfUsername] = useState("");
  const [modelName, setModelName] = useState("");
  const [privateRepo, setPrivateRepo] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportOutputPath, setExportOutputPath] = useState<string | null>(null);

  const tour = useGuidedTourController({
    id: "export",
    steps: exportTourSteps,
  });

  useEffect(() => {
    let cancelled = false;
    setLoadingCheckpoints(true);
    setCheckpointError(null);
    fetchCheckpoints()
      .then((data) => {
        if (!cancelled) {
          setModels(data.models);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCheckpointError(
            err instanceof Error ? err.message : "Failed to load checkpoints",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCheckpoints(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModelData = useMemo(
    () =>
      selectedModelIdx != null
        ? models.find((m) => m.name === selectedModelIdx) ?? null
        : null,
    [models, selectedModelIdx],
  );

  const checkpointsForModel = useMemo(
    () => selectedModelData?.checkpoints ?? [],
    [selectedModelData],
  );

  const baseModelName = selectedModelData?.base_model ?? "—";
  const isAdapter = !!selectedModelData?.peft_type;
  const isQuantized = !!selectedModelData?.is_quantized;
  const loraRank = selectedModelData?.lora_rank ?? null;
  const trainingMethodLabel = selectedModelData?.peft_type
    ? "LoRA / QLoRA"
    : "Full Fine-tune";

  const exportFormatLabel = isAdapter
    ? "Adapters merged with base (safetensors)"
    : "Full model weights (safetensors)";

  useEffect(() => {
    setCheckpoint(null);
  }, [selectedModelIdx]);

  const canExport = !!(
    selectedModelIdx &&
    checkpoint &&
    !(!isAdapter && isQuantized)
  );
  const estimatedSize = getCheckpointExportEstimatedSize();

  const handleExport = useCallback(async () => {
    if (!selectedModelIdx || !checkpoint) return;
    const selectedCp = checkpointsForModel.find(
      (cp) => cp.display_name === checkpoint,
    );
    if (!selectedCp) return;

    setExporting(true);
    setExportError(null);
    setExportSuccess(false);
    setExportOutputPath(null);

    const saveDir = `${selectedModelIdx}/${checkpoint}`;
    const pushToHub = destination === "hub";
    const repoId = pushToHub && hfUsername && modelName
      ? `${hfUsername}/${modelName}`
      : undefined;
    const token = pushToHub && hfToken ? hfToken : undefined;

    try {
      await loadCheckpoint({ checkpoint_path: selectedCp.path });

      let lastOutputPath: string | null = null;
      if (isAdapter) {
        const resp = await exportMerged({
          save_directory: saveDir,
          push_to_hub: pushToHub,
          repo_id: repoId,
          hf_token: token,
          private: privateRepo,
        });
        lastOutputPath = resp.details?.output_path ?? null;
      } else {
        const resp = await exportBase({
          save_directory: saveDir,
          push_to_hub: pushToHub,
          repo_id: repoId,
          hf_token: token,
          private: privateRepo,
          base_model_id: selectedModelData?.base_model ?? null,
        });
        lastOutputPath = resp.details?.output_path ?? null;
      }

      setExportOutputPath(lastOutputPath);
      setExportSuccess(true);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Export failed",
      );
    } finally {
      try {
        await cleanupExport();
      } catch {
        // cleanup is best-effort
      }
      setExporting(false);
    }
  }, [
    checkpoint,
    checkpointsForModel,
    selectedModelIdx,
    selectedModelData,
    isAdapter,
    destination,
    hfUsername,
    modelName,
    hfToken,
    privateRepo,
  ]);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <GuidedTour {...tour.tourProps} />

        <div className="mb-8 flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Export Model
          </h1>
          <p className="text-sm text-muted-foreground">
            Export training checkpoints for deployment
          </p>
        </div>

        <SectionCard
          icon={<HugeiconsIcon icon={PackageIcon} className="size-5" />}
          title="Export Configuration"
          description="Select a training run and checkpoint, then choose a destination"
          accent="primary"
          featured={true}
          className="shadow-border ring-1 ring-border"
        >
          {loadingCheckpoints && (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading checkpoints…
            </div>
          )}

          {checkpointError && (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-destructive">
              <HugeiconsIcon icon={AlertCircleIcon} className="size-4" />
              {checkpointError}
            </div>
          )}

          {!loadingCheckpoints && !checkpointError && (
            <>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                <div className="flex flex-col gap-2">
                  <div data-tour="export-training-run" className="flex flex-col gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      Training run
                      <Tooltip>
                        <TooltipTrigger asChild={true}>
                          <button
                            type="button"
                            className="text-foreground/70 hover:text-foreground"
                          >
                            <HugeiconsIcon
                              icon={InformationCircleIcon}
                              className="size-3"
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Select the training run that produced the checkpoints you
                          want to export.
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    <Select
                      value={selectedModelIdx ?? ""}
                      onValueChange={setSelectedModelIdx}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            models.length === 0
                              ? "No training runs found"
                              : "Select a training run…"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((m) => {
                          const tsMatch = m.name.match(/_(\d{10,})$/);
                          const displayName = tsMatch
                            ? m.name.slice(0, tsMatch.index)
                            : m.name;
                          const timeStr = tsMatch
                            ? new Date(Number(tsMatch[1]) * 1000).toLocaleString(
                                undefined,
                                {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                },
                              )
                            : null;
                          return (
                            <SelectItem key={m.name} value={m.name}>
                              <span className="flex items-center gap-2">
                                {displayName}
                                <span className="text-muted-foreground text-xs">
                                  {m.checkpoints.length} checkpoint
                                  {m.checkpoints.length !== 1 ? "s" : ""}
                                </span>
                                {timeStr && (
                                  <span className="text-muted-foreground text-xs">
                                    · {timeStr}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div data-tour="export-checkpoint" className="flex flex-col gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      Checkpoint
                      <Tooltip>
                        <TooltipTrigger asChild={true}>
                          <button
                            type="button"
                            className="text-foreground/70 hover:text-foreground"
                          >
                            <HugeiconsIcon
                              icon={InformationCircleIcon}
                              className="size-3"
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Choose a saved checkpoint. LoRA/QLoRA runs export with
                          adapters merged into the base.{" "}
                          <a
                            href="https://unsloth.ai/docs/basics/inference-and-deployment"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline"
                          >
                            Read more
                          </a>
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    <Select
                      value={checkpoint ?? ""}
                      onValueChange={setCheckpoint}
                      disabled={!selectedModelIdx}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            !selectedModelIdx
                              ? "Select a training run first"
                              : checkpointsForModel.length === 0
                                ? "No checkpoints found"
                                : "Select a checkpoint…"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {checkpointsForModel.map((cp) => (
                          <SelectItem key={cp.path} value={cp.display_name}>
                            <span className="flex items-center gap-2">
                              {cp.display_name}
                              {cp.loss != null && (
                                <span className="text-muted-foreground text-xs">
                                  loss: {cp.loss.toFixed(4)}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-xl bg-muted/50 p-3 flex flex-col gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Training info
                    </span>
                    <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Base model</span>
                        <span className="font-medium">{baseModelName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Method</span>
                        <span className="font-medium">
                          {trainingMethodLabel}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Checkpoints</span>
                        <span className="font-medium">
                          {checkpointsForModel.length}
                        </span>
                      </div>
                      {isAdapter && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">LoRA rank</span>
                          <span className="font-medium">{loraRank}</span>
                        </div>
                      )}
                    </div>
                    {!isAdapter && isQuantized && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-500/90">
                        This pre-quantized (BNB 4-bit) run cannot be exported as
                        full weights. Train with LoRA/QLoRA to export a merged
                        model.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Quick guide
                  </span>
                  <ol className="flex flex-col gap-3">
                    {GUIDE_STEPS.map((step, i) => (
                      <li
                        key={step}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end">
                <Button
                  data-tour="export-cta"
                  disabled={!canExport}
                  onClick={() => {
                    setExportSuccess(false);
                    setExportError(null);
                    setDialogOpen(true);
                  }}
                >
                  Export model
                </Button>
              </div>
            </>
          )}
        </SectionCard>
      </main>

      <ExportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        exportFormatLabel={exportFormatLabel}
        showExportLog
        logResetKey={`${selectedModelIdx ?? ""}:${checkpoint ?? ""}`}
        estimatedSize={estimatedSize}
        checkpoint={checkpoint}
        baseModelName={baseModelName}
        isAdapter={isAdapter}
        destination={destination}
        onDestinationChange={setDestination}
        hfUsername={hfUsername}
        onHfUsernameChange={setHfUsername}
        modelName={modelName}
        onModelNameChange={setModelName}
        hfToken={hfToken}
        onHfTokenChange={setHfToken}
        privateRepo={privateRepo}
        onPrivateRepoChange={setPrivateRepo}
        onExport={handleExport}
        exporting={exporting}
        exportError={exportError}
        exportSuccess={exportSuccess}
        exportOutputPath={exportOutputPath}
      />
    </div>
  );
}
