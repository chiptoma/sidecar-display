# Sidecar Display

Raycast extension that connects an iPad over Sidecar via `betterdisplaycli` and
forces extend (or mirror) without touching the main display.

## Language rules

@~/.claude/rules/lang/typescript.md

## Architecture

- `src/lib/betterdisplay.ts` — the only module that shells out to the CLI.
  Reads tolerate rejection (`Failed.` on stderr, exit 1) and return `null`;
  writes throw. Nothing else in the codebase invokes the binary.
- `src/lib/sidecar.ts` — display/link orchestration. Pure Node, no
  `@raycast/api` import, so the hardware tests can exercise it.
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
- **Never disconnect or power-cycle a display.** No `--connected=` writes. An
  earlier "reconnect virtual screens" mitigation cycled the main display (which
  on this user's setup *is* a virtual screen) and scrambled every window. It was
  removed. The entire mutation surface is: the Sidecar link, `--mirror=off` on
  the iPad, and `--mirror=on` with the current main as master.
- **Gate every window-moving write on a stable read.** `awaitStableMirrorState`
  requires two consecutive equal, non-null samples. A flaky or phantom Sidecar
  connection never passes, so it never reaches a write. `get --sidecarList`
  lists paired-but-maybe-absent devices, so a resolved name is not proof of
  reachability — the gate is what makes the absent-device case safe.
- **If the iPad is the main display, do nothing to its mode and report it.**
- **Never trust a single read after a write.** Poll until the state settles or
  the timeout expires.
- **`set --sidecarConnected` is not idempotent.** It fails when the link is
  already in the requested state. Read the state before writing.
- **Auto-reconnect only chases a link that dropped on its own.** Every manual
  connect/disconnect/toggle records intent via `recordIntent`; keep-alive must
  respect a deliberate disconnect and give up after the attempt budget. There is
  no on-wake or display-change event — it is interval-polled only.

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
