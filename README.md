# Sidecar Display

[![CI](https://github.com/chiptoma/sidecar-display/actions/workflows/ci.yml/badge.svg)](https://github.com/chiptoma/sidecar-display/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)

A [Raycast](https://raycast.com) extension that connects your iPad over **Sidecar** and forces it to **extend** rather than mirror — reliably, from a hotkey or the menu bar, without ever moving or touching your main display.

It ships **two interchangeable engines** and picks the right one automatically:

- **BetterDisplay** — drives the `betterdisplaycli` binary. Proven and low-maintenance; needs the [BetterDisplay](https://github.com/waydabber/BetterDisplay) app.
- **Native** — a small Swift helper using the private `SidecarCore` framework plus public CoreGraphics. No external dependency at runtime.

No AppleScript, no System Settings window, no UI-tree scraping.

---

## Contents

- [Why this exists](#why-this-exists)
- [Install](#install)
- [Commands](#commands)
- [Preferences](#preferences)
- [How it works](#how-it-works)
  - [The core problem: Sidecar's invisible mirror mode](#the-core-problem-sidecars-invisible-mirror-mode)
  - [The connect flow: converge and hold](#the-connect-flow-converge-and-hold)
  - [Safety: the main display is sacred](#safety-the-main-display-is-sacred)
  - [Fix Mirroring](#fix-mirroring)
  - [Auto-reconnect (keep-alive)](#auto-reconnect-keep-alive)
  - [Two engines, one interface](#two-engines-one-interface)
- [Design decisions](#design-decisions)
- [Project structure](#project-structure)
- [Development](#development)
- [Testing](#testing)
- [Publishing](#publishing)
- [Limitations](#limitations)
- [License](#license)

---

## Why this exists

The usual way to attach an iPad is to click it under **Mirror or extend to** in System Settings → Displays. On a Mac that already uses a BetterDisplay **virtual screen as its main display** (a common multi-monitor setup), macOS often resolves that menu to *mirroring* — so the iPad comes up showing a copy of your desktop, and you have to hand-run BetterDisplay's "Reconnect virtual displays" to get an extended desktop back.

This extension attaches Sidecar **programmatically**, which extends by default — and when macOS still comes up mirrored, it repairs it with one deliberate action, without ever writing or relocating your main display.

## Install

### From the Raycast Store

> Coming soon — pending review.

### From source (local)

```sh
git clone https://github.com/chiptoma/sidecar-display.git
cd sidecar-display
npm install
npm run dev
```

`npm run dev` imports the extension into Raycast and hot-reloads it. Stopping it leaves the extension installed. `npm run build` type-checks and compiles without importing.

**Requirements**

- macOS with Sidecar support, and an iPad signed in to the same Apple ID.
- Raycast.
- For the **BetterDisplay** engine: [BetterDisplay](https://github.com/waydabber/BetterDisplay) running with CLI integration enabled (on by default) — `brew install --cask betterdisplay`. Tested against **BetterDisplay 4.3.5** with Pro; non-Pro is unverified.
- To **build from source** (either engine): a full **Xcode** install — the native engine's Swift is compiled at build time by Raycast's [`extensions-swift-tools`](https://github.com/raycast/extensions-swift-tools). (Store *users* don't need Xcode; they install the already-compiled extension.)

## Commands

| Command | Behaviour |
| --- | --- |
| **Connect Sidecar** | Attaches the iPad, waits for its display, applies the configured mode (extend by default). Idempotent. |
| **Disconnect Sidecar** | Detaches the iPad. Idempotent. |
| **Auto-Reconnect Sidecar** | Background command that restores a dropped link. Run it by hand to reconnect now. See [keep-alive](#auto-reconnect-keep-alive). |
| **Fix Mirroring** | Clears macOS Sidecar's own mirror mode when the iPad connects showing a copy of your main screen. Needs BetterDisplay. |
| **Sidecar Status** | Menu-bar item: device name, connection state, and connect / disconnect / extend / mirror actions plus a device picker. |

Bind Connect and Disconnect to hotkeys in Raycast, or drive everything from the menu bar.

## Preferences

| Preference | Default | Purpose |
| --- | --- | --- |
| Engine | `Automatic` | BetterDisplay if its CLI is installed, otherwise Native. Or pin one explicitly. |
| Menu Bar → show device name | off | On shows the device name next to the icon; off keeps a constant-width icon (friendlier to Bartender/Ice). |
| Fix Mirroring on fresh connect | **on** | Reconnect the main virtual screen automatically on a fresh connect to clear Sidecar's mirror mode. Briefly reshuffles the desktop. Requires BetterDisplay; ignored without it. |
| Display Mode | `Extend` | Where the iPad should end up: extending, or folded into the main display's mirror set. |
| iPad Name | *(empty)* | Leave empty to auto-detect. Set it only to pin one when you have more than one Sidecar device. |
| Fast Reconnect Attempts | `3` | Quick reconnect attempts after a drop before slowing to the heartbeat. |
| Backoff Base (seconds) | `15` | Initial wait between fast attempts; doubles each try up to the cap. |
| Backoff Cap (seconds) | `60` | Longest wait the doubling backoff reaches. Clamped to at least the base. |
| Slow Retry (seconds) | `300` | How often to retry once the fast attempts are spent and the iPad is still absent. |
| Wake Threshold (seconds) | `120` | A gap this long between background ticks counts as a wake, so the next tick reconnects immediately. |
| BetterDisplay CLI | `/opt/homebrew/bin/betterdisplaycli` | Path to the binary (Intel Homebrew: `/usr/local/bin/...`). |
| Settle Timeout | `6` | Seconds to wait for a display change to take effect. Clamped to 2–60. |

Every auto-reconnect timing knob is configurable. Note that Raycast runs background commands only about **once a minute**, so backoff values under ~60 s effectively mean "every tick" — the sub-minute knobs mostly shape the tail of the fast phase.

---

## How it works

### The core problem: Sidecar's invisible mirror mode

This is the insight the whole extension is built around.

macOS Sidecar has its **own** "Mirror / Use as Separate Display" toggle that is **separate from display mirroring** and **invisible to every display API** — CoreGraphics, `NSScreen`, and BetterDisplay all report the iPad as a normal extended display even while it is showing a copy of your main screen. On a Mac whose main display is a BetterDisplay virtual screen, the iPad routinely connects in this state.

The consequence is stark: **you cannot detect "it came up mirrored" programmatically** — there is no readable signal that distinguishes it. So the extension cannot condition a fix on "is it mirrored?". Instead:

- It **extends by default** by attaching Sidecar programmatically (which usually avoids the problem entirely).
- When the problem does occur, the only thing that reliably clears it is disconnecting and reconnecting the **main BetterDisplay virtual screen**, which forces macOS to redo the whole arrangement so the iPad lands extended. That is exactly the manual "Reconnect virtual displays" fix, automated — see [Fix Mirroring](#fix-mirroring).

Because the mirror is a side effect of having a BetterDisplay virtual screen, that fix inherently requires BetterDisplay, regardless of which engine is driving Sidecar.

### The connect flow: converge and hold

On **Connect**, the extension:

1. Reads the Sidecar link state and attaches the iPad only if it is detached.
2. Waits for the iPad's display to become **stably present**.
3. If macOS has made the iPad the **main** display, it stops and reports — it will not change the mode of the main display.
4. Reads the iPad's mirror state. If it already matches the configured mode, it writes nothing.
5. Otherwise it asserts the mode (`--mirror=off` to extend, or folds the iPad into the current main's mirror set to mirror) and **re-asserts on every disagreeing read**, reporting *settled* only after the mode reads correct **three times running**.

Step 5 exists because macOS spends about a second rearranging a freshly connected Sidecar display — it frequently comes up mirrored, then flips to extended a beat later. A naive "set it once and trust the next read" races that window and reports success too early (or fights it). Converge-and-hold outlasts the rearrange.

If the mode never settles, the extension **reports it and stops**. It does not cycle, disconnect, or otherwise touch any other display to force the issue.

### Safety: the main display is sacred

Two hard invariants, enforced across every code path and every engine:

1. **The extension never writes the main display**, and the connect/disconnect/mode path never disconnects or power-cycles any display. Its entire mode-path mutation surface is: connect/disconnect the Sidecar link, detach the iPad from a mirror set, and add the iPad to the main display's mirror set.
2. **Mirroring always uses the existing main display as the master**, with the iPad as the target. The reverse direction would promote the iPad to master and make macOS move your main display — and every window — onto it. Both mode writes are refused outright when the iPad is itself the main display.

These aren't decoration. An earlier version reconnected virtual screens as a "mitigation" whenever a mode wouldn't settle — and on a setup where a virtual screen *is* the main display, that disconnected the main display, scrambled every window, and once caused a logout. That mitigation was removed entirely. The only place a display is ever cycled now is the explicit, opt-in [Fix Mirroring](#fix-mirroring) action, and even that is scoped to the main virtual screen by UUID and guaranteed to reconnect it.

### Fix Mirroring

Fix Mirroring disconnects and reconnects the **main** BetterDisplay virtual screen (only that one, by UUID), forcing macOS to redo the arrangement so the iPad lands as a separate display. It briefly blanks your main display — it's a single, deliberate cycle, never a loop.

Because Sidecar's mirror mode is undetectable (see above), the extension can't fire it only "when mirrored." Instead:

- The **Fix Mirroring** command and the menu-bar action run it on demand.
- The **Fix Mirroring on fresh connect** preference (on by default) runs it once per *fresh* connect — when the iPad newly attaches, not when you re-run Connect on an already-connected iPad. This matches the common case where the iPad mirrors every time it attaches. If yours only sometimes mirrors, turn the preference off and use the manual command when you need it.

Its "always reconnect even if the disconnect is rejected" guarantee is covered by a [unit test](#testing) so the screen can never be left down.

### Auto-reconnect (keep-alive)

Enable **Background Refresh** on the *Auto-Reconnect Sidecar* command (in its Raycast command settings) and it restores the link after it drops — for example when the Mac wakes from sleep or wifi hiccups. It's deliberately conservative, so it never nags, but it never abandons a link you want either:

- It reconnects **only** when you asked for the iPad to be connected (via Connect or the menu bar) and the link then dropped **on its own**.
- A **deliberate disconnect** stops it — it will not fight you.
- On a drop it makes a burst of quick attempts with growing backoff (the *Fast Reconnect Attempts* preference), then slows to an occasional heartbeat retry. It does **not** give up permanently.
- **Waking the Mac re-arms it immediately.** There is no on-wake event for extensions, so a long gap between background ticks is read as "the Mac slept," and the next tick reconnects at once rather than waiting out a backoff.

Reconnection lands within roughly one interval (about a minute) of a drop, not instantly.

### Two engines, one interface

Both engines implement the same `SidecarBackend` interface (`listDevices`, `isConnected`, `setConnected`, `readMirror`, `isIpadMain`, `extend`, `mirrorToMain`). All the orchestration depends only on that interface, so it is engine-agnostic and unit-testable against a mock.

- **BetterDisplay** wraps `betterdisplaycli`. Reads tolerate rejection (`Failed.` on stderr, exit 1) and return `null`; writes throw.
- **Native** calls Swift functions compiled from `swift/`: connect/disconnect via runtime-dispatched `SidecarCore` selectors (loaded with `dlopen`, so the binary links nothing private), and mirror control via public `CGConfigureDisplayMirrorOfDisplay`. It finds the Sidecar display by the AirPlay vendor signature — which, unlike `NSScreen`, still works while the display is in a mirror set.

The native engine relies on a private Apple framework, so a future macOS update could change it (validated on macOS 26). If a native command starts failing after an OS update, switch to BetterDisplay and the Swift can be patched. Both engines honour the same safety guarantees.

## Design decisions

A few choices worth recording, since they're the non-obvious ones:

- **Detect nothing you can't detect.** The whole "fix mirroring" design bends around the fact that Sidecar's mirror mode is invisible to every API. Rather than pretend to detect it, the extension fires the fix on a *fresh connect* (a proxy for "just attached, might be mirrored") and otherwise leaves it to a manual action.
- **Converge, don't set-and-pray.** Every window-affecting mode change is re-asserted until it holds across several reads, because macOS rearranges a fresh Sidecar display asynchronously.
- **Never touch the main display; never cycle a display in the mode path.** Learned the hard way (a logout). The one sanctioned cycle is Fix Mirroring, isolated and guaranteed to reconnect.
- **Native as source, not a binary.** The Raycast Store rejects opaque bundled binaries, so the native helper is a Swift Package compiled by Raycast's pipeline via `extensions-swift-tools` — auditable, no committed artifact.
- **Pure decision logic, isolated from I/O.** The keep-alive state machine and the connect orchestration are pure functions with no `@raycast/api` import, so they're unit-tested headlessly with mocks — the safety invariants are proven without any hardware.
- **Menu-bar friendliness.** The status item shows a constant-width icon and does not auto-refresh, to stay friendly with menu-bar managers like Bartender or Ice.

## Project structure

```
sidecar-display/
├── src/
│   ├── connect-sidecar.ts          # command: connect + apply mode (+ fresh-connect fix)
│   ├── disconnect-sidecar.ts       # command: disconnect
│   ├── auto-reconnect.ts           # background command: keep-alive tick
│   ├── reconnect-virtual-screens.ts# command: "Fix Mirroring"
│   ├── sidecar-status.tsx          # menu-bar command
│   └── lib/
│       ├── backend.ts              # SidecarBackend interface + shared types + SidecarError
│       ├── betterdisplay.ts        # BetterDisplay engine (betterdisplaycli)
│       ├── native.ts               # Native engine (calls swift:../../swift)
│       ├── sidecar.ts              # orchestration: connect / disconnect / converge-and-hold
│       ├── keepalive.ts            # pure keep-alive decision state machine
│       ├── virtualscreens.ts       # Fix Mirroring (main virtual-screen reconnect)
│       ├── preferences.ts          # Raycast preferences -> SidecarConfig; engine selection
│       ├── state.ts                # the only module touching LocalStorage
│       └── feedback.ts             # HUD / toast text from a result
├── swift/
│   ├── Package.swift               # SPM manifest (extensions-swift-tools)
│   └── Sources/Sidecar/
│       ├── Exports.swift           # the @raycast functions exported to TypeScript
│       └── SidecarBridge.swift     # SidecarCore (dlopen) + CoreGraphics logic
├── test/
│   ├── keepalive.js                # unit: keep-alive state machine (no hardware)
│   ├── orchestration.js            # unit: orchestration vs a mock backend (no hardware)
│   ├── virtualscreens.js           # unit: Fix Mirroring vs a stub CLI (no hardware)
│   ├── safety.js                   # hardware: absent-device safety guard
│   ├── e2e.js                      # hardware: full connect/disconnect lifecycle
│   └── roundtrip.js                # hardware: mirror -> heal-to-extend
├── .github/workflows/
│   ├── ci.yml                      # lint + build + typecheck + unit tests
│   └── release.yml                 # tag -> GitHub Release
├── assets/extension-icon.png
├── CHANGELOG.md · README.md · CONTRIBUTING.md · CLAUDE.md · LICENSE
```

Each `src/*.ts(x)` is a thin command entry point with no logic; all logic lives in `src/lib/`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the conventions (file banners, naming, TypeScript rules, commit format) and a deeper architecture tour.

## Development

```sh
npm run dev          # import into Raycast + hot-reload (compiles Swift via ray develop)
npm run build        # compile + generate types + typecheck, without importing
npm run lint         # ESLint + Prettier via ray lint
npm run fix-lint     # auto-fix lint/format
npm run typecheck    # tsc --noEmit (also part of build)
```

`ray build` bundles TypeScript with esbuild (which does not type-check), so `typecheck` runs `tsc --noEmit` separately and is wired into `build` and CI — a type error fails the build.

The native engine's Swift is a standard SPM executable in `swift/`. `ray build`/`ray develop` compile it and generate the TypeScript bridge (`swift:../../swift`) automatically; you never run `swiftc` or commit a binary. Building it needs a full Xcode install.

## Testing

The tests are **behavioural**, not structural — they prove the safety invariants, not just that types line up.

```sh
npm run test:unit       # pure logic + stub CLI, no hardware, no BetterDisplay
npm run test:safety     # unit + absent-device safety; needs BetterDisplay, no iPad
npm run test:hardware   # full suite; needs an iPad and a virtual screen
```

- **`test:unit`** — the keep-alive state machine (only reconnects a self-dropped link, backs off, never abandons, re-arms on wake), the connect orchestration against a mock backend (never writes main, never cycles, declines when the iPad is main, refuses an absent display), and Fix Mirroring against a stub `betterdisplaycli` (always reconnects even when the disconnect is rejected; UUID vs `--type` targeting). Runs in CI.
- **`test:safety`** — the regression guard for the window-scramble incident: it asks the extension to settle a display that is not present and asserts it refuses before writing anything. Needs BetterDisplay running, no iPad.
- **`test:hardware`** — reproduces the mirroring case and asserts the extension heals it without moving the main display, plus the full connect/disconnect lifecycle. Needs an iPad paired for Sidecar and at least one virtual screen. Override the binary with `BD_CLI=/path/to/betterdisplaycli`.

## Publishing

Public Raycast Store extensions are submitted as a **pull request to [`raycast/extensions`](https://github.com/raycast/extensions)** and reviewed by a human — there is no headless/CI publish, and all Store extensions are free and open-source (MIT).

```sh
npm run publish      # runs build + typecheck + unit tests, then opens the store PR
```

Before submitting you also need `metadata/` screenshots (2000×1250 PNG, up to 6) captured via Raycast's **Capture Window**, and the `CHANGELOG.md` entry (already in the required `{PR_MERGE_DATE}` format). See [CONTRIBUTING.md](./CONTRIBUTING.md#releasing) for the full checklist. Pushing a `v*` git tag cuts a GitHub Release automatically.

## Limitations

- Auto-reconnect is interval-polled, not event-driven — macOS exposes no on-wake or display-change event to extensions. Reconnection lands within about one interval of a drop.
- Connecting the iPad from Control Center or the AirPlay menu (rather than through this extension) will not run the extend/mirror logic, and auto-reconnect will not treat that as an intent to keep alive.
- macOS itself decides which display is main when Sidecar attaches, and can put main on the iPad. The extension reports that and leaves the arrangement to you — it never writes the main display.
- If the display mode won't settle, the extension reports it rather than forcing it. Fix a stuck arrangement by hand in BetterDisplay or Displays settings.
- The menu bar and background commands are macOS-only.
- Sidecar's own mirror mode is invisible to every display API, so the mirror fix is a manual/opt-in action, not an automatic "detect and repair."

## License

[MIT](./LICENSE)
