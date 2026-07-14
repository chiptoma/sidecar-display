// =============================================================================
// RECONNECT VIRTUAL SCREENS
// Cycles BetterDisplay virtual screens to fix Sidecar-layer mirroring.
// =============================================================================

import { showHUD, showToast, Toast } from "@raycast/api";

import { reportError } from "./lib/feedback";
import { betterDisplayAvailable, getBetterDisplayCliPath, getMirrorFixMethod } from "./lib/preferences";
import { fixMirror } from "./lib/virtualscreens";

/**
 * Clears Sidecar's mirror mode using the chosen method.
 *
 * NOTE: Use this when the iPad connects showing a copy of the main screen —
 *   macOS Sidecar's own mirror mode, which the display APIs cannot toggle.
 *   Re-triggers the arrangement so the iPad extends. Requires BetterDisplay.
 */
export default async function command(): Promise<void> {
  if (!betterDisplayAvailable()) {
    await showToast({
      style: Toast.Style.Failure,
      title: "BetterDisplay required",
      message: "This fix needs BetterDisplay and betterdisplaycli installed.",
    });
    return;
  }

  try {
    await showToast({ style: Toast.Style.Animated, title: "Fixing mirroring…" });
    await fixMirror(getBetterDisplayCliPath(), getMirrorFixMethod());
    await showHUD("Mirroring fixed");
  } catch (error) {
    await reportError(error, "Could not fix mirroring");
  }
}
