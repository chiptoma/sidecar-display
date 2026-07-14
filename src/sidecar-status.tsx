// =============================================================================
// SIDECAR STATUS (MENU BAR)
// Live menu-bar item: device name, connection state, and one-click actions.
// -----------------------------------------------------------------------------
// Context: Rendered by Raycast on its background interval and whenever an action
//   re-runs the command. Shows every paired Sidecar device, marks the connected
//   one, and lets you connect, disconnect, or switch extend/mirror.
// WARN: Actions go through the same guarded orchestration as the commands, so
//   the main display is never written and no display is ever cycled.
// =============================================================================

import { getPreferenceValues, Icon, MenuBarExtra, openExtensionPreferences } from "@raycast/api";
import { useEffect, useState } from "react";

import {
  betterDisplayAvailable,
  buildConfig,
  getBackend,
  getBetterDisplayCliPath,
  getMirrorFixMethod,
  shouldFixMirrorAfterConnect,
} from "./lib/preferences";
import { connectSidecar, disconnectSidecar, ensureDisplayMode, isConnected } from "./lib/sidecar";
import { loadSelectedDevice, recordIntent, saveSelectedDevice } from "./lib/state";
import { fixMirror } from "./lib/virtualscreens";

import type { SidecarDevice } from "./lib/backend";

/** Everything the menu needs to render one refresh. */
interface StatusModel {
  readonly devices: readonly SidecarDevice[];
  readonly selected: string;
  readonly connected: boolean;
  readonly canReconnectVirtual: boolean;
}

/**
 * Gathers the current Sidecar picture for the menu.
 *
 * @returns Paired devices, the selected device, whether it is connected, and
 *   whether the virtual-screen reconnect is available (BetterDisplay present).
 */
async function loadStatus(): Promise<StatusModel> {
  const backend = getBackend();
  const devices = await backend.listDevices();
  const pinned = await loadSelectedDevice();
  const selected = pinned !== "" ? pinned : (devices[0]?.name ?? "");
  const connected = selected !== "" && (await isConnected(backend, buildConfig(selected)));
  return { devices, selected, connected, canReconnectVirtual: betterDisplayAvailable() };
}

/**
 * Connects the given device, pinning it as the selection.
 *
 * @param name - Device to connect.
 */
async function connectDevice(name: string): Promise<void> {
  await saveSelectedDevice(name);
  await recordIntent("connected");
  const outcome = await connectSidecar(getBackend(), buildConfig(name));
  if (shouldFixMirrorAfterConnect() && outcome.linkEstablished === true) {
    await fixMirror(getBetterDisplayCliPath(), getMirrorFixMethod());
  }
}

/**
 * Disconnects the given device.
 *
 * @param name - Device to disconnect.
 */
async function disconnectDevice(name: string): Promise<void> {
  await recordIntent("disconnected");
  await disconnectSidecar(getBackend(), buildConfig(name));
}

/**
 * Switches the connected iPad between extend and mirror.
 *
 * @param name - Device to reconfigure.
 * @param mode - Desired display mode.
 */
async function setMode(name: string, mode: "extend" | "mirror"): Promise<void> {
  await ensureDisplayMode(getBackend(), buildConfig(name, { mode }));
}

/**
 * The menu-bar command.
 *
 * @returns The rendered menu-bar item.
 */
export default function Command(): React.JSX.Element {
  const [model, setModel] = useState<StatusModel | null>(null);

  useEffect(() => {
    loadStatus()
      .then(setModel)
      .catch(() => setModel({ devices: [], selected: "", connected: false }));
  }, []);

  const connected = model?.connected ?? false;
  const device = model?.selected || "Sidecar";
  // Default is icon-only (constant width, friendly to menu-bar managers like
  // Bartender). The optional title shows the device name when connected.
  const showName = getPreferenceValues<Preferences>().showDeviceName === true;
  const icon = connected ? Icon.Monitor : Icon.MinusCircle;
  const tooltip = connected ? `${device} — connected` : `${device} — disconnected`;
  const title = showName && connected ? device : undefined;

  return (
    <MenuBarExtra icon={icon} title={title} tooltip={tooltip} isLoading={model === null}>
      {model !== null && model.devices.length === 0 && <MenuBarExtra.Item title="No Sidecar devices found" />}

      {model !== null && model.selected !== "" && (
        <MenuBarExtra.Section title={model.selected}>
          {connected ? (
            <>
              <MenuBarExtra.Item
                title="Extend"
                icon={Icon.AppWindowGrid2x2}
                onAction={() => setMode(model.selected, "extend")}
              />
              <MenuBarExtra.Item
                title="Mirror"
                icon={Icon.Duplicate}
                onAction={() => setMode(model.selected, "mirror")}
              />
              <MenuBarExtra.Item
                title="Disconnect"
                icon={Icon.MinusCircle}
                onAction={() => disconnectDevice(model.selected)}
              />
            </>
          ) : (
            <MenuBarExtra.Item
              title="Connect"
              icon={Icon.Monitor}
              onAction={() => connectDevice(model.selected)}
            />
          )}
        </MenuBarExtra.Section>
      )}

      {model !== null && model.devices.length > 1 && (
        <MenuBarExtra.Section title="Devices">
          {model.devices.map((device) => (
            <MenuBarExtra.Item
              key={device.uuid}
              title={device.name}
              icon={device.name === model.selected ? Icon.Checkmark : Icon.Circle}
              onAction={() => connectDevice(device.name)}
            />
          ))}
        </MenuBarExtra.Section>
      )}

      {model !== null && connected && model.canReconnectVirtual && (
        <MenuBarExtra.Section>
          <MenuBarExtra.Item
            title="Fix Mirroring"
            icon={Icon.ArrowClockwise}
            tooltip="Fix an iPad that is mirroring your main screen (Sidecar's own mirror mode)"
            onAction={() => fixMirror(getBetterDisplayCliPath(), getMirrorFixMethod())}
          />
        </MenuBarExtra.Section>
      )}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item title="Settings…" icon={Icon.Gear} onAction={openExtensionPreferences} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
