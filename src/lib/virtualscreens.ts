// =============================================================================
// VIRTUAL SCREEN RECONNECT
// Cycles BetterDisplay virtual screens to re-trigger the display arrangement.
// -----------------------------------------------------------------------------
// Context: When the iPad connects, macOS Sidecar can bring it up mirroring at
//   the Sidecar layer — invisible to CoreGraphics and to `--mirror`. On a Mac
//   whose main display is a BetterDisplay virtual screen, disconnecting and
//   reconnecting that virtual screen forces macOS to redo the arrangement, and
//   the iPad lands as a separate (extended) display. This is the long-standing
//   "Reconnect virtual displays" fix, done through `betterdisplaycli`.
// WARN: Cycling a virtual screen that is the main display briefly blanks and
//   rearranges the desktop. It is a single off/on cycle, never repeated, and is
//   only ever run when the user asks for it (a command) or opts in.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SidecarError } from "./backend";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 15_000;

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
 * Disconnects then reconnects all BetterDisplay virtual screens, once.
 *
 * @param cliPath - Path to the `betterdisplaycli` binary.
 * @param pauseMs - Delay between the disconnect and the reconnect.
 *
 * NOTE: A single off/on cycle — the reconnect always runs, even if the
 *   disconnect was a no-op. Targets virtual screens only; physical displays are
 *   never disconnected.
 */
export async function reconnectVirtualScreens(cliPath: string, pauseMs = 1_500): Promise<void> {
  await run(cliPath, ["set", "--type=VirtualScreen", "--connected=off"]);
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
  await run(cliPath, ["set", "--type=VirtualScreen", "--connected=on"]);
}
