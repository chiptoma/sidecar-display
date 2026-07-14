# Sidecar Display

A Raycast extension that connects your iPad over Sidecar and forces it to **extend** rather than mirror. It ships two interchangeable engines: **BetterDisplay** (via `betterdisplaycli`) and **Native** (a bundled helper using macOS SidecarCore + CoreGraphics, no external dependency).

## Why

The usual way to attach an iPad is to click it under **Mirror or extend to** in System Settings → Displays. On a Mac that already uses a BetterDisplay virtual screen as a mirror master, macOS often resolves that menu to *mirroring*, and you have to reconnect your virtual displays by hand to get an extended desktop back.

Attaching Sidecar programmatically extends by default, so the workaround usually isn't needed — and when something does go wrong, the extension detects it and repairs it, without ever touching the main display.

No AppleScript, no System Settings window, no UI-tree scraping.

## Engines

Pick one with the **Engine** preference:

- **Automatic** (default) — uses BetterDisplay when its CLI is installed, otherwise Native.
- **BetterDisplay** — drives the `betterdisplaycli` binary. Proven and low-maintenance, but requires the BetterDisplay app to be installed and running.
- **Native (no dependency)** — a small bundled `sidecar-helper` binary that connects/disconnects via the private `SidecarCore` framework and controls mirroring via public CoreGraphics. No BetterDisplay needed.

The native engine relies on a private Apple framework, so a future macOS update could change it (it is validated on macOS 26). If a native command starts failing after an OS update, switch back to BetterDisplay and the helper can be patched. Both engines honour the same safety guarantees.

## Requirements

