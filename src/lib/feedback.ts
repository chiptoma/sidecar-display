// =============================================================================
// FEEDBACK
// Turns command results and failures into Raycast HUDs and toasts.
// =============================================================================

import { showToast, Toast } from "@raycast/api";

import { SidecarError } from "./backend";

import type { ModeOutcome, SidecarConfig } from "./sidecar";

/**
 * Summarises what happened once the iPad reached (or missed) the target mode.
 *
 * @param config  - Resolved configuration, for the requested mode.
 * @param outcome - Result of the display-mode step.
 * @returns A single line suitable for a HUD.
 */
export function describeOutcome(config: SidecarConfig, outcome: ModeOutcome): string {
  const done = config.mode === "mirror" ? "mirrored" : "extended";
  const verb = config.mode === "mirror" ? "mirror" : "extend";

  if (outcome.skippedReason !== undefined) {
    return `Sidecar connected — ${outcome.skippedReason}`;
  }
  if (!outcome.settled) {
    return `Sidecar connected, but could not ${verb}`;
  }
  return `Sidecar ${done}`;
}

/**
 * Surfaces a failure as a toast, keeping BetterDisplay's own wording intact.
 *
 * @param error - Whatever was thrown.
 * @param title - Short headline for the toast.
 */
export async function reportError(error: unknown, title: string): Promise<void> {
  const message = error instanceof SidecarError || error instanceof Error ? error.message : String(error);

  await showToast({ style: Toast.Style.Failure, title, message });
}
