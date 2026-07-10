# Sidecar Display

A Raycast extension that connects your iPad over Sidecar and forces it to **extend** rather than mirror, driving [BetterDisplay](https://github.com/waydabber/BetterDisplay) through `betterdisplaycli`.

## Why

The usual way to attach an iPad is to click it under **Mirror or extend to** in System Settings → Displays. On a Mac that already uses a BetterDisplay virtual screen as a mirror master, macOS often resolves that menu to *mirroring*, and you have to reconnect your virtual displays by hand to get an extended desktop back.

BetterDisplay can attach Sidecar itself, and that path extends by default. This extension uses it, so the workaround usually isn't needed at all — and when something does go wrong, the extension detects it and repairs it.

No AppleScript, no System Settings window, no UI-tree scraping.

## Requirements

- macOS with Sidecar support, and an iPad signed in to the same Apple ID
- [BetterDisplay](https://github.com/waydabber/BetterDisplay) running, with CLI integration enabled (it is on by default)
- `betterdisplaycli` on disk — `brew install --cask betterdisplay` provides it
- Raycast

Developed and tested against **BetterDisplay 4.3.5** with Pro enabled. BetterDisplay documents display *connection management* as a Pro feature, which the virtual-screen mitigation relies on; the connect, disconnect, and mirror controls have not been verified on a non-Pro install.

## Commands

| Command | Behaviour |
| --- | --- |
| **Connect Sidecar** | Attaches the iPad, waits for its display, then applies the configured mode. Idempotent. |
| **Disconnect Sidecar** | Detaches the iPad. Idempotent. |
| **Toggle Sidecar** | Reads the current state, then connects or disconnects accordingly. |

Bind any of them to a hotkey in Raycast.

## Preferences

| Preference | Default | Purpose |
| --- | --- | --- |
| Display Mode | `Extend` | Where the iPad should end up: extending, or folded into the main display's mirror set. |
| iPad Name | *(empty)* | Leave empty to auto-detect via `get --sidecarList`. Set it only if you have more than one Sidecar device. |
| Mitigation | *on* | Reconnect virtual screens as a last resort when the display mode refuses to settle. |
| BetterDisplay CLI | `/opt/homebrew/bin/betterdisplaycli` | Path to the binary. |
| Settle Timeout | `6` | Seconds to wait for a display change to take effect. Clamped to 2–60. |

## How it works

On connect, the extension:

1. Reads the Sidecar link state and attaches the iPad only if it is detached.
2. Polls until the iPad's display actually appears.
3. Reads the iPad's mirror state. If it already matches the configured mode, it stops — nothing is written.
4. Otherwise it asserts the mode: `--mirror=off` to extend, or folds the iPad into the current main display's mirror set to mirror.
5. Polls until the change settles.
6. Only if it never settles, and only when extending, it cycles each virtual screen off and on by UUID, re-asserts, and polls again.

### The main display is never written

Mirroring is always applied with the **existing main display as the master** and the iPad as the target. The reverse direction promotes the iPad to mirror master, and macOS moves the main display — and every window — onto it. The extension never issues a `--main` write, and refuses to mirror when the iPad is itself main.

### Notes on the CLI

Behaviours worth knowing, established by testing rather than from the documentation:

- A rejected request exits **1** with `Failed.` on **stderr** and empty stdout. Reads treat that as "absent"; writes treat it as an error.
- `set --sidecarConnected` is **not** idempotent. It fails when the link is already in the requested state, so state is read first.
- Display changes apply asynchronously. A single read after a write races the change, so every write is followed by a poll.

## Install

```sh
git clone https://github.com/chiptoma/sidecar-display.git
cd sidecar-display
npm install
npm run dev
```

`npm run dev` imports the extension into Raycast and hot-reloads it. Stopping it leaves the extension installed. `npm run build` type-checks and compiles without importing.

## Tests

```sh
npm run test:hardware
```

These are real behavioural tests, not mocks: they drive `betterdisplaycli` against a live iPad and virtual screen, deliberately reproduce the mirroring bug, assert the extension heals it, and assert the main display never moves. They briefly mirror the iPad and disconnect and reconnect it, and they leave it connected and extending.

They require BetterDisplay running, an iPad paired for Sidecar, and at least one virtual screen. Override the binary path with `BD_CLI=/path/to/betterdisplaycli`.

## Limitations

- The extension acts only when you run one of its commands. Connecting the iPad from Control Center or the AirPlay menu will not trigger the mitigation. Reacting to those would need a background watcher on display-configuration changes, which this extension deliberately does not install.
- Auto-detection refuses to guess when more than one Sidecar device is present. Pin one in preferences.

## License

MIT
