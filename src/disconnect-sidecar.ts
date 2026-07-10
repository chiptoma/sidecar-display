// =============================================================================
// DISCONNECT SIDECAR
// Detaches the iPad and waits for the link to drop.
// =============================================================================

import { showHUD, showToast, Toast } from "@raycast/api";

import { reportError } from "./lib/feedback";
import { loadConfig } from "./lib/preferences";
import { disconnectSidecar } from "./lib/sidecar";

/**
 * Disconnects the iPad over Sidecar.
 *
 * NOTE: Idempotent. Running it while already disconnected is a no-op.
 */
export default async function command(): Promise<void> {
  try {
    const config = await loadConfig();
    await showToast({ style: Toast.Style.Animated, title: `Disconnecting ${config.ipadName}…` });

    await disconnectSidecar(config);
    await showHUD("Sidecar disconnected");
  } catch (error) {
    await reportError(error, "Could not disconnect Sidecar");
  }
}
