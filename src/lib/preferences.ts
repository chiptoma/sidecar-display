// =============================================================================
// PREFERENCES
// Reads Raycast preferences and resolves them into a SidecarConfig.
// -----------------------------------------------------------------------------
// Context: The `Preferences` type is generated from package.json by `ray build`,
//   so it cannot drift from the manifest. Raycast hands the timeout back as
//   text, and leaves optional fields undefined, so both are normalised here.
// =============================================================================

import { getPreferenceValues } from "@raycast/api";

import { resolveIpadName } from "./sidecar";

import type { SidecarConfig } from "./sidecar";

const MIN_TIMEOUT_SECONDS = 2;
const MAX_TIMEOUT_SECONDS = 60;
const DEFAULT_TIMEOUT_SECONDS = 6;

/**
 * Clamps the configured settle timeout into a sane range.
 *
 * @param value - Raw preference text, possibly empty or non-numeric.
 * @returns Timeout in milliseconds.
 */
function parseTimeoutMs(value: string): number {
  const seconds = Number.parseFloat(value.trim());
  if (!Number.isFinite(seconds)) {
    return DEFAULT_TIMEOUT_SECONDS * 1_000;
  }
  return Math.min(Math.max(seconds, MIN_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS) * 1_000;
}

/**
 * Builds the config every command runs on, auto-detecting the iPad if needed.
 *
 * @returns Fully resolved configuration.
 *
 * NOTE: Auto-detection issues a CLI call, so this is async by necessity.
 */
export async function loadConfig(): Promise<SidecarConfig> {
  const prefs = getPreferenceValues<Preferences>();
  const cliPath = prefs.betterDisplayCliPath.trim();

  return {
    cliPath,
    ipadName: await resolveIpadName(cliPath, prefs.ipadName ?? ""),
    mode: prefs.displayMode,
    settleTimeoutMs: parseTimeoutMs(prefs.settleTimeoutSeconds),
  };
}
