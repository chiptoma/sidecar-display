# Sidecar Display

Raycast extension that connects an iPad over Sidecar via `betterdisplaycli` and
forces extend (or mirror) without touching the main display.

## Language rules

@~/.claude/rules/lang/typescript.md

## Architecture

- `src/lib/betterdisplay.ts` — the only module that shells out to the CLI.
  Reads tolerate rejection (`Failed.` on stderr, exit 1) and return `null`;
  writes throw. Nothing else in the codebase invokes the binary.
- `src/lib/sidecar.ts` — orchestration. Pure Node, no `@raycast/api` import, so
  it can be exercised by the hardware tests.
- `src/lib/preferences.ts` — maps Raycast's generated `Preferences` type into a
  `SidecarConfig`. Never hand-declare the preference shape; it is generated from
  `package.json` by `ray build` and would silently drift.
- `src/*.ts` — one thin command entry point each. No logic.

## Invariants

- **Never write `--main`.** Changing the main display relocates the user's
  windows. Mirroring must always use the existing main display as the master
  and the iPad as the target; the reverse direction promotes the iPad to master.
- **Never trust a single read after a write.** BetterDisplay applies display
  changes asynchronously. Poll until the state settles or the timeout expires.
- **`set --sidecarConnected` is not idempotent.** It fails when the link is
  already in the requested state. Read the state before writing.
- Target virtual screens by UUID, never `--type=VirtualScreen`, so that a second
  virtual screen is never disturbed.

## Verification

`npm run lint` and `npm run build` must both be clean.

`npm run test:hardware` is the only test that proves anything: it drives the
real CLI against a real iPad, reproduces the mirroring bug, and asserts the
extension heals it without moving the main display. It requires BetterDisplay
running, an iPad paired for Sidecar, and at least one virtual screen.
