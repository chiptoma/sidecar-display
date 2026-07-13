// =============================================================================
// RECONNECT VIRTUAL SCREENS
// Cycles BetterDisplay virtual screens to fix Sidecar-layer mirroring.
// =============================================================================

import { showHUD, showToast, Toast } from "@raycast/api";

import { reportError } from "./lib/feedback";
import { getBetterDisplayCliPath } from "./lib/preferences";
import { reconnectVirtualScreens } from "./lib/virtualscreens";

/**
 * Reconnects the virtual screens (the classic "Reconnect virtual displays").
 *
 * NOTE: Use this when the iPad connects showing a mirror of the main screen —
 *   macOS Sidecar's own mirror mode, which the display APIs cannot toggle.
 *   Cycling the virtual screen re-triggers the arrangement so the iPad extends.
 */
export default async function command(): Promise<void> {
  try {
    await showToast({ style: Toast.Style.Animated, title: "Reconnecting virtual screens…" });
    await reconnectVirtualScreens(getBetterDisplayCliPath());
    await showHUD("Virtual screens reconnected");
  } catch (error) {
    await reportError(error, "Could not reconnect virtual screens");
  }
}
