// =============================================================================
// RECONNECT VIRTUAL SCREENS
// Cycles BetterDisplay virtual screens to fix Sidecar-layer mirroring.
// =============================================================================

import { showHUD, showToast, Toast } from "@raycast/api";

import { reportError } from "./lib/feedback";
import { betterDisplayAvailable, getBetterDisplayCliPath } from "./lib/preferences";
import { reconnectVirtualScreens } from "./lib/virtualscreens";

/**
 * Reconnects the virtual screen (the classic "Reconnect virtual displays").
 *
 * NOTE: Use this when the iPad connects showing a mirror of the main screen —
 *   macOS Sidecar's own mirror mode, which the display APIs cannot toggle.
 *   Cycling the main virtual screen re-triggers the arrangement so the iPad
 *   extends. Requires BetterDisplay, since virtual screens are its construct.
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
    await showToast({ style: Toast.Style.Animated, title: "Reconnecting virtual screen…" });
    await reconnectVirtualScreens(getBetterDisplayCliPath());
    await showHUD("Virtual screen reconnected");
  } catch (error) {
    await reportError(error, "Could not reconnect the virtual screen");
  }
}
