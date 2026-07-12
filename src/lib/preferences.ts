// =============================================================================
// PREFERENCES
// Reads Raycast preferences and resolves them into a SidecarConfig.
// -----------------------------------------------------------------------------
// Context: The `Preferences` type is generated from package.json by `ray build`,
//   so it cannot drift from the manifest. Raycast hands the timeout back as
//   text, and leaves optional fields undefined, so both are normalised here.
// =============================================================================

import { getPreferenceValues } from "@raycast/api";

import { createBetterDisplayBackend } from "./betterdisplay";
import { resolveIpadName } from "./sidecar";
import { loadSelectedDevice } from "./state";

import type { DisplayMode, SidecarBackend } from "./backend";
import type { KeepAliveTuning } from "./keepalive";
import type { SidecarConfig } from "./sidecar";

/** The tuning shared by every command, before a device is chosen. */
export interface Tuning {
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
 * Parses a clamped integer preference, falling back when unset or invalid.
 *
 * @param value - Raw preference text.
 * @param fallback - Value to use when the text is empty or non-numeric.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns The clamped integer.
 */
function parseIntClamped(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Parses a seconds preference into clamped milliseconds.
 *
 * @param value - Raw preference text in seconds.
 * @param fallbackSeconds - Value to use when the text is empty or non-numeric.
 * @param minSeconds - Lower bound in seconds.
 * @param maxSeconds - Upper bound in seconds.
 * @returns The clamped duration in milliseconds.
 */
function parseSecondsMs(
  value: string | undefined,
  fallbackSeconds: number,
  minSeconds: number,
  maxSeconds: number,
): number {
  const parsed = Number.parseFloat((value ?? "").trim());
  const seconds = Number.isFinite(parsed) ? parsed : fallbackSeconds;
  return Math.min(Math.max(seconds, minSeconds), maxSeconds) * 1_000;
}

/**
 * Reads the auto-reconnect timing knobs from preferences, clamped.
 *
 * @returns Fully resolved keep-alive tuning.
 */
export function readKeepAliveTuning(): KeepAliveTuning {
  const prefs = getPreferenceValues<Preferences>();
  return {
    fastAttempts: parseIntClamped(prefs.fastReconnectAttempts, 3, 1, 100),
    backoffBaseMs: parseSecondsMs(prefs.backoffBaseSeconds, 15, 1, 3_600),
    backoffCapMs: parseSecondsMs(prefs.backoffCapSeconds, 60, 1, 3_600),
    dormantRetryMs: parseSecondsMs(prefs.slowRetrySeconds, 300, 30, 86_400),
    wakeGapMs: parseSecondsMs(prefs.wakeThresholdSeconds, 120, 30, 3_600),
  };
}

/**
 * Reads the device-independent tuning from preferences.
 *
 * @returns Requested mode and settle timeout.
 */
export function readTuning(): Tuning {
  const prefs = getPreferenceValues<Preferences>();
  return {
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
 * Builds the engine selected in preferences.
 *
 * @returns The BetterDisplay backend (the native backend is added in stage 2).
 */
export function getBackend(): SidecarBackend {
  const prefs = getPreferenceValues<Preferences>();
  return createBetterDisplayBackend(prefs.betterDisplayCliPath.trim());
}

/**
 * Builds the config every command runs on, auto-detecting the iPad if needed.
 *
 * @param backend - The engine, used to auto-detect the device when unset.
 * @returns Fully resolved configuration.
 */
export async function loadConfig(backend: SidecarBackend): Promise<SidecarConfig> {
  // Priority: an explicit preference override, then a device pinned from the
  // menu bar, then auto-detection.
  const prefs = getPreferenceValues<Preferences>();
  const override = (prefs.ipadName ?? "").trim() || (await loadSelectedDevice());

  return buildConfig(await resolveIpadName(backend, override));
}
