// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { Button } from "@/components/ui/button";
import {
  Copy02Icon,
  Tick02Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactElement } from "react";
import { SeedDialog } from "../dialogs/seed/seed-dialog";
import { ValidationBanner } from "../dialogs/shared/validation-banner";
import type { NodeConfig, SeedConfig } from "../types";
import { RECIPE_FLOATING_ICON_BUTTON_CLASS } from "./recipe-floating-icon-button-class";

type PdfGroundedQaLinearConfigureProps = {
  seedConfig: SeedConfig;
  readOnly: boolean;
  onUpdate: (id: string, patch: Partial<NodeConfig>) => void;
  onImport: () => void;
  onCopy: () => void;
  copied: boolean;
};

function BlockFields({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactElement;
}): ReactElement {
  return (
    <div
      className={readOnly ? "pointer-events-none min-w-0 opacity-75" : "min-w-0"}
    >
      {children}
    </div>
  );
}

export function PdfGroundedQaLinearConfigure({
  seedConfig,
  readOnly,
  onUpdate,
  onImport,
  onCopy,
  copied,
}: PdfGroundedQaLinearConfigureProps): ReactElement {
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {readOnly && (
        <div className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          This recipe is locked while a run is in progress.
        </div>
      )}

      <div className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className={RECIPE_FLOATING_ICON_BUTTON_CLASS}
          onClick={onImport}
          aria-label="Import recipe"
          title="Import recipe"
        >
          <HugeiconsIcon icon={Upload01Icon} className="size-5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className={RECIPE_FLOATING_ICON_BUTTON_CLASS}
          onClick={onCopy}
          aria-label={copied ? "Recipe JSON copied" : "Copy recipe JSON"}
          title={copied ? "Recipe JSON copied" : "Copy recipe JSON"}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy02Icon}
            className="size-5"
          />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pt-10 pr-0 pb-24 sm:pt-2">
        <p className="mb-2 text-xs text-muted-foreground">
          GSSP URL, path, API credentials, pass-through headers, and optional
          request template are set on the server (STUDIO_GSSP_*). The
          question-generation prompt and JSON response format are also applied
          on the server.
        </p>
        <ValidationBanner config={seedConfig} />
        <BlockFields readOnly={readOnly}>
          <SeedDialog
            config={seedConfig}
            open={true}
            onUpdate={(patch) => onUpdate(seedConfig.id, patch)}
          />
        </BlockFields>
      </div>
    </div>
  );
}
