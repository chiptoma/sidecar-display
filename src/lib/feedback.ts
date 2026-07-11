// =============================================================================
// FEEDBACK
// Turns command results and failures into Raycast HUDs and toasts.
// =============================================================================

import { showToast, Toast } from "@raycast/api";

import { BetterDisplayError } from "./betterdisplay";

import type { ModeOutcome, SidecarConfig } from "./sidecar";

/**
 * Summarises what happened once the iPad reached (or missed) the target mode.
 *
 * @param config  - Resolved configuration, for the requested mode.
 * @param outcome - Result of the display-mode step.
 * @returns A single line suitable for a HUD.
 */
export function describeOutcome(config: SidecarConfig, outcome: ModeOutcome): string {
  const mode = config.mode === "mirror" ? "mirroring" : "extending";

  if (outcome.skippedReason !== undefined) {
    return `Sidecar connected — ${outcome.skippedReason}`;
  }
  if (!outcome.settled) {
    return `Sidecar connected, but it is not ${mode}`;
  }
  if (!outcome.changed) {
    return `Sidecar connected, already ${mode}`;
  }
  return `Sidecar connected, switched to ${mode}`;
}

/**
 * Surfaces a failure as a toast, keeping BetterDisplay's own wording intact.
 *
 * @param error - Whatever was thrown.
 * @param title - Short headline for the toast.
 */
export async function reportError(error: unknown, title: string): Promise<void> {
  const message =
    error instanceof BetterDisplayError || error instanceof Error ? error.message : String(error);

  await showToast({ style: Toast.Style.Failure, title, message });
}
