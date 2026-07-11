// =============================================================================
// AUTO-RECONNECT (BACKGROUND)
// Restores a Sidecar link that dropped on its own, with backoff.
// -----------------------------------------------------------------------------
// Context: Raycast runs this on a background interval (enable it in the command
//   settings). There is no on-wake event, so "reconnect after sleep" happens on
//   the next scheduled tick, within roughly one interval.
// WARN: Reconnects only when the user wants the iPad connected and the link
//   dropped by itself. A deliberate disconnect, or a device absent past the
//   attempt budget, is left alone. It never writes the main display.
// =============================================================================

import { environment, getPreferenceValues, LaunchType, showHUD } from "@raycast/api";

import { reportError } from "./lib/feedback";
import { decideKeepAlive } from "./lib/keepalive";
import { loadConfig } from "./lib/preferences";
import { connectSidecar, isConnected } from "./lib/sidecar";
import { loadKeepAliveState, recordIntent, saveKeepAliveState } from "./lib/state";

const BACKOFF_BASE_MS = 15_000;
const BACKOFF_CAP_MS = 2 * 60_000;
const DORMANT_RETRY_MS = 15 * 60_000;
const WAKE_GAP_MS = 3 * 60_000;
const DEFAULT_FAST_ATTEMPTS = 8;

/**
 * Clamps the configured fast-attempt budget into a sane range.
 *
 * @param value - Raw preference text, possibly empty or non-numeric.
 * @returns A positive integer number of fast attempts before the slow heartbeat.
 */
function parseFastAttempts(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_FAST_ATTEMPTS;
  }
  return Math.min(parsed, 100);
}

/**
 * One keep-alive tick: reconnect if the link dropped on its own.
 *
 * NOTE: When run by hand (UserInitiated) it re-arms the intent to "connected"
 *   first, so invoking it acts as a "reconnect now" and clears an earlier
 *   give-up. On a background tick it only acts on the persisted intent.
 */
export default async function command(): Promise<void> {
  try {
    if (environment.launchType === LaunchType.UserInitiated) {
      await recordIntent("connected");
    }

    const config = await loadConfig();
    const prefs = getPreferenceValues<Preferences>();
    const linkUp = await isConnected(config);

    const decision = decideKeepAlive({
      isConnected: linkUp,
      nowMs: Date.now(),
      state: await loadKeepAliveState(),
      fastAttempts: parseFastAttempts(prefs.fastReconnectAttempts ?? ""),
      backoffBaseMs: BACKOFF_BASE_MS,
      backoffCapMs: BACKOFF_CAP_MS,
      dormantRetryMs: DORMANT_RETRY_MS,
      wakeGapMs: WAKE_GAP_MS,
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
