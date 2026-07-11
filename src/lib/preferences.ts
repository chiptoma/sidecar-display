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
import { loadSelectedDevice } from "./state";

import type { DisplayMode, SidecarConfig } from "./sidecar";

/** The tuning shared by every command, before a device is chosen. */
export interface Tuning {
  readonly cliPath: string;
  readonly mode: DisplayMode;
  readonly settleTimeoutMs: number;
}

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
 * Reads the device-independent tuning from preferences.
 *
 * @returns CLI path, requested mode, and settle timeout.
 */
export function readTuning(): Tuning {
  const prefs = getPreferenceValues<Preferences>();
  return {
    cliPath: prefs.betterDisplayCliPath.trim(),
    mode: prefs.displayMode,
    settleTimeoutMs: parseTimeoutMs(prefs.settleTimeoutSeconds),
  };
}

/**
 * Builds a config for a device already known by name.
 *
 * @param ipadName - The Sidecar device to act on.
 * @param overrides - Optional tuning overrides (e.g. a per-action mode).
 * @returns Fully resolved configuration.
 */
export function buildConfig(ipadName: string, overrides: Partial<Tuning> = {}): SidecarConfig {
  return { ...readTuning(), ...overrides, ipadName };
}

/**
 * Builds the config every command runs on, auto-detecting the iPad if needed.
 *
 * @returns Fully resolved configuration.
 *
 * NOTE: Auto-detection issues a CLI call, so this is async by necessity.
 */
export async function loadConfig(): Promise<SidecarConfig> {
  const { cliPath } = readTuning();

  // Priority: an explicit preference override, then a device pinned from the
  // menu bar, then auto-detection.
  const prefs = getPreferenceValues<Preferences>();
  const override = (prefs.ipadName ?? "").trim() || (await loadSelectedDevice());

  return buildConfig(await resolveIpadName(cliPath, override));
}
