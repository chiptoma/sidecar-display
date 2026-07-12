// =============================================================================
// NATIVE BACKEND
// A SidecarBackend implemented over the bundled `sidecar-helper` binary.
// -----------------------------------------------------------------------------
// Context: No BetterDisplay dependency. The helper connects/disconnects via the
//   private SidecarCore framework and reads/sets mirror state via public
//   CoreGraphics. macOS runs one Sidecar session at a time, so link and display
//   state are keyed off "the Sidecar display" rather than a specific device.
// WARN: The helper never reassigns the main display and never disconnects a
//   display; it only reconfigures the Sidecar display's mirror state.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SidecarError } from "./backend";

import type { SidecarBackend, SidecarDevice } from "./backend";

const execFileAsync = promisify(execFile);
const HELPER_TIMEOUT_MS = 25_000;

/** The Sidecar display's presence and state, as the helper reports it. */
interface Status {
  readonly present: boolean;
  readonly main: boolean;
  readonly mirrored: boolean;
}

/**
 * Runs the helper and returns trimmed stdout, surfacing its stderr on failure.
 *
 * @param helperPath - Path to the compiled `sidecar-helper` binary.
 * @param args       - Command and arguments.
 * @returns Trimmed stdout.
 */
async function run(helperPath: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(helperPath, [...args], { timeout: HELPER_TIMEOUT_MS });
    return stdout.trim();
  } catch (cause) {
    const stderr = (cause as { stderr?: unknown }).stderr;
    const detail =
      typeof stderr === "string" && stderr.trim() !== ""
        ? stderr.trim()
        : cause instanceof Error
          ? cause.message
          : String(cause);
    throw new SidecarError(`sidecar-helper ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Reads the Sidecar display status.
 *
 * @param helperPath - Path to the helper binary.
 * @returns Whether a Sidecar display is present and its main/mirror state.
 */
async function readStatus(helperPath: string): Promise<Status> {
  const raw = await run(helperPath, ["status"]);
  let parsed: Partial<Status>;
  try {
    parsed = JSON.parse(raw) as Partial<Status>;
  } catch {
    throw new SidecarError(`sidecar-helper status returned unparseable output: ${raw.slice(0, 120)}`);
  }
  return { present: parsed.present === true, main: parsed.main === true, mirrored: parsed.mirrored === true };
}

/**
 * Builds a SidecarBackend backed by the native helper.
 *
 * @param helperPath - Path to the compiled `sidecar-helper` binary.
 * @returns The Native engine.
 */
export function createNativeBackend(helperPath: string): SidecarBackend {
  return {
    async listDevices(): Promise<readonly SidecarDevice[]> {
      const raw = await run(helperPath, ["list"]);
      let parsed: { devices?: unknown };
      try {
        parsed = JSON.parse(raw) as { devices?: unknown };
      } catch {
        throw new SidecarError(`sidecar-helper list returned unparseable output: ${raw.slice(0, 120)}`);
      }
      const names = Array.isArray(parsed.devices)
        ? parsed.devices.filter((device): device is string => typeof device === "string")
        : [];
      // Native has no separate UUID; the device name is the stable identifier.
      return names.map((name) => ({ name, uuid: name }));
    },

    async isConnected(): Promise<boolean> {
      return (await readStatus(helperPath)).present;
    },

    async setConnected(ipadName: string, connected: boolean): Promise<void> {
      await run(helperPath, [connected ? "connect" : "disconnect", ipadName]);
    },

    async readMirror(): Promise<boolean | null> {
      const status = await readStatus(helperPath);
      return status.present ? status.mirrored : null;
    },

    async isIpadMain(): Promise<boolean> {
      const status = await readStatus(helperPath);
      return status.present && status.main;
    },

    async extend(): Promise<void> {
      await run(helperPath, ["extend"]);
    },

    async mirrorToMain(): Promise<void> {
      await run(helperPath, ["mirror"]);
    },
  };
}
