// =============================================================================
// BETTERDISPLAY BACKEND
// A SidecarBackend implemented over the `betterdisplaycli` binary.
// -----------------------------------------------------------------------------
// Context: Every call shells out to BetterDisplay, which must be running.
// NOTE: Arguments are passed via execFile (never a shell string), so display
//   names containing quotes or apostrophes are safe.
// WARN: Never issues a `--main` write, and never disconnects a display.
//   Mirroring always targets the existing main display as the master.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SidecarError } from "./backend";

import type { SidecarBackend, SidecarDevice } from "./backend";

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 15_000;
const FAILURE_MARKER = "Failed.";
const GROUP_TYPE = "DisplayGroup";

/** A display or virtual screen as reported by `get --identifiers`. */
interface Device {
  readonly uuid: string;
  readonly name: string;
  readonly deviceType: string;
}

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
    throw new SidecarError(`betterdisplaycli ${args.join(" ")} failed: ${detail}`);
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
    throw new SidecarError(`betterdisplaycli ${args.join(" ")} failed: ${detail}`);
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
    throw new SidecarError(`Could not parse device list from BetterDisplay: ${raw.slice(0, 120)}`);
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(isRawDevice)
    .filter((device) => device.deviceType !== GROUP_TYPE)
    .map((device) => ({ uuid: device.UUID, name: device.name, deviceType: device.deviceType }));
}

/**
 * Reads the display macOS currently treats as main.
 *
 * @param cliPath - Path to the CLI binary.
 * @returns The main display, or null when BetterDisplay reports none.
 */
async function readMainDisplay(cliPath: string): Promise<Device | null> {
  const raw = await readCli(cliPath, ["get", "--displayWithMainStatus", "--identifiers"]);
  return toDevices(raw)[0] ?? null;
}

// -----------------------------------------------------------
// BACKEND
// -----------------------------------------------------------

/**
 * Builds a SidecarBackend backed by `betterdisplaycli`.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 * @returns The BetterDisplay engine.
 */
export function createBetterDisplayBackend(cliPath: string): SidecarBackend {
  return {
    async listDevices(): Promise<readonly SidecarDevice[]> {
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
          return cut === -1 ? [] : [{ name: line.slice(0, cut).trim(), uuid: line.slice(cut + 2).trim() }];
        });
    },

    async isConnected(ipadName: string): Promise<boolean> {
      return (await readCli(cliPath, ["get", "--sidecarConnected", `--specifier=${ipadName}`])) === "on";
    },

    async setConnected(ipadName: string, connected: boolean): Promise<void> {
      await writeCli(cliPath, [
        "set",
        `--sidecarConnected=${connected ? "on" : "off"}`,
        `--specifier=${ipadName}`,
      ]);
    },

    async readMirror(ipadName: string): Promise<boolean | null> {
      const raw = await readCli(cliPath, ["get", `--name=${ipadName}`, "--mirror"]);
      return raw === null ? null : raw === "on";
    },

    async isIpadMain(ipadName: string): Promise<boolean> {
      const main = await readMainDisplay(cliPath);
      return main !== null && main.name === ipadName;
    },

    async extend(ipadName: string): Promise<void> {
      await writeCli(cliPath, ["set", `--name=${ipadName}`, "--mirror=off"]);
    },

    async mirrorToMain(ipadName: string): Promise<void> {
      const main = await readMainDisplay(cliPath);
      if (main === null) {
        throw new SidecarError("BetterDisplay reports no main display; refusing to mirror.");
      }
      if (main.name === ipadName) {
        throw new SidecarError("The iPad is currently the main display; refusing to mirror onto it.");
      }
      await writeCli(cliPath, ["set", `--UUID=${main.uuid}`, "--mirror=on", `--targetName=${ipadName}`]);
    },
  };
}
