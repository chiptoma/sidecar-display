// =============================================================================
// KEEP-ALIVE DECISION
// Pure state machine deciding whether a background tick should reconnect.
// -----------------------------------------------------------------------------
// Context: Raycast runs the auto-reconnect command on an interval (there is no
//   on-wake or display-change event). Each tick feeds the live link state and
//   the persisted intent into `decideKeepAlive`, which returns an action and
//   the next state to persist. No I/O happens here, so it is unit-testable.
// WARN: Reconnect fires ONLY when the user wants the iPad connected and the link
//   dropped on its own. A deliberate disconnect, or a device that stays absent
//   past the attempt budget, yields "none" — the extension never nags.
// =============================================================================

/** Whether the user currently wants the iPad connected. */
export type LinkIntent = "connected" | "disconnected";

/** What a keep-alive tick concluded it should do. */
export type KeepAliveAction = "none" | "reconnect";

/** Persisted keep-alive bookkeeping, carried between background ticks. */
export interface KeepAliveState {
  readonly intent: LinkIntent;
  readonly failedAttempts: number;
  readonly lastAttemptAtMs: number;
  readonly gaveUp: boolean;
}

/** Everything a single decision needs. */
export interface KeepAliveInputs {
  readonly isConnected: boolean;
  readonly nowMs: number;
  readonly state: KeepAliveState;
  readonly maxAttempts: number;
  readonly backoffBaseMs: number;
  readonly backoffCapMs: number;
}

/** The action to take now, plus the state to persist afterwards. */
export interface KeepAliveDecision {
  readonly action: KeepAliveAction;
  readonly nextState: KeepAliveState;
}

/** The state a fresh install (or a manual connect) starts from. */
export const INITIAL_STATE: KeepAliveState = {
  intent: "disconnected",
  failedAttempts: 0,
  lastAttemptAtMs: 0,
  gaveUp: false,
};

/**
 * Exponential backoff for the Nth consecutive failed attempt.
 *
 * @param attempts - Failed attempts so far.
 * @param baseMs   - Delay before the first retry.
 * @param capMs    - Upper bound on the delay.
 * @returns Milliseconds to wait before the next attempt.
 */
function backoffFor(attempts: number, baseMs: number, capMs: number): number {
  return Math.min(baseMs * 2 ** attempts, capMs);
}

/**
 * Decides whether this tick should reconnect, and the state to persist next.
 *
 * @param inputs - Live link state, persisted state, and backoff tuning.
 * @returns The action to take and the next state.
 *
 * NOTE: A live link always clears the counters. A dropped link is only chased
 *   when the intent is "connected", the attempt budget is not spent, and the
 *   backoff window has elapsed.
 */
export function decideKeepAlive(inputs: KeepAliveInputs): KeepAliveDecision {
  const { isConnected, nowMs, state, maxAttempts, backoffBaseMs, backoffCapMs } = inputs;

  if (isConnected) {
    if (state.failedAttempts === 0 && !state.gaveUp) {
      return { action: "none", nextState: state };
    }
    return { action: "none", nextState: { ...state, failedAttempts: 0, gaveUp: false } };
  }

  if (state.intent === "disconnected" || state.gaveUp) {
    return { action: "none", nextState: state };
  }

  if (state.failedAttempts >= maxAttempts) {
    return { action: "none", nextState: { ...state, gaveUp: true } };
  }

  const waited = nowMs - state.lastAttemptAtMs;
  if (waited < backoffFor(state.failedAttempts, backoffBaseMs, backoffCapMs)) {
    return { action: "none", nextState: state };
  }

  return {
    action: "reconnect",
    nextState: { ...state, failedAttempts: state.failedAttempts + 1, lastAttemptAtMs: nowMs },
  };
}

/**
 * Records the user's explicit intent, resetting the retry budget.
 *
 * @param intent - What the user just asked for.
 * @returns A fresh state anchored to that intent.
 *
 * NOTE: Called whenever the user manually connects or disconnects, so a manual
 *   connect re-arms keep-alive after it has given up, and a manual disconnect
 *   stops it dead.
 */
export function stateForIntent(intent: LinkIntent): KeepAliveState {
  return { intent, failedAttempts: 0, lastAttemptAtMs: 0, gaveUp: false };
}
