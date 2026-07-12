// =============================================================================
// SIDECAR ORCHESTRATION
// Connects an iPad over Sidecar and settles it into extend or mirror mode.
// -----------------------------------------------------------------------------
// Context: Engine-agnostic — every hardware touch goes through a SidecarBackend,
//   so this module is unit-testable against a mock. Backends apply display
//   changes asynchronously, so a read that gates a write is confirmed stable
//   (two consecutive equal, non-null samples) first.
// WARN: The main display is never written, and no display is ever disconnected
//   or cycled. The only mode writes are detaching the iPad from a mirror set
//   (extend) or folding it into the current main's set (mirror), and both are
//   skipped when the iPad itself is the main display.
// =============================================================================

import { SidecarError } from "./backend";

import type { DisplayMode, SidecarBackend } from "./backend";

const POLL_INTERVAL_MS = 400;
const STABILITY_INTERVAL_MS = 500;

/** What a command needs beyond the backend: the device and timing. */
export interface SidecarConfig {
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
 * @param backend - The engine.
 * @param config  - Resolved configuration.
 * @returns The settled mirror state, or null if it never stabilised in time.
 *
 * NOTE: This gate keeps a flaky or phantom Sidecar connection from ever reaching
 *   a topology write. A display that keeps appearing and vanishing never yields
 *   two consecutive equal reads, so it returns null.
 */
async function awaitStableMirrorState(
  backend: SidecarBackend,
  config: SidecarConfig,
): Promise<boolean | null> {
  const deadline = Date.now() + config.settleTimeoutMs;
  let previous = await backend.readMirror(config.ipadName);

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, STABILITY_INTERVAL_MS));
    const current = await backend.readMirror(config.ipadName);
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
 * Resolves which iPad to act on, preferring an explicit override.
 *
 * @param backend  - The engine.
 * @param override - Name from preferences/selection; empty means auto-detect.
 * @returns The Sidecar device name to act on.
 *
 * WARN: A device list includes paired-but-unreachable devices, so a returned
 *   name is not a promise that the iPad can connect.
 */
export async function resolveIpadName(backend: SidecarBackend, override: string): Promise<string> {
  const pinned = override.trim();
  if (pinned !== "") {
    return pinned;
  }

  const devices = await backend.listDevices();
  if (devices.length === 0) {
    throw new SidecarError("No Sidecar devices found. Is your iPad signed in to the same Apple ID?");
  }
  if (devices.length > 1) {
    const names = devices.map((device) => device.name).join(", ");
    throw new SidecarError(`Multiple Sidecar devices found (${names}). Set “iPad Name” in preferences.`);
  }
  return devices[0].name;
}

// -----------------------------------------------------------
// DISPLAY MODE
// -----------------------------------------------------------

/**
 * Brings the iPad into the requested display mode, or safely declines.
 *
 * @param backend - The engine.
 * @param config  - Resolved configuration.
 * @returns Whether a change was made and whether it settled, or the reason the
 *   step was skipped.
 *
 * NOTE: Every write is gated on a stable, present iPad display that is not the
 *   main display. There is no escalation path and nothing is ever cycled.
 */
export async function ensureDisplayMode(
  backend: SidecarBackend,
  config: SidecarConfig,
): Promise<ModeOutcome> {
  const wantMirror = config.mode === "mirror";

  const current = await awaitStableMirrorState(backend, config);
  if (current === null) {
    throw new SidecarError(
      `The iPad display “${config.ipadName}” is not stably present; made no display changes.`,
    );
  }

  if (await backend.isIpadMain(config.ipadName)) {
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
    await backend.mirrorToMain(config.ipadName);
  } else {
    await backend.extend(config.ipadName);
  }

  const settled = await pollUntil(
    async () => (await backend.readMirror(config.ipadName)) === wantMirror,
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
 * @param backend - The engine.
 * @param config  - Resolved configuration.
 * @returns The outcome of the display-mode step.
 *
 * NOTE: Idempotent. The link write is skipped when already connected. If the
 *   link never comes up, or the display never stabilises, this throws before any
 *   display write happens.
 */
export async function connectSidecar(backend: SidecarBackend, config: SidecarConfig): Promise<ModeOutcome> {
  if (!(await backend.isConnected(config.ipadName))) {
    await backend.setConnected(config.ipadName, true);

    const linked = await pollUntil(() => backend.isConnected(config.ipadName), config.settleTimeoutMs);
    if (!linked) {
      throw new SidecarError("Sidecar did not connect. Is the iPad awake and nearby?");
    }
  }

  return ensureDisplayMode(backend, config);
}

/**
 * Detaches the iPad and waits for the link to drop.
 *
 * @param backend - The engine.
 * @param config  - Resolved configuration.
 *
 * NOTE: Idempotent. Returns immediately when the link is already down.
 */
export async function disconnectSidecar(backend: SidecarBackend, config: SidecarConfig): Promise<void> {
  if (!(await backend.isConnected(config.ipadName))) {
    return;
  }

  await backend.setConnected(config.ipadName, false);

  const dropped = await pollUntil(
    async () => !(await backend.isConnected(config.ipadName)),
    config.settleTimeoutMs,
  );
  if (!dropped) {
    throw new SidecarError("Sidecar did not disconnect.");
  }
}

/**
 * Reports whether the iPad is currently attached.
 *
 * @param backend - The engine.
 * @param config  - Resolved configuration.
 * @returns True when the Sidecar link is up.
 */
export async function isConnected(backend: SidecarBackend, config: SidecarConfig): Promise<boolean> {
  return backend.isConnected(config.ipadName);
}
