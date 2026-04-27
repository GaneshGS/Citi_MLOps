// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { CookBookIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

type RunFloatingControlsProps = {
  runBusy: boolean;
  onOpenRun: () => void;
};

export function RunFloatingControls({
  runBusy,
  onOpenRun,
}: RunFloatingControlsProps): ReactElement {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
      <div className="pointer-events-auto">
        <Button
          type="button"
          className="corner-squircle h-11 px-5"
          onClick={onOpenRun}
          disabled={runBusy}
        >
          <HugeiconsIcon icon={CookBookIcon} className="size-4" />
          {runBusy ? "Running..." : "Run"}
        </Button>
      </div>
    </div>
  );
}
