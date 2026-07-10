// =============================================================================
// CONNECT SIDECAR
// Attaches the iPad and settles it into the configured display mode.
// =============================================================================

import { showHUD, showToast, Toast } from "@raycast/api";

import { describeOutcome, reportError } from "./lib/feedback";
import { loadConfig } from "./lib/preferences";
import { connectSidecar } from "./lib/sidecar";

/**
 * Connects the iPad over Sidecar, then forces extend or mirror.
 *
 * NOTE: Idempotent. Running it while already connected simply re-asserts mode.
 */
export default async function command(): Promise<void> {
  try {
    const config = await loadConfig();
    await showToast({ style: Toast.Style.Animated, title: `Connecting ${config.ipadName}…` });

    const outcome = await connectSidecar(config);
    await showHUD(describeOutcome(config, outcome));
  } catch (error) {
    await reportError(error, "Could not connect Sidecar");
  }
}
