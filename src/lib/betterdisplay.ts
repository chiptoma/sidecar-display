// =============================================================================
// BETTERDISPLAY CLI
// Thin, typed wrapper around the `betterdisplaycli` binary.
// -----------------------------------------------------------------------------
// Context: Every call shells out to BetterDisplay, which must be running.
// Scope: Only the operations needed to connect Sidecar and control mirroring.
// NOTE: Arguments are passed via execFile (never a shell string), so display
//   names containing quotes or apostrophes are safe.
// WARN: Never issue a `--main` write. Changing the main display relocates the
//   user's windows. Mirroring must always target the existing master.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 15_000;
const FAILURE_MARKER = "Failed.";
const GROUP_TYPE = "DisplayGroup";
const VIRTUAL_TYPE = "VirtualScreen";

/** A display, virtual screen, or group as reported by `get --identifiers`. */
export interface Device {
  readonly uuid: string;
  readonly name: string;
  readonly deviceType: string;
}

/** A Sidecar-capable device as reported by `get --sidecarList`. */
export interface SidecarDevice {
  readonly name: string;
  readonly uuid: string;
}

/** Raised when the CLI is missing, BetterDisplay is not running, or a call fails. */
export class BetterDisplayError extends Error {}

// -----------------------------------------------------------
// LOW-LEVEL INVOCATION
// -----------------------------------------------------------

/**
 * True when the CLI rejected the request rather than failing to run.
 *
 * @param cause - Whatever execFile rejected with.
 * @returns True if BetterDisplay printed its `Failed.` marker on stderr.
 *
 * NOTE: A rejected request exits 1 with `Failed.` on stderr and empty stdout.
 *   A missing binary or a stopped app fails differently, and must not be
 *   mistaken for "the display you asked about does not exist".
 */
function isRejection(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }
  const stderr = (cause as { stderr?: unknown }).stderr;
  return typeof stderr === "string" && stderr.trim().startsWith(FAILURE_MARKER);
}

/**
 * Invokes the CLI for a write, throwing when the request is rejected.
 *
 * @param cliPath - Absolute path to the `betterdisplaycli` binary.
 * @param args    - Operation and parameters, one array element each.
 *
 * WARN: Writes must never swallow a rejection, or a failed `set` would look
 *   like a display change that merely has not settled yet.
 */
