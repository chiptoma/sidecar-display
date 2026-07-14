# Sidecar Display

Raycast extension that connects an iPad over Sidecar via `betterdisplaycli` and
forces extend (or mirror) without touching the main display.

## Language rules

@~/.claude/rules/lang/typescript.md

## Architecture

- `src/lib/backend.ts` — the `SidecarBackend` interface every engine implements,
  plus shared types (`SidecarDevice`, `DisplayMode`) and `SidecarError`. The
  orchestration depends ONLY on this, so it is engine-agnostic and mockable.
- `src/lib/betterdisplay.ts` — `createBetterDisplayBackend(cliPath)`, the engine
  over `betterdisplaycli`. Reads tolerate rejection (`Failed.` on stderr, exit 1)
  and return `null`; writes throw.
- `src/lib/native.ts` — `createNativeBackend(helperPath)`, the engine over the
  bundled `sidecar-helper` binary (SidecarCore + CoreGraphics). No BetterDisplay.
- `src/lib/virtualscreens.ts` — `reconnectVirtualScreens(cliPath)`: clears macOS
  Sidecar's own mirror mode (invisible to CoreGraphics/`--mirror`) by cycling the
  main virtual screen by UUID, which forces a display re-arrangement. Tolerates a
  rejected disconnect and ALWAYS reconnects, so the screen is never left down.
  Engine-independent and always via `betterdisplaycli`, since the mirror is a
  BetterDisplay virtual-screen artifact. Only run on explicit request or the
  opt-in `fixMirrorAfterConnect`. (`perform --reconfigure` was tried as a lighter
  alternative and does not clear this mirror.)
- `native/sidecar-helper.swift` — the helper source; compiled to
  `assets/sidecar-helper` by `npm run build:helper` (gitignored, rebuilt on
  every `build`/`dev`). Identifies the Sidecar display by `NSScreen.localizedName`
  containing "Sidecar"/"AirPlay"; connect/disconnect via runtime-dispatched
  SidecarCore selectors; extend/mirror via `CGConfigureDisplayMirrorOfDisplay`
  keeping the current main as master.
- `src/lib/sidecar.ts` — display/link orchestration. Takes a `SidecarBackend`.
  Pure Node, no `@raycast/api` import, so tests exercise it with a mock backend
  (`test/orchestration.js`) or a real engine.
- `src/lib/keepalive.ts` — pure decision state machine for background
  auto-reconnect. No I/O, so it is unit-tested headlessly (`test/keepalive.js`).
- `src/lib/state.ts` — the only module that touches Raycast `LocalStorage`
  (keep-alive intent + the menu-bar device selection).
- `src/lib/preferences.ts` — maps Raycast's generated `Preferences` type into a
  `SidecarConfig` (`readTuning`/`buildConfig`/`loadConfig`). Never hand-declare
  the preference shape; it is generated from `package.json` by `ray build`.
- `src/lib/feedback.ts` — HUD/toast text from a `ModeOutcome`.
- `src/*.ts(x)` — one thin command entry point each. No logic:
  connect/disconnect/toggle (no-view), `auto-reconnect` (no-view, `interval`),
  and `sidecar-status` (menu-bar). Purity split: only lib modules WITHOUT an
  `@raycast/api` import (`betterdisplay`, `sidecar`, `keepalive`) are compiled by
  `test:build`; keep testable logic there.

## Invariants

- **Never write `--main`.** Changing the main display relocates the user's
  windows. Mirroring must always use the existing main display as the master
  and the iPad as the target; the reverse direction promotes the iPad to master.
- **The mode path never disconnects or power-cycles a display.** The
  connect/disconnect/mode orchestration in `sidecar.ts` issues no `--connected=`
  writes on any display; an earlier mitigation that cycled displays *inside* the
  mode path scrambled every window and was removed. The one sanctioned
  `--connected=off`/`on` cycle is the explicit **Fix Mirroring** feature
  (`virtualscreens.ts`): scoped to the main virtual screen by UUID, guaranteed to
  reconnect (a rejected disconnect is tolerated, the reconnect always runs), and
  triggered only on the `fixMirrorAfterConnect` opt-in or the manual command —
  never from inside converge. The mode path's entire mutation surface is: the
  Sidecar link, `--mirror=off` on the iPad, and `--mirror=on` with the current
  main as master.
- **Never write for an absent display; converge and hold; never trust one read.**
  `ensureDisplayMode` writes only when the iPad's display reads *present*
  (`readMirror` non-null) and disagrees with the target; an absent or phantom
  display (null) is never written, and the call throws at the deadline having
  changed nothing. Once present, the mode is re-asserted on every disagreeing
  read and reported `settled` only after it reads correct `REQUIRED_STABLE_READS`
  (3) times running — outlasting the ~1s macOS spends rearranging a freshly
  connected display (it often comes up mirrored, then flips). `get --sidecarList`
  lists paired-but-maybe-absent devices, so a resolved name is not proof of
  reachability — the present-read requirement is what makes the absent case safe.
- **If the iPad is the main display, do nothing to its mode and report it.**
- **Never trust a single read after a write.** Poll until the state settles or
  the timeout expires.
- **`set --sidecarConnected` is not idempotent.** It fails when the link is
  already in the requested state. Read the state before writing.
- **Auto-reconnect only chases a link that dropped on its own.** Every manual
  connect/disconnect/toggle records intent via `recordIntent`; keep-alive must
  respect a deliberate disconnect. It never abandons a wanted link permanently:
  a fast backoff burst, then a slow heartbeat. There is no on-wake or
  display-change event, so a long gap between ticks is treated as a wake and
  re-arms an immediate attempt — that is the only "wake" signal available.

## Verification

`npm run lint` and `npm run build` must both be clean.

`npm run test:safety` needs no iPad and makes no display changes: it is the
regression guard proving an absent/unreachable device produces zero topology
writes and never touches the main display. Run it after any change to the
orchestration.

`npm run test:hardware` additionally reproduces the mirroring case, asserts the
extension heals it without moving the main display, and exercises the full
connect/disconnect lifecycle. It requires BetterDisplay running, an iPad paired
for Sidecar, and at least one virtual screen.
