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

import { Icon, MenuBarExtra, openExtensionPreferences } from "@raycast/api";
import { useEffect, useState } from "react";

import { listSidecarDevices } from "./lib/betterdisplay";
import { buildConfig, readTuning } from "./lib/preferences";
import { connectSidecar, disconnectSidecar, isConnected } from "./lib/sidecar";
import { loadSelectedDevice, recordIntent, saveSelectedDevice } from "./lib/state";

import type { SidecarDevice } from "./lib/betterdisplay";

/** Everything the menu needs to render one refresh. */
interface StatusModel {
  readonly devices: readonly SidecarDevice[];
  readonly selected: string;
  readonly connected: boolean;
}

/**
 * Gathers the current Sidecar picture for the menu.
 *
 * @returns Paired devices, the selected device, and whether it is connected.
 */
async function loadStatus(): Promise<StatusModel> {
  const { cliPath } = readTuning();
  const devices = await listSidecarDevices(cliPath);
  const pinned = await loadSelectedDevice();
  const selected = pinned !== "" ? pinned : (devices[0]?.name ?? "");
  const connected = selected !== "" && (await isConnected(buildConfig(selected)));
  return { devices, selected, connected };
}

/**
 * Connects the given device, pinning it as the selection.
 *
 * @param name - Device to connect.
 */
async function connectDevice(name: string): Promise<void> {
  await saveSelectedDevice(name);
  await recordIntent("connected");
  await connectSidecar(buildConfig(name));
}

/**
 * Disconnects the given device.
 *
 * @param name - Device to disconnect.
 */
async function disconnectDevice(name: string): Promise<void> {
  await recordIntent("disconnected");
  await disconnectSidecar(buildConfig(name));
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
  const title = model?.selected || "Sidecar";
  const icon = connected ? Icon.Monitor : Icon.MinusCircle;

  return (
    <MenuBarExtra
      icon={icon}
      title={connected ? title : undefined}
      tooltip="Sidecar Display"
      isLoading={model === null}
    >
      {model !== null && model.devices.length === 0 && <MenuBarExtra.Item title="No Sidecar devices found" />}

      {model !== null && model.selected !== "" && (
        <MenuBarExtra.Section title={model.selected}>
          {connected ? (
            <>
              <MenuBarExtra.Item
                title="Extend"
                icon={Icon.AppWindowGrid2x2}
                onAction={() => connectSidecar(buildConfig(model.selected, { mode: "extend" }))}
              />
              <MenuBarExtra.Item
                title="Mirror"
                icon={Icon.Duplicate}
                onAction={() => connectSidecar(buildConfig(model.selected, { mode: "mirror" }))}
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

      <MenuBarExtra.Section>
        <MenuBarExtra.Item title="Settings…" icon={Icon.Gear} onAction={openExtensionPreferences} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