async function writeCli(cliPath: string, args: readonly string[]): Promise<void> {
  try {
    await execFileAsync(cliPath, [...args], { timeout: CLI_TIMEOUT_MS });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new BetterDisplayError(`betterdisplaycli ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Invokes the CLI for a read, distinguishing rejection from breakage.
 *
 * @param cliPath - Absolute path to the `betterdisplaycli` binary.
 * @param args    - Operation and parameters, one array element each.
 * @returns Trimmed stdout, or null when BetterDisplay rejected the request.
 */
async function readCli(cliPath: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cliPath, [...args], { timeout: CLI_TIMEOUT_MS });
    return stdout.trim();
  } catch (cause) {
    if (isRejection(cause)) {
      return null;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new BetterDisplayError(`betterdisplaycli ${args.join(" ")} failed: ${detail}`);
  }
}

/** An identifier entry as BetterDisplay spells it, before normalisation. */
interface RawDevice {
  readonly UUID: string;
  readonly name: string;
  readonly deviceType: string;
}

/**
 * Narrows one parsed identifier entry to a RawDevice.
 *
 * @param value - Entry from the identifier list.
 * @returns True when the entry carries the three fields we rely on.
 *
 * NOTE: Display groups have no UUID and are rejected here.
 */
function isRawDevice(value: unknown): value is RawDevice {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.UUID === "string" && typeof entry.name === "string" && typeof entry.deviceType === "string"
  );
}

/**
 * Parses the pseudo-JSON emitted by `get --identifiers` into Devices.
 *
 * @param raw - Raw stdout: a comma-separated run of objects with no array wrapper.
 * @returns Devices carrying a UUID; groups and malformed entries are dropped.
 */
function toDevices(raw: string | null): readonly Device[] {
  if (raw === null || raw === "") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(`[${raw}]`);
  } catch {
    throw new BetterDisplayError(`Could not parse device list from BetterDisplay: ${raw.slice(0, 120)}`);
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(isRawDevice)
    .filter((device) => device.deviceType !== GROUP_TYPE)
    .map((device) => ({ uuid: device.UUID, name: device.name, deviceType: device.deviceType }));
}

// -----------------------------------------------------------
// SIDECAR
// -----------------------------------------------------------

/**
 * Lists iPads that macOS can attach over Sidecar.
 *
 * @param cliPath - Path to the CLI binary.
 * @returns One entry per Sidecar-capable device, possibly empty.
 */
export async function listSidecarDevices(cliPath: string): Promise<readonly SidecarDevice[]> {
  const raw = await readCli(cliPath, ["get", "--sidecarList"]);
  if (raw === null || raw === "") {
    return [];
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap((line) => {
      // Names may contain commas, so split on the final separator only.
      const cut = line.lastIndexOf(", ");
      if (cut === -1) {
        return [];
      }
      return [{ name: line.slice(0, cut).trim(), uuid: line.slice(cut + 2).trim() }];
    });
}

/**
 * Reports whether the given iPad is currently attached over Sidecar.
 *
 * @param cliPath   - Path to the CLI binary.
 * @param specifier - Sidecar device name or UUID.
 * @returns True when BetterDisplay reports the link as `on`.
 */
export async function isSidecarConnected(cliPath: string, specifier: string): Promise<boolean> {
  const raw = await readCli(cliPath, ["get", "--sidecarConnected", `--specifier=${specifier}`]);
  return raw === "on";
}

/**
 * Attaches or detaches the given iPad over Sidecar.
 *
 * @param cliPath   - Path to the CLI binary.
 * @param specifier - Sidecar device name or UUID.
 * @param connected - Desired link state.
 *
 * WARN: Not idempotent. BetterDisplay rejects this write when the link already
 *   sits in the requested state, so callers must read the state first.
 */
export async function setSidecarConnected(
  cliPath: string,
  specifier: string,
  connected: boolean,
): Promise<void> {
  await writeCli(cliPath, [
    "set",
    `--sidecarConnected=${connected ? "on" : "off"}`,
    `--specifier=${specifier}`,
  ]);
}

// -----------------------------------------------------------
// MIRRORING
// -----------------------------------------------------------

/**
 * Reports whether a display exists and is currently part of a mirror set.
 *
 * @param cliPath     - Path to the CLI binary.
 * @param displayName - Display name as shown in BetterDisplay.
 * @returns `on`/`off` as a boolean, or null when the display is absent.
 */
export async function readMirrorState(cliPath: string, displayName: string): Promise<boolean | null> {
  const raw = await readCli(cliPath, ["get", `--name=${displayName}`, "--mirror"]);
  if (raw === null) {
    return null;
  }
  return raw === "on";
}

/**
 * Detaches one display from its mirror set, leaving every other display alone.
 *
 * @param cliPath     - Path to the CLI binary.
 * @param displayName - Display to detach.
 *
 * NOTE: A no-op when the display already extends; it does not disturb `main`.
 */
export async function stopMirroring(cliPath: string, displayName: string): Promise<void> {
  await writeCli(cliPath, ["set", `--name=${displayName}`, "--mirror=off"]);
}

/**
 * Adds a display to an existing master's mirror set.
 *
 * @param cliPath    - Path to the CLI binary.
 * @param masterUuid - UUID of the display that stays the mirror master.
 * @param targetName - Display to fold into the mirror set.
 *
 * WARN: The master must be the display that is already main. Mirroring in the
 *   opposite direction promotes the target to master and relocates windows.
 */
export async function startMirroring(cliPath: string, masterUuid: string, targetName: string): Promise<void> {
  await writeCli(cliPath, ["set", `--UUID=${masterUuid}`, "--mirror=on", `--targetName=${targetName}`]);
}

// -----------------------------------------------------------
// DISPLAY TOPOLOGY
// -----------------------------------------------------------

/**
 * Returns the display macOS currently treats as main.
 *
 * @param cliPath - Path to the CLI binary.
 * @returns The main display, or null when BetterDisplay reports none.
 */
export async function readMainDisplay(cliPath: string): Promise<Device | null> {
  const raw = await readCli(cliPath, ["get", "--displayWithMainStatus", "--identifiers"]);
  return toDevices(raw)[0] ?? null;
}

/**
 * Lists every BetterDisplay virtual screen.
 *
 * @param cliPath - Path to the CLI binary.
 * @returns Virtual screens, possibly empty.
 */
export async function listVirtualScreens(cliPath: string): Promise<readonly Device[]> {
  const raw = await readCli(cliPath, ["get", `--type=${VIRTUAL_TYPE}`, "--identifiers"]);
  return toDevices(raw);
}

/**
 * Disconnects then reconnects a single virtual screen.
 *
 * @param cliPath - Path to the CLI binary.
 * @param uuid    - UUID of the virtual screen to cycle.
 * @param pauseMs - Delay between the disconnect and the reconnect.
 *
 * NOTE: Targeted by UUID so additional virtual screens are never disturbed.
 *   Always ends with `--connected=on`, even if the disconnect silently no-ops.
 */
export async function reconnectVirtualScreen(cliPath: string, uuid: string, pauseMs: number): Promise<void> {
  await writeCli(cliPath, ["set", `--UUID=${uuid}`, "--connected=off"]);
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
  await writeCli(cliPath, ["set", `--UUID=${uuid}`, "--connected=on"]);
}
