// =============================================================================
// SIDECAR ORCHESTRATION
// Connects an iPad over Sidecar and settles it into extend or mirror mode.
// -----------------------------------------------------------------------------
// Context: BetterDisplay applies display changes asynchronously, so a single
//   read races the change. Reads that gate a write must be confirmed stable
//   (two consecutive equal, non-null samples) before anything is written.
// Scope: Used by the connect, disconnect, and toggle commands.
// WARN: The main display is never written, and no display is ever disconnected
//   or cycled. The only topology writes are detaching the iPad from a mirror
//   set (extend) or folding the iPad into the current main's set (mirror), and
//   both are refused when the iPad itself is the main display.
// =============================================================================

import {
  BetterDisplayError,
  isSidecarConnected,
  listSidecarDevices,
  readMainDisplay,
  readMirrorState,
  setSidecarConnected,
  startMirroring,
  stopMirroring,
} from "./betterdisplay";

const POLL_INTERVAL_MS = 400;
const STABILITY_INTERVAL_MS = 500;

/** How the iPad should sit in the display arrangement once connected. */
export type DisplayMode = "extend" | "mirror";

/** Everything a command needs to drive BetterDisplay. */
export interface SidecarConfig {
  readonly cliPath: string;
  readonly ipadName: string;
  readonly mode: DisplayMode;
  readonly settleTimeoutMs: number;
}

/** What the display-mode step did, or why it safely declined to act. */
export interface ModeOutcome {
  readonly changed: boolean;
  readonly settled: boolean;
  readonly skippedReason?: string;
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
 * Waits until the iPad's mirror state reads the same non-null value twice.
 *
 * @param config - Resolved configuration.
 * @returns The settled mirror state, or null if it never stabilised in time.
 *
 * NOTE: This is the gate that keeps a flaky or phantom Sidecar connection from
 *   ever reaching a topology write. A display that keeps appearing and
 *   vanishing never yields two consecutive equal reads, so it returns null.
 */
async function awaitStableMirrorState(config: SidecarConfig): Promise<boolean | null> {
  const deadline = Date.now() + config.settleTimeoutMs;
  let previous = await readMirrorState(config.cliPath, config.ipadName);

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, STABILITY_INTERVAL_MS));
    const current = await readMirrorState(config.cliPath, config.ipadName);
    if (previous !== null && current !== null && previous === current) {
      return current;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    previous = current;
  }
}

/**
 * Reports whether the iPad is currently the main display.
 *
 * @param config - Resolved configuration.
 * @returns True when macOS treats the iPad as the main display.
 *
 * NOTE: macOS may promote a freshly connected Sidecar display to main on its
 *   own. When that happens the extension declines to touch display modes, since
 *   it must never write the main display or its status.
 */
async function ipadIsMainDisplay(config: SidecarConfig): Promise<boolean> {
  const main = await readMainDisplay(config.cliPath);
  return main !== null && main.name === config.ipadName;
}

/**
 * Resolves which iPad to act on, preferring an explicit override.
 *
 * @param cliPath  - Path to the CLI binary.
 * @param override - Name from preferences; empty or blank means auto-detect.
 * @returns The Sidecar device name to pass as a specifier.
 *
 * WARN: `get --sidecarList` lists paired devices whether or not they are
 *   reachable, so a returned name is not a promise that the iPad can connect.
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
 * Folds the iPad into the current main display's mirror set.
 *
 * @param config - Resolved configuration.
 *
 * WARN: The current main display stays the master; the iPad is only ever the
 *   target. Mirroring the other way promotes the iPad to master and moves the
 *   user's windows.
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
 * Brings the iPad into the requested display mode, or safely declines.
 *
 * @param config - Resolved configuration.
 * @returns Whether a change was made and whether it settled, or the reason the
 *   step was skipped.
 *
 * NOTE: Every write is gated on a stable, present iPad display that is not the
 *   main display. If the iPad is not stably present, or is main, no display is
 *   written at all. There is no escalation path and nothing is ever cycled or
 *   disconnected.
 */
export async function ensureDisplayMode(config: SidecarConfig): Promise<ModeOutcome> {
  const wantMirror = config.mode === "mirror";

  const current = await awaitStableMirrorState(config);
  if (current === null) {
    throw new BetterDisplayError(
      `The iPad display “${config.ipadName}” is not stably present; made no display changes.`,
    );
  }

  if (await ipadIsMainDisplay(config)) {
    return {
      changed: false,
      settled: false,
      skippedReason: "the iPad is the main display, so its mode was left untouched",
    };
  }

  if (current === wantMirror) {
    return { changed: false, settled: true };
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

  return { changed: true, settled };
}

// -----------------------------------------------------------
// LINK CONTROL
// -----------------------------------------------------------

/**
 * Attaches the iPad, confirms its display is stable, then settles the mode.
 *
 * @param config - Resolved configuration.
 * @returns The outcome of the display-mode step.
 *
 * NOTE: Idempotent. The link write is skipped when already connected, because
 *   BetterDisplay rejects it in that case. If the link never comes up, or the
 *   display never stabilises, this throws before any display write happens.
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
