// =============================================================================
// PERSISTENT STATE
// Stores keep-alive bookkeeping and the chosen device across command runs.
// -----------------------------------------------------------------------------
// Context: Raycast commands are short-lived and share nothing in memory, so the
//   keep-alive intent and the selected device must live in LocalStorage. This
//   module is the only place that touches it.
// =============================================================================

import { LocalStorage } from "@raycast/api";

import { INITIAL_STATE } from "./keepalive";

import type { KeepAliveState, LinkIntent } from "./keepalive";

const KEEP_ALIVE_KEY = "keepAliveState";
const DEVICE_KEY = "selectedDeviceName";

/**
 * Reads the persisted keep-alive state, falling back to the initial state.
 *
 * @returns The stored state, or the initial state when nothing is stored or the
 *   stored value is unreadable.
 */
export async function loadKeepAliveState(): Promise<KeepAliveState> {
  const raw = await LocalStorage.getItem<string>(KEEP_ALIVE_KEY);
  if (raw === undefined) {
    return INITIAL_STATE;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<KeepAliveState>;
    return {
      intent: parsed.intent === "connected" ? "connected" : "disconnected",
      failedAttempts: typeof parsed.failedAttempts === "number" ? parsed.failedAttempts : 0,
      lastAttemptAtMs: typeof parsed.lastAttemptAtMs === "number" ? parsed.lastAttemptAtMs : 0,
      gaveUp: parsed.gaveUp === true,
    };
  } catch {
    return INITIAL_STATE;
  }
}

/**
 * Persists the keep-alive state.
 *
 * @param state - State to store.
 */
export async function saveKeepAliveState(state: KeepAliveState): Promise<void> {
  await LocalStorage.setItem(KEEP_ALIVE_KEY, JSON.stringify(state));
}

/**
 * Records the user's explicit connect/disconnect intent.
 *
 * @param intent - What the user just asked for.
 *
 * NOTE: Re-arms (or stops) keep-alive by resetting the retry budget, so this is
 *   called from every manual connect, disconnect, and toggle.
 */
export async function recordIntent(intent: LinkIntent): Promise<void> {
  await saveKeepAliveState({ intent, failedAttempts: 0, lastAttemptAtMs: 0, gaveUp: false });
}

/**
 * Reads the user's pinned device name, if any.
 *
 * @returns The stored device name, or the empty string when none is stored.
 */
export async function loadSelectedDevice(): Promise<string> {
  return (await LocalStorage.getItem<string>(DEVICE_KEY)) ?? "";
}

/**
 * Persists the chosen device name for other commands to read.
 *
 * @param name - Device name to store.
 */
export async function saveSelectedDevice(name: string): Promise<void> {
  await LocalStorage.setItem(DEVICE_KEY, name);
}
