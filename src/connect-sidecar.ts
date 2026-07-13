// =============================================================================
// CONNECT SIDECAR
// Attaches the iPad and settles it into the configured display mode.
// =============================================================================

import { showHUD, showToast, Toast } from "@raycast/api";

import { describeOutcome, reportError } from "./lib/feedback";
import {
  getBackend,
  getBetterDisplayCliPath,
  loadConfig,
  shouldFixMirrorAfterConnect,
} from "./lib/preferences";
import { connectSidecar } from "./lib/sidecar";
import { recordIntent } from "./lib/state";
import { reconnectVirtualScreens } from "./lib/virtualscreens";

/**
 * Connects the iPad over Sidecar, then forces extend or mirror.
 *
 * NOTE: Idempotent. Running it while already connected simply re-asserts mode.
 *   When "fix mirroring after connect" is enabled, the virtual screens are
 *   reconnected afterwards to clear macOS Sidecar's own mirror mode.
 */
export default async function command(): Promise<void> {
  try {
    const backend = getBackend();
    const config = await loadConfig(backend);
    await showToast({ style: Toast.Style.Animated, title: `Connecting ${config.ipadName}…` });

    const outcome = await connectSidecar(backend, config);
    await recordIntent("connected");

    if (shouldFixMirrorAfterConnect()) {
      await reconnectVirtualScreens(getBetterDisplayCliPath());
    }

    await showHUD(describeOutcome(config, outcome));
  } catch (error) {
    await reportError(error, "Could not connect Sidecar");
  }
}
