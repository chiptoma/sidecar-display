// =============================================================================
// SIDECAR ORCHESTRATION
// Connects an iPad over Sidecar and settles it into extend or mirror mode.
// -----------------------------------------------------------------------------
// Context: BetterDisplay applies display changes asynchronously, so every write
//   is followed by a poll rather than a fixed sleep. A single sample races the
//   change and reads a stale value.
// Scope: Used by the connect, disconnect, and toggle commands.
// WARN: The main display is never written. Mirroring folds the iPad into the
//   existing master's set; the reverse direction would relocate the user's
//   windows onto the iPad.
// =============================================================================

import {
  BetterDisplayError,
  isSidecarConnected,
  listSidecarDevices,
  listVirtualScreens,
  readMainDisplay,
  readMirrorState,
  reconnectVirtualScreen,
  setSidecarConnected,
  startMirroring,
  stopMirroring,
} from "./betterdisplay";

const POLL_INTERVAL_MS = 400;
const VIRTUAL_SCREEN_PAUSE = 1_500;

/** How the iPad should sit in the display arrangement once connected. */
export type DisplayMode = "extend" | "mirror";

/** Everything a command needs to drive BetterDisplay. */
export interface SidecarConfig {
  readonly cliPath: string;
  readonly ipadName: string;
  readonly mode: DisplayMode;
  readonly reconnectVirtualScreens: boolean;
  readonly settleTimeoutMs: number;
}

/** What `ensureDisplayMode` had to do to reach the requested mode. */
export interface ModeOutcome {
  readonly changed: boolean;
  readonly settled: boolean;
  readonly escalated: boolean;
}

// -----------------------------------------------------------
// POLLING HELPERS
// -----------------------------------------------------------

/**
 * Polls a predicate until it holds or the budget runs out.
 *
 * @param probe     - Async check; resolves true once the desired state is live.
 * @param timeoutMs - Total time to keep polling.
 * @returns True if the predicate held before the deadline.
 */
