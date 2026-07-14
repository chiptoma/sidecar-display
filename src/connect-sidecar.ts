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
 *   When "fix mirroring" is enabled, the mirror fix runs afterwards on a fresh
 *   connect to clear macOS Sidecar's own mirror mode.
 */
export default async function command(): Promise<void> {
  try {
    const backend = getBackend();
    const config = await loadConfig(backend);
    await showToast({ style: Toast.Style.Animated, title: `Connecting ${config.ipadName}…` });

    // Record intent before the attempt so a connect that then fails is still
    // treated as "wanted" by auto-reconnect, matching disconnect and the menu.
    await recordIntent("connected");
    const outcome = await connectSidecar(backend, config);

    // Only fix mirroring on a genuine fresh connect — not when re-running the
    // command on an already-connected iPad — so it never reshuffles needlessly.
    // The connect already succeeded here, so a failing fix is reported on its
    // own rather than as a connect failure.
    if (shouldFixMirrorAfterConnect() && outcome.linkEstablished === true) {
      try {
        await reconnectVirtualScreens(getBetterDisplayCliPath());
      } catch (fixError) {
        await reportError(fixError, "Connected, but could not fix mirroring");
        return;
      }
    }

    await showHUD(describeOutcome(config, outcome));
  } catch (error) {
    await reportError(error, "Could not connect Sidecar");
  }
}