- macOS with Sidecar support, and an iPad signed in to the same Apple ID
- Raycast
- For the **BetterDisplay** engine: [BetterDisplay](https://github.com/waydabber/BetterDisplay) running with CLI integration enabled (on by default) — `brew install --cask betterdisplay`. Tested against **BetterDisplay 4.3.5** with Pro enabled; non-Pro is unverified.
- For the **Native** engine: nothing extra at runtime. The helper is compiled from `native/sidecar-helper.swift` by `npm run build` / `npm run dev` (needs `swiftc`, which ships with the Xcode Command Line Tools).

## Commands

| Command | Behaviour |
| --- | --- |
| **Connect Sidecar** | Attaches the iPad, waits for its display, then applies the configured mode. Idempotent. |
| **Disconnect Sidecar** | Detaches the iPad. Idempotent. |
| **Auto-Reconnect Sidecar** | Background command that restores a dropped link (see below). Run it by hand to reconnect now. |
| **Fix Mirroring** | Clears macOS Sidecar's own mirror mode when the iPad connects showing a copy of your main screen (see below). |
| **Sidecar Status** | Menu-bar item showing the device name and connection state, with connect / disconnect / extend / mirror actions and a device picker. |

Bind Connect and Disconnect to hotkeys in Raycast, or drive everything from the menu bar.

### Sidecar's own mirror mode

macOS Sidecar has its own "Mirror / Use as Separate Display" mode that is **separate from display mirroring** and invisible to CoreGraphics and BetterDisplay. On a Mac whose main display is a BetterDisplay virtual screen, the iPad can connect showing a copy of your main screen even though every display API reports it as extended — so **Extend / mirror mode cannot fix it** (there is nothing mirrored, as far as those APIs can tell).

The fix forces macOS to redo the display arrangement, after which the iPad lands as a separate display. Two methods, chosen with **Mirror Fix Method**:

- **Redetect displays** (default, lighter) — `betterdisplaycli perform --reconfigure` re-detects all displays without disconnecting anything. Least disruptive, but may not clear the mirror on every setup.
- **Reconnect virtual screen** (heavier, proven) — disconnects and reconnects the **main** virtual screen (only that one, by UUID). Briefly blanks your main display, but is the long-standing "Reconnect virtual displays" fix.

Run it from the **Fix Mirroring** command, from the menu bar (shown only when BetterDisplay is available), or enable the **Fix Mirroring** option to run it automatically on a fresh connect. It uses `betterdisplaycli` regardless of the selected engine — the mirroring is a side effect of having a BetterDisplay virtual screen, so the fix requires BetterDisplay.

**Fix Mirroring** runs only on a **fresh connect** — when the iPad newly attaches — not when you re-run connect on an already-connected iPad. Sidecar's mirror mode is invisible to the display APIs, so the extension cannot detect "it came up mirrored" and condition on it directly; instead it fires once per fresh connect, which matches the common case where the iPad mirrors every time it attaches. If your iPad only sometimes mirrors, leave the option off and use the manual command or menu-bar action when you need it.

It briefly blanks and rearranges the desktop (it disconnects and reconnects the virtual screen that is your main display), so it is a single, deliberate cycle — never automatic-on-a-loop.

### Auto-reconnect (keep-alive)

Enable **background refresh** on the *Auto-Reconnect Sidecar* command (in its Raycast command settings) and it will restore the link after it drops — for example when the Mac wakes from sleep or wifi hiccups.

It is deliberately conservative, so it never nags, but it never abandons a link you want either:

- It reconnects **only** when you asked for the iPad to be connected (via the connect command or the menu bar) and the link then dropped **on its own**.
- A **deliberate disconnect** stops it — it will not fight you.
- On a drop it makes a burst of quick attempts with growing backoff (the *Fast Reconnect Attempts* preference), then slows to an occasional heartbeat retry. It does **not** give up permanently.
- **Waking the Mac re-arms it immediately.** A long gap between background ticks means the Mac was asleep, so the next tick after you open the lid reconnects at once rather than waiting out a backoff.

There is no on-wake event on macOS for extensions, so reconnection happens on the next background tick — within roughly one interval (default one minute) of waking, not instantly. Background refresh is off until you enable it on the command.

## Preferences

| Preference | Default | Purpose |
| --- | --- | --- |
| Engine | `Automatic` | Which engine drives Sidecar: Automatic (BetterDisplay if installed, else Native), BetterDisplay, or Native. |
| Display Mode | `Extend` | Where the iPad should end up: extending, or folded into the main display's mirror set. |
| iPad Name | *(empty)* | Leave empty to auto-detect via `get --sidecarList`, or to use whatever you last picked in the menu bar. Set it only to pin one when you have more than one Sidecar device. |
| Fast Reconnect Attempts | `3` | Quick reconnect attempts after a drop before slowing to the heartbeat. Waking the Mac restarts the fast phase. Never gives up entirely. |
| Backoff Base (seconds) | `15` | Initial wait between fast attempts; doubles each try up to the cap. |
| Backoff Cap (seconds) | `60` | Longest wait the doubling backoff reaches during the fast phase. |
| Slow Retry (seconds) | `300` | How often to retry once the fast attempts are spent and the iPad is still absent. |
| Wake Threshold (seconds) | `120` | A gap this long between background ticks counts as the Mac having slept, so the next tick reconnects immediately. |
| Fix Mirroring | *on* | Clear Sidecar's own mirror mode automatically on a fresh connect (not on re-runs). Requires BetterDisplay; ignored without it. |
| Mirror Fix Method | `Redetect displays` | How to clear the mirror: redetect displays (lighter) or reconnect the main virtual screen (heavier, briefly blanks the main display, but proven). |
| BetterDisplay CLI | `/opt/homebrew/bin/betterdisplaycli` | Path to the binary. |
| Settle Timeout | `6` | Seconds to wait for a display change to take effect. Clamped to 2–60. |

Every auto-reconnect timing knob is configurable. Note that Raycast runs background commands only about **once a minute**, so backoff values under ~60 seconds effectively mean "every tick" — the sub-minute knobs mostly shape the tail of the fast phase.

With more than one paired iPad, pick the one to act on from the **Sidecar Status** menu bar; the choice is remembered and used by every command. An explicit *iPad Name* preference overrides that.

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
npm run test:unit       # pure logic (keep-alive), no BetterDisplay needed
npm run test:safety      # unit + absent-device safety; needs BetterDisplay, no iPad
npm run test:hardware    # full suite; needs an iPad and a virtual screen
```

`test:unit` proves the keep-alive state machine only reconnects a link that dropped on its own, backs off, gives up, and re-arms — no hardware at all.

`test:safety` adds the regression guard for the incident where connecting an unreachable iPad cycled the main display. It asks the extension to settle a display that is not present and asserts it refuses before writing anything and leaves the main display untouched. It only needs BetterDisplay running.

`test:hardware` also reproduces the mirroring case, asserts the extension heals it without moving the main display, and exercises the full connect/disconnect lifecycle. It briefly mirrors the iPad and disconnects and reconnects it. It requires BetterDisplay running, an iPad paired for Sidecar, and at least one virtual screen. Override the binary path with `BD_CLI=/path/to/betterdisplaycli`.

## Limitations

- Auto-reconnect is interval-polled, not event-driven — macOS exposes no on-wake or display-change event to extensions. Reconnection lands within about one interval of a drop, not instantly.
- Connecting the iPad from Control Center or the AirPlay menu (rather than through this extension) will not run the extend/mirror logic, and auto-reconnect will not treat that as an intent to keep alive.
- macOS itself decides which display is main when Sidecar attaches, and can put main on the iPad. The extension will not override that (it never writes the main display); it reports it and leaves the arrangement to you.
- If the display mode will not settle, the extension reports it rather than forcing it. Fix a stuck arrangement by hand in BetterDisplay or Displays settings.
- The menu bar and background commands are macOS-only (Raycast does not offer menu-bar commands on Windows).
- The **Sidecar Status** menu-bar item does not auto-refresh and shows a constant-width icon, to stay friendly with menu-bar managers like Bartender or Ice. It updates when you open it. If you want live status in the bar, enable Background Refresh on the command in its Raycast settings (this reintroduces a periodic refresh that such managers will see).

## License

MIT
