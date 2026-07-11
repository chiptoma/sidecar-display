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

Developed and tested against **BetterDisplay 4.3.5** with Pro enabled. The connect, disconnect, and mirror controls have not been verified on a non-Pro install; if a command reports a failure on non-Pro BetterDisplay, that is the likely cause.

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
| BetterDisplay CLI | `/opt/homebrew/bin/betterdisplaycli` | Path to the binary. |
| Settle Timeout | `6` | Seconds to wait for a display change to take effect. Clamped to 2–60. |

## How it works

On connect, the extension:

1. Reads the Sidecar link state and attaches the iPad only if it is detached.
2. Waits for the iPad's display to become **stably present** — the same non-null mirror state read twice in a row. A flaky or phantom connection never passes this gate, so it never reaches a display write.
3. If macOS has made the iPad the main display, it stops and reports — it will not change the mode of the main display.
4. Reads the iPad's mirror state. If it already matches the configured mode, it stops — nothing is written.
5. Otherwise it asserts the mode once: `--mirror=off` to extend, or folds the iPad into the current main display's mirror set to mirror, then polls until it settles.

If the mode does not settle, the extension reports it and stops. It does **not** cycle, disconnect, or otherwise touch any other display to force the issue.

### The main display is never written, and no display is ever cycled

Two hard invariants:

- The extension never issues a `--main` write and never disconnects or power-cycles any display. Its entire mutation surface is: connect/disconnect the Sidecar link, detach the iPad from a mirror set, and add the iPad to the main display's mirror set.
- Mirroring always uses the **existing main display as the master** with the iPad as the target. The reverse direction promotes the iPad to master and macOS moves the main display — and every window — onto it. Both mode writes are refused outright when the iPad is itself the main display.

An earlier version reconnected virtual screens as a "mitigation" when a mode would not settle. On a setup where a virtual screen *is* the main display, that disconnected the main display and scrambled every window. It has been removed entirely.

### Notes on the CLI

Behaviours worth knowing, established by testing rather than from the documentation:

- A rejected request exits **1** with `Failed.` on **stderr** and empty stdout. Reads treat that as "absent"; writes treat it as an error.
- `set --sidecarConnected` is **not** idempotent. It fails when the link is already in the requested state, so state is read first.
- `get --sidecarList` lists **paired** devices, present or not. A name in the list is not a promise the iPad is reachable, which is why the display-stability gate exists.
- Display changes apply asynchronously. A single read after a write races the change, so every write is followed by a poll, and every write that could move windows is gated on a stable read first.

## Install

```sh
git clone https://github.com/chiptoma/sidecar-display.git
cd sidecar-display
npm install
npm run dev
```

`npm run dev` imports the extension into Raycast and hot-reloads it. Stopping it leaves the extension installed. `npm run build` type-checks and compiles without importing.

## Tests

These are real behavioural tests, not mocks: they drive `betterdisplaycli` against live hardware.

```sh
npm run test:safety     # no iPad needed, makes no display changes
npm run test:hardware   # full suite; needs an iPad and a virtual screen
```

`test:safety` is the regression guard for the incident where connecting an unreachable iPad cycled the main display. It asks the extension to settle a display that is not present and asserts it refuses before writing anything and leaves the main display untouched. It only needs BetterDisplay running.

`test:hardware` also reproduces the mirroring case, asserts the extension heals it without moving the main display, and exercises the full connect/disconnect lifecycle. It briefly mirrors the iPad and disconnects and reconnects it. It requires BetterDisplay running, an iPad paired for Sidecar, and at least one virtual screen. Override the binary path with `BD_CLI=/path/to/betterdisplaycli`.

## Limitations

- The extension acts only when you run one of its commands. Connecting the iPad from Control Center or the AirPlay menu will not run the extend/mirror logic. Reacting to those would need a background watcher on display-configuration changes, which this extension deliberately does not install.
- Auto-detection refuses to guess when more than one Sidecar device is present. Pin one in preferences.
- macOS itself decides which display is main when Sidecar attaches, and can put main on the iPad. The extension will not override that (it never writes the main display); it reports it and leaves the arrangement to you.
- If the display mode will not settle, the extension reports it rather than forcing it. Fix a stuck arrangement by hand in BetterDisplay or Displays settings.

## License

MIT