async function pollUntil(probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Resolves which iPad to act on, preferring an explicit override.
 *
 * @param cliPath  - Path to the CLI binary.
 * @param override - Name from preferences; empty or blank means auto-detect.
 * @returns The Sidecar device name to pass as a specifier.
 */
export async function resolveIpadName(cliPath: string, override: string): Promise<string> {
  const pinned = override.trim();
  if (pinned !== "") {
    return pinned;
  }

  const devices = await listSidecarDevices(cliPath);
  if (devices.length === 0) {
    throw new BetterDisplayError("No Sidecar devices found. Is your iPad signed in to the same Apple ID?");
  }
  if (devices.length > 1) {
    const names = devices.map((device) => device.name).join(", ");
    throw new BetterDisplayError(
      `Multiple Sidecar devices found (${names}). Set “iPad Name” in preferences.`,
    );
  }
  return devices[0].name;
}

// -----------------------------------------------------------
// DISPLAY MODE
// -----------------------------------------------------------

/**
 * Folds the iPad into the current master's mirror set.
 *
 * @param config - Resolved configuration.
 *
 * WARN: Refuses when the iPad is itself main, since mirroring onto it would
 *   move every window across.
 */
async function applyMirror(config: SidecarConfig): Promise<void> {
  const main = await readMainDisplay(config.cliPath);
  if (main === null) {
    throw new BetterDisplayError("BetterDisplay reports no main display; refusing to mirror.");
  }
  if (main.name === config.ipadName) {
    throw new BetterDisplayError("The iPad is currently the main display; refusing to mirror onto it.");
  }
  await startMirroring(config.cliPath, main.uuid, config.ipadName);
}

/**
 * Cycles every virtual screen, then re-asserts extend mode.
 *
 * @param config - Resolved configuration.
 * @returns True once the iPad reads as extended.
 *
 * NOTE: Last-resort path. Each virtual screen is cycled by UUID so a second
 *   virtual screen is never disturbed.
 */
async function escalateToVirtualScreenReconnect(config: SidecarConfig): Promise<boolean> {
  for (const screen of await listVirtualScreens(config.cliPath)) {
    await reconnectVirtualScreen(config.cliPath, screen.uuid, VIRTUAL_SCREEN_PAUSE);
  }
  await stopMirroring(config.cliPath, config.ipadName);
  return pollUntil(
    async () => (await readMirrorState(config.cliPath, config.ipadName)) === false,
    config.settleTimeoutMs,
  );
}

/**
 * Brings the iPad into the requested display mode, escalating only if needed.
 *
 * @param config - Resolved configuration.
 * @returns Whether a change was made, whether it settled, and whether the
 *   virtual-screen reconnect was needed.
 */
export async function ensureDisplayMode(config: SidecarConfig): Promise<ModeOutcome> {
  const wantMirror = config.mode === "mirror";
  const current = await readMirrorState(config.cliPath, config.ipadName);

  if (current === null) {
    throw new BetterDisplayError(`BetterDisplay cannot see a display named “${config.ipadName}”.`);
  }
  if (current === wantMirror) {
    return { changed: false, settled: true, escalated: false };
  }

  if (wantMirror) {
    await applyMirror(config);
  } else {
    await stopMirroring(config.cliPath, config.ipadName);
  }

  const settled = await pollUntil(
    async () => (await readMirrorState(config.cliPath, config.ipadName)) === wantMirror,
    config.settleTimeoutMs,
  );

  if (settled || wantMirror || !config.reconnectVirtualScreens) {
    return { changed: true, settled, escalated: false };
  }

  return { changed: true, settled: await escalateToVirtualScreenReconnect(config), escalated: true };
}

// -----------------------------------------------------------
// LINK CONTROL
// -----------------------------------------------------------

/**
 * Attaches the iPad, waits for its display to appear, then settles the mode.
 *
 * @param config - Resolved configuration.
 * @returns The outcome of the display-mode step.
 *
 * NOTE: Idempotent. The link write is skipped when already connected, because
 *   BetterDisplay rejects it in that case; the mode is still re-asserted.
 */
export async function connectSidecar(config: SidecarConfig): Promise<ModeOutcome> {
  if (!(await isSidecarConnected(config.cliPath, config.ipadName))) {
    await setSidecarConnected(config.cliPath, config.ipadName, true);

    const linked = await pollUntil(
      () => isSidecarConnected(config.cliPath, config.ipadName),
      config.settleTimeoutMs,
    );
    if (!linked) {
      throw new BetterDisplayError("Sidecar did not connect. Is the iPad awake and nearby?");
    }
  }

  const visible = await pollUntil(
    async () => (await readMirrorState(config.cliPath, config.ipadName)) !== null,
    config.settleTimeoutMs,
  );
  if (!visible) {
    throw new BetterDisplayError("The iPad connected but no display appeared.");
  }

  return ensureDisplayMode(config);
}

/**
 * Detaches the iPad and waits for the link to drop.
 *
 * @param config - Resolved configuration.
 *
 * NOTE: Idempotent. Returns immediately when the link is already down, because
 *   BetterDisplay rejects a redundant disconnect.
 */
export async function disconnectSidecar(config: SidecarConfig): Promise<void> {
  if (!(await isSidecarConnected(config.cliPath, config.ipadName))) {
    return;
  }

  await setSidecarConnected(config.cliPath, config.ipadName, false);

  const dropped = await pollUntil(
    async () => !(await isSidecarConnected(config.cliPath, config.ipadName)),
    config.settleTimeoutMs,
  );
  if (!dropped) {
    throw new BetterDisplayError("Sidecar did not disconnect.");
  }
}

/**
 * Reports whether the iPad is currently attached.
 *
 * @param config - Resolved configuration.
 * @returns True when the Sidecar link is up.
 */
export async function isConnected(config: SidecarConfig): Promise<boolean> {
  return isSidecarConnected(config.cliPath, config.ipadName);
}
