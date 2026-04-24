// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GraphWarning } from "../utils/graph-warnings";
import type { LlmConfig, NodeConfig } from "../types";

type GuidedValidateResult = {
  valid: boolean;
  details: Array<{
    code?: string | null;
  }>;
} | null;

type StepStatus = "done" | "next" | "pending";

type GuidedStep = {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  focusNodeId?: string;
};

function getFocusNodeId(configs: Record<string, NodeConfig>, kind: NodeConfig["kind"]): string | undefined {
  for (const config of Object.values(configs)) {
    if (config.kind === kind) {
      return config.id;
    }
  }
  return undefined;
}

function buildGuidedSteps(input: {
  configs: Record<string, NodeConfig>;
  warnings: GraphWarning[];
  validateResult: GuidedValidateResult;
  executionsReady: boolean;
}): GuidedStep[] {
  const { configs, warnings, validateResult, executionsReady } = input;
  const values = Object.values(configs);
  const seed = values.find((config) => config.kind === "seed");
  const gsspMode = seed?.gssp_enabled === true;
  const provider = values.find((config) => config.kind === "model_provider");
  const modelConfig = values.find((config) => config.kind === "model_config");
  const structuredLlm = values.find(
    (config): config is LlmConfig =>
      config.kind === "llm" && config.llm_type === "structured",
  );
  const warningByNode = new Set(warnings.map((warning) => warning.nodeId).filter(Boolean));
  const validationCodes = new Set(
    validateResult?.details.map((detail) => detail.code?.trim()).filter(Boolean),
  );

  const seedDone =
    seed?.seed_source_type === "unstructured" &&
    (seed.unstructured_file_names?.length ?? 0) > 0;
  const providerDone =
    gsspMode
      ? Boolean(seed?.gssp_endpoint?.trim()) &&
        Boolean(seed?.gssp_auth_token?.trim()) &&
        Boolean(seed?.gssp_x_correlation_id?.trim()) &&
        Boolean(seed?.gssp_x_application_id?.trim()) &&
        Boolean(seed?.gssp_x_soeid?.trim())
      : Boolean(provider?.endpoint.trim()) &&
        Boolean(provider?.api_key?.trim() || provider?.api_key_env?.trim()) &&
        Boolean(modelConfig?.model.trim());
  const promptDone =
    Boolean(structuredLlm?.prompt.trim()) &&
    Boolean(structuredLlm?.output_format?.trim());
  const previewDone = Boolean(validateResult?.valid);

  const steps: GuidedStep[] = [
    {
      id: "seed",
      title: "Step 1: Add your PDF source",
      description: "Upload at least one PDF file in the Seed block.",
      status: seedDone ? "done" : "pending",
      focusNodeId: getFocusNodeId(configs, "seed"),
    },
    {
      id: "provider",
      title: "Step 2: Configure GSSP connection",
      description: gsspMode
        ? "Set endpoint, path, and auth token in the Seed block."
        : "Set endpoint, API key, and deployment ID for model config.",
      status: providerDone ? "done" : "pending",
      focusNodeId: seed?.id ?? provider?.id ?? modelConfig?.id,
    },
    {
      id: "prompt",
      title: "Step 3: Review prompt + schema",
      description: "Confirm the structured LLM prompt and JSON schema are set.",
      status: promptDone ? "done" : "pending",
      focusNodeId: structuredLlm?.id,
    },
    {
      id: "preview",
      title: "Step 4: Validate before run",
      description: "Use Check to verify there are no recipe issues.",
      status: previewDone ? "done" : "pending",
      focusNodeId: structuredLlm?.id ?? provider?.id,
    },
    {
      id: "run",
      title: "Step 5: Run and export",
      description: "Start a run once the first four steps are complete.",
      status: executionsReady ? "done" : "pending",
    },
  ];

  const next = steps.find((step) => step.status === "pending");
  if (next) {
    next.status = "next";
  }

  if (validationCodes.has("missing_seed_path")) {
    steps[0].status = "next";
  } else if (
    validationCodes.has("missing_provider_endpoint") ||
    validationCodes.has("missing_provider_api_key") ||
    validationCodes.has("missing_model_deployment")
  ) {
    steps[1].status = "next";
  } else if (
    validationCodes.has("missing_prompt") ||
    validationCodes.has("missing_output_schema")
  ) {
    steps[2].status = "next";
  }

  for (const step of steps) {
    if (!step.focusNodeId) {
      continue;
    }
    if (warningByNode.has(step.focusNodeId) && step.status === "done") {
      step.status = "pending";
    }
  }

  return steps;
}

function statusTone(status: StepStatus): string {
  if (status === "done") {
    return "bg-primary/10 text-primary border-primary/25";
  }
  if (status === "next") {
    return "bg-amber-500/10 text-amber-700 border-amber-500/35 dark:text-amber-300";
  }
  return "bg-muted text-muted-foreground border-border";
}

export function RequiredActionsPanel(input: {
  configs: Record<string, NodeConfig>;
  nodes: Array<{ id: string }>;
  warnings: GraphWarning[];
  validateResult: GuidedValidateResult;
  runBusy: boolean;
  hasCompletedExecution: boolean;
  onFocusNode: (nodeId: string) => void;
}): ReactElement {
  const steps = buildGuidedSteps({
    configs: input.configs,
    warnings: input.warnings,
    validateResult: input.validateResult,
    executionsReady: input.hasCompletedExecution,
  });
  const actionableSteps = steps.filter((step) => step.focusNodeId);
  const availableNodeIds = new Set(input.nodes.map((node) => node.id));
  const nextStep = steps.find((step) => step.status === "next");

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 w-[340px] max-w-[calc(100%-1.5rem)]">
      <div className="pointer-events-auto rounded-2xl border border-border/70 bg-background/95 p-3 shadow-border backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Required Inputs
          </p>
          <Badge variant="outline" className="text-[10px]">
            GSSP only
          </Badge>
        </div>
        <div className="space-y-2">
          {steps.map((step) => (
            <div key={step.id} className="rounded-xl border border-border/60 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">{step.title}</p>
                <Badge className={statusTone(step.status)}>
                  {step.status === "done"
                    ? "Done"
                    : step.status === "next"
                      ? "Next"
                      : "Pending"}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
        {nextStep?.focusNodeId && availableNodeIds.has(nextStep.focusNodeId) && (
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={input.runBusy}
              onClick={() => input.onFocusNode(nextStep.focusNodeId as string)}
            >
              Focus next block
            </Button>
          </div>
        )}
        {actionableSteps.length === 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Add functional blocks to start the guided flow.
          </p>
        )}
      </div>
    </div>
  );
}
