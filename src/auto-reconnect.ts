// =============================================================================
// AUTO-RECONNECT (BACKGROUND)
// Restores a Sidecar link that dropped on its own, with backoff.
// -----------------------------------------------------------------------------
// Context: Raycast runs this on a background interval (enable it in the command
//   settings). There is no on-wake event, so "reconnect after sleep" happens on
//   the next scheduled tick, within roughly one interval.
// WARN: Reconnects only when the user wants the iPad connected and the link
//   dropped by itself. A deliberate disconnect is never chased. It never writes
//   the main display. All timing is configurable; see readKeepAliveTuning.
// =============================================================================

import { environment, LaunchType, showHUD } from "@raycast/api";

import { reportError } from "./lib/feedback";
import { decideKeepAlive } from "./lib/keepalive";
import { loadConfig, readKeepAliveTuning } from "./lib/preferences";
import { connectSidecar, isConnected } from "./lib/sidecar";
import { loadKeepAliveState, recordIntent, saveKeepAliveState } from "./lib/state";

/**
 * One keep-alive tick: reconnect if the link dropped on its own.
 *
 * NOTE: When run by hand (UserInitiated) it re-arms the intent to "connected"
 *   first, so invoking it acts as a "reconnect now" and restarts the fast phase.
 *   On a background tick it only acts on the persisted intent.
 */
export default async function command(): Promise<void> {
  try {
    if (environment.launchType === LaunchType.UserInitiated) {
      await recordIntent("connected");
    }

    const config = await loadConfig();
    const linkUp = await isConnected(config);

    const decision = decideKeepAlive({
      ...readKeepAliveTuning(),
      isConnected: linkUp,
      nowMs: Date.now(),
      state: await loadKeepAliveState(),
    });

    await saveKeepAliveState(decision.nextState);

    if (decision.action === "reconnect") {
      await connectSidecar(config);
      if (environment.launchType === LaunchType.UserInitiated) {
        await showHUD(`Reconnected ${config.ipadName}`);
      }
    }
  } catch (error) {
    // A failed background attempt is expected when the iPad is genuinely gone;
    // only surface it when the user ran the command themselves.
    if (environment.launchType === LaunchType.UserInitiated) {
      await reportError(error, "Could not reconnect Sidecar");
    }
  }
}
