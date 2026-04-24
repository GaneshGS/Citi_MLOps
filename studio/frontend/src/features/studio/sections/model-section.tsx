// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { SectionCard } from "@/components/section-card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group";
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
import { listModels } from "@/features/chat/api/chat-api";
import type { BackendModelDetails } from "@/features/chat/types/api";
import { useTrainingConfigStore } from "@/features/training";
import type { TrainingMethod } from "@/types/training";
import {
  ChipIcon,
  InformationCircleIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

const METHOD_DOTS: Record<string, string> = {
  qlora: "bg-primary",
  lora: "bg-blue-400",
  full: "bg-amber-400",
};

const DARK_TRIGGER =
  "w-full bg-foreground text-background hover:bg-foreground/90 dark:bg-foreground dark:text-background dark:hover:bg-foreground [&_svg]:text-background/50";
const DARK_CONTENT =
  "bg-foreground text-background shadow-xl border-background/10 [--accent:rgba(255,255,255,0.1)] [--accent-foreground:white] dark:[--accent:rgba(2,6,23,0.08)] dark:[--accent-foreground:rgb(2,6,23)] [&_[data-slot=select-item]]:text-white/80 dark:[&_[data-slot=select-item]]:text-slate-900 [&_[data-slot=select-scroll-up-button]]:bg-foreground [&_[data-slot=select-scroll-down-button]]:bg-foreground";
const DARK_COMBOBOX_CONTENT =
  "bg-foreground text-background shadow-xl border-background/10 dark:[--accent:rgba(2,6,23,0.08)] dark:[--accent-foreground:rgb(2,6,23)] dark:[&_[data-slot=combobox-item]]:text-slate-900 dark:[&_.text-muted-foreground]:text-slate-500";

export function ModelSection() {
  const {
    selectedModel,
    setSelectedModel,
    trainingMethod,
    setTrainingMethod,
  } = useTrainingConfigStore(
    useShallow(
      ({
        selectedModel,
        setSelectedModel,
        trainingMethod,
        setTrainingMethod,
      }) => ({
        selectedModel,
        setSelectedModel,
        trainingMethod,
        setTrainingMethod,
      }),
    ),
  );

  const [catalogInput, setCatalogInput] = useState("");
  const [catalogIds, setCatalogIds] = useState<string[]>([]);
  const [catalogMeta, setCatalogMeta] = useState<Map<string, BackendModelDetails>>(
    () => new Map(),
  );
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const selectingRef = useRef(false);

  function applyCatalogModel(value: string) {
    const next = value.trim();
    if (!next) return;
    setSelectedModel(next);
  }

  useEffect(() => {
    const controller = new AbortController();
    void listModels(controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        const ids = [
          ...new Set([
            ...res.default_models,
            ...res.models.map((m) => m.id),
          ]),
        ];
        setCatalogIds(ids);
        setCatalogMeta(new Map(res.models.map((m) => [m.id, m])));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setCatalogError(
          error instanceof Error
            ? error.message
            : "Failed to load model catalog",
        );
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsLoadingCatalog(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectingRef.current) {
      selectingRef.current = false;
      return;
    }
    if (selectedModel != null && selectedModel !== catalogInput) {
      setCatalogInput(selectedModel);
    }
  }, [selectedModel, catalogInput]);

  const catalogResultIds = useMemo(() => {
    const ids = [...catalogIds];
    const manual = catalogInput.trim();
    if (manual && !ids.includes(manual)) {
      ids.unshift(manual);
    }
    return ids;
  }, [catalogInput, catalogIds]);

  const catalogFilteredIds = useMemo(() => {
    const q = catalogInput.trim().toLowerCase();
    if (!q) return catalogResultIds;
    return catalogResultIds.filter((id) => {
      const meta = catalogMeta.get(id);
      const name = (meta?.name ?? "").toLowerCase();
      if (id.toLowerCase().includes(q)) return true;
      if (name.includes(q)) return true;
      return false;
    });
  }, [catalogMeta, catalogInput, catalogResultIds]);

  const catalogComboboxAnchorRef = useRef<HTMLDivElement>(null);

  return (
    <div data-tour="studio-model" className="w-full min-w-0">
      <SectionCard
        icon={<HugeiconsIcon icon={ChipIcon} className="size-5" />}
        title="Model"
        description="Select base model and training method"
        accent="primary"
        featured={true}
        className="shadow-border ring-border"
      >
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <div
            data-tour="studio-local-model"
            className="flex min-w-0 flex-col gap-2"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Model catalog
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
                  Models from your configured catalog (GET /api/models/list).
                  You can also type a model id your environment provides.
                </TooltipContent>
              </Tooltip>
            </span>
            <div ref={catalogComboboxAnchorRef} className="min-w-0">
              <Combobox
                items={catalogResultIds}
                filteredItems={catalogFilteredIds}
                filter={null}
                value={catalogInput || null}
                onValueChange={(id) => {
                  const next = id ?? "";
                  setCatalogInput(next);
                  if (next) setSelectedModel(next);
                }}
                onInputValueChange={setCatalogInput}
                itemToStringValue={(id) => id}
                autoHighlight={true}
              >
                <ComboboxInput
                  placeholder={
                    isLoadingCatalog
                      ? "Loading catalog..."
                      : "org/model-id"
                  }
                  className="w-full bg-foreground text-background [&_input]:text-background [&_input]:placeholder:text-background/40 [&_svg]:text-background/50 hover:bg-foreground/90"
                  onBlur={() => applyCatalogModel(catalogInput)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    applyCatalogModel(catalogInput);
                  }}
                >
                  <InputGroupAddon>
                    <HugeiconsIcon icon={Search01Icon} className="size-4" />
                  </InputGroupAddon>
                </ComboboxInput>
                <ComboboxContent
                  anchor={catalogComboboxAnchorRef}
                  className={DARK_COMBOBOX_CONTENT}
                >
                  {isLoadingCatalog ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                      <Spinner className="size-4" /> Loading…
                    </div>
                  ) : catalogError ? (
                    <div className="px-3 py-2 text-xs text-red-500">
                      {catalogError}
                    </div>
                  ) : (
                    <ComboboxEmpty>No catalog entries</ComboboxEmpty>
                  )}
                  <ComboboxList className="p-1">
                    {(id: string) => {
                      const model = catalogMeta.get(id);
                      return (
                        <ComboboxItem key={id} value={id} className="gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild={true}>
                              <span className="block min-w-0 flex-1 truncate">
                                {model?.name ?? id}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="left"
                              className="max-w-xs break-all"
                            >
                              {id}
                            </TooltipContent>
                          </Tooltip>
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                            API
                          </span>
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
            {isLoadingCatalog ? (
              <p className="text-[10px] text-muted-foreground">
                Loading model catalog…
              </p>
            ) : catalogError ? (
              <p className="text-[10px] text-red-500">{catalogError}</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {catalogIds.length > 0
                  ? `${catalogIds.length} model(s) from API`
                  : "Catalog empty — type a model id from your environment."}
              </p>
            )}
          </div>

          <div
            data-tour="studio-method"
            className="flex min-w-0 flex-col gap-2"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Method
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
                <TooltipContent className="max-w-xs">
                  QLoRA uses 4-bit quantization for lowest VRAM. LoRA uses
                  16-bit. Full updates all weights.{" "}
                  <a
                    href="https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    Read more
                  </a>
                </TooltipContent>
              </Tooltip>
            </span>
            <Select
              value={trainingMethod}
              onValueChange={(v) => setTrainingMethod(v as TrainingMethod)}
            >
              <SelectTrigger className={DARK_TRIGGER}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className={`${DARK_CONTENT} w-[var(--radix-select-trigger-width)]`}
              >
                <SelectItem value="qlora">
                  <span className="flex items-center gap-2">
                    <span
                      className={`size-2 shrink-0 rounded-full ${METHOD_DOTS.qlora}`}
                    />
                    QLoRA (4-bit)
                  </span>
                </SelectItem>
                <SelectItem value="lora">
                  <span className="flex items-center gap-2">
                    <span
                      className={`size-2 shrink-0 rounded-full ${METHOD_DOTS.lora}`}
                    />
                    LoRA (16-bit)
                  </span>
                </SelectItem>
                <SelectItem value="full">
                  <span className="flex items-center gap-2">
                    <span
                      className={`size-2 shrink-0 rounded-full ${METHOD_DOTS.full}`}
                    />
                    Full Fine-tune
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
