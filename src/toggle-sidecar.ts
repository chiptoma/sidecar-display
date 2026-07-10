// =============================================================================
// TOGGLE SIDECAR
// Connects the iPad when detached, disconnects it when attached.
// =============================================================================

import { showHUD, showToast, Toast } from "@raycast/api";

import { describeOutcome, reportError } from "./lib/feedback";
import { loadConfig } from "./lib/preferences";
import { connectSidecar, disconnectSidecar, isConnected } from "./lib/sidecar";

/**
 * Flips the Sidecar link, applying the configured display mode on connect.
 *
 * NOTE: State is read before acting, so this never guesses the direction the
 *   way a blind System Settings menu click does.
 */
export default async function command(): Promise<void> {
  try {
    const config = await loadConfig();

    if (await isConnected(config)) {
      await showToast({ style: Toast.Style.Animated, title: `Disconnecting ${config.ipadName}…` });
      await disconnectSidecar(config);
      await showHUD("Sidecar disconnected");
      return;
    }

    await showToast({ style: Toast.Style.Animated, title: `Connecting ${config.ipadName}…` });
    const outcome = await connectSidecar(config);
    await showHUD(describeOutcome(config, outcome));
  } catch (error) {
    await reportError(error, "Could not toggle Sidecar");
  }
}
