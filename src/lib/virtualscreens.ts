// =============================================================================
// MIRROR FIX
// Re-triggers the display arrangement to clear Sidecar's own mirror mode.
// -----------------------------------------------------------------------------
// Context: When the iPad connects, macOS Sidecar can bring it up mirroring at
//   the Sidecar layer — invisible to CoreGraphics and to `--mirror`. Forcing
//   macOS to redo the display arrangement clears it. Two methods, both through
//   `betterdisplaycli`:
//     - reconfigure: `perform --reconfigure` redetects all displays. Lighter —
//       it does not disconnect anything.
//     - virtualscreen: disconnect/reconnect the main virtual screen. Heavier
//       (briefly blanks the main display) but is the long-standing "Reconnect
//       virtual displays" fix.
// WARN: The virtual-screen method blanks and rearranges the desktop; it is a
//   single off/on cycle, never repeated, and only runs on request or opt-in.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SidecarError } from "./backend";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 15_000;
const VIRTUAL_TYPE = "VirtualScreen";

/**
 * Runs betterdisplaycli, throwing with its output on failure.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 * @param args    - Command and parameters.
 */
async function run(cliPath: string, args: readonly string[]): Promise<void> {
  try {
    await execFileAsync(cliPath, [...args], { timeout: CLI_TIMEOUT_MS });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new SidecarError(`betterdisplaycli ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Reads a value, returning null when BetterDisplay rejects the request.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 * @param args    - Command and parameters.
 * @returns Trimmed stdout, or null.
 */
async function read(cliPath: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cliPath, [...args], { timeout: CLI_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Finds the UUID of the main display when it is a virtual screen.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 * @returns The main virtual screen's UUID, or null when main is a real display.
 */
async function mainVirtualScreenUuid(cliPath: string): Promise<string | null> {
  const raw = await read(cliPath, ["get", "--displayWithMainStatus", "--identifiers"]);
  if (raw === null || !raw.includes(`"${VIRTUAL_TYPE}"`)) {
    return null;
  }
  const match = raw.match(/"UUID"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Cycles the virtual screen that drives the arrangement, once.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 * @param pauseMs - Delay between the disconnect and the reconnect.
 *
 * NOTE: Prefers cycling only the main virtual screen (by UUID) so other virtual
 *   screens are left alone; falls back to all virtual screens when the main
 *   display is not itself a virtual screen. Physical displays are never touched.
 *   Always ends with a reconnect, even if the disconnect was a no-op.
 */
export async function reconnectVirtualScreens(cliPath: string, pauseMs = 1_500): Promise<void> {
  const uuid = await mainVirtualScreenUuid(cliPath);
  const selector = uuid !== null ? [`--UUID=${uuid}`] : [`--type=${VIRTUAL_TYPE}`];

  await run(cliPath, ["set", ...selector, "--connected=off"]);
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
  await run(cliPath, ["set", ...selector, "--connected=on"]);
}

/** How to clear Sidecar's mirror mode. */
export type MirrorFixMethod = "reconfigure" | "virtualscreen";

/**
 * Redetects all displays, forcing macOS to redo the arrangement.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 *
 * NOTE: Lighter than the virtual-screen cycle — it disconnects nothing.
 */
export async function reconfigureDisplays(cliPath: string): Promise<void> {
  await run(cliPath, ["perform", "--reconfigure"]);
}

/**
 * Clears Sidecar's mirror mode using the chosen method.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 * @param method  - `reconfigure` (lighter) or `virtualscreen` (heavier).
 */
export async function fixMirror(cliPath: string, method: MirrorFixMethod): Promise<void> {
  if (method === "virtualscreen") {
    await reconnectVirtualScreens(cliPath);
  } else {
    await reconfigureDisplays(cliPath);
  }
}
