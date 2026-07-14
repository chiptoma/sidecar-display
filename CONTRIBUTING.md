# Contributing

Notes for working on Sidecar Display — conventions, architecture, and the release
process. The goal is that anyone (including a future you) can pick the project up
cold and stay consistent with what's here.

## Prerequisites

- **Node 22** (matches CI) and **npm** (commit `package-lock.json`).
- **Raycast**.
- **Full Xcode** — the native engine's Swift is compiled at build time via
  [`extensions-swift-tools`](https://github.com/raycast/extensions-swift-tools).
  The Command Line Tools alone are not enough.
- **BetterDisplay** (optional, for the BetterDisplay engine and the hardware
  tests) — `brew install --cask betterdisplay`.

## Getting started

```sh
npm install
npm run dev      # imports into Raycast and hot-reloads
```

`npm run dev` compiles the Swift package the first time (SPM fetches the
dependency and builds the macro, so the first run is slower), generates the
`swift:` TypeScript bridge, and reloads on save.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Import into Raycast + hot-reload. |
| `npm run build` | `ray build` (compiles Swift, generates types) **+ `tsc --noEmit`**. |
| `npm run typecheck` | `tsc --noEmit` only. |
| `npm run lint` / `npm run fix-lint` | ESLint + Prettier (auto-fix with the latter). |
| `npm run test:unit` | Hardware-free tests (CI runs this). |
| `npm run test:safety` | Unit + absent-device safety (needs BetterDisplay, no iPad). |
| `npm run test:hardware` | Full suite (needs an iPad + a virtual screen). |
| `npm run publish` | Build + test, then open the Raycast Store PR. |

Why a separate `typecheck`: `ray build` bundles with esbuild, which does **not**
type-check. `tsc --noEmit` is wired into `build` and CI so a type error fails the
build. Do not remove it.

## Architecture

See the [README](./README.md#how-it-works) for the deep version. In short:

- **Command entry points** (`src/*.ts(x)`) are thin — they read preferences,
  call one orchestration function, and render feedback. No logic lives here.
- **The orchestration** (`src/lib/sidecar.ts`) and the **keep-alive state
  machine** (`src/lib/keepalive.ts`) are pure — no `@raycast/api` import — so
  they're unit-tested headlessly against mocks. Keep testable logic in modules
  without a `@raycast/api` import; those are the ones `test:build` compiles.
- **Engines** implement the `SidecarBackend` interface (`src/lib/backend.ts`).
  The orchestration depends only on that interface, never on a concrete engine.
- **`src/lib/state.ts`** is the only module that touches `LocalStorage`.
- **The native engine** is Swift in `swift/`, exported to TypeScript with the
  `@raycast` macro and imported as `swift:../../swift`.

### Safety invariants — do not break these

These are enforced across every path and proven by tests. A past violation
scrambled every window and caused a logout.

1. **Never write the main display** (`--main`, or promoting the iPad to mirror
   master). Mirroring always keeps the current main as master; both mode writes
   are refused when the iPad is itself main.
2. **The connect/disconnect/mode path never disconnects or power-cycles a
   display.** The only sanctioned `--connected=` cycle is the isolated **Fix
   Mirroring** feature (`virtualscreens.ts`), scoped to the main virtual screen
   by UUID and guaranteed to reconnect it.
3. **Never write for a display that isn't present.** Mode writes happen only when
   `readMirror` returns non-null; an absent display is never written.
4. **Never trust a single read after a write.** Poll/converge until the state
   settles or the timeout expires.

If you touch `sidecar.ts` or `virtualscreens.ts`, run `test:unit` (and
`test:safety` if BetterDisplay is available) before committing.

## Code conventions

### File naming

- **Command entry files** match their Raycast manifest `name` and are
  **kebab-case** (`connect-sidecar.ts`) — this is a Raycast requirement.
- **Library modules** are **camelCase** (`betterdisplay.ts`, `virtualscreens.ts`).
- **Swift** files are `PascalCase` (`SidecarBridge.swift`).
- **Tests** are `{name}.js` under `test/`.

### File banners

Every source file (`.ts`, `.tsx`, `.swift`, `.yml`) opens with an 80-char
"heavy" banner: an uppercase title, a one-line description, and optional
`Context:` / `NOTE:` / `WARN:` lines for anything non-obvious. Group related
functions with 60-char "light" section dividers. Comments explain **why**, never
restate the code.

### TypeScript

- Strict mode; **no `any`** (use `unknown` + narrowing). No `as` without a
  `// SAFETY:` note (the exceptions are idiomatic JSON/error narrowing casts).
- **Explicit return types** on every function. `interface` for object shapes,
  `type` for unions. Prefer early returns.
- **JSDoc on every export** (`@param`/`@returns`), first line not repeating the
  name.
- Keep functions ≤ 50 lines and files ≤ 300 (ESLint enforces, blank/comment
  lines excluded).
- Import groups, blank-line separated: external → internal → `import type`.

### Swift

- `@raycast` goes on **global functions only**; params `Decodable`, returns
  `Encodable`/`Void`; `throws`/`async` supported. Import `Foundation` in any
  file using the macro (the expansion needs it).
- Surface failures by **throwing** (`throw HelperError("…")`); the message
  reaches TypeScript as the rejected promise's `.message`. Never `exit()`.
- Keep the SidecarCore/CoreGraphics logic in `SidecarBridge.swift` and the thin
  `@raycast` wrappers in `Exports.swift`.

## Commits

- **Conventional Commits**: `type(scope): summary` (`feat`, `fix`, `refactor`,
  `test`, `chore`, `docs`). Imperative mood, lower-case summary.
- Keep commits atomic — one concern each. Update docs in the **same commit** as
  the code they describe.
- No AI attribution, no emoji.

## Testing

Tests are behavioural — they assert observable outcomes, not that a value was
stored. When adding a feature:

- If it's pure logic, add a hardware-free test (mock backend or stub CLI) and
  wire it into `test:unit` so CI covers it.
- If it touches hardware, add/extend a `test:hardware` case, but keep the safety
  guarantee provable without hardware where possible (as `virtualscreens.js`
  does with a stub `betterdisplaycli`).

## Releasing

1. Update `CHANGELOG.md` — add an `## [Title] - {PR_MERGE_DATE}` entry
   (Raycast fills the date on merge).
2. Ensure `metadata/` has screenshots: **2000×1250 PNG**, up to 6, captured via
   Raycast's **Capture Window** action.
3. `npm run publish` — runs build + typecheck + unit tests, then opens a PR to
   [`raycast/extensions`](https://github.com/raycast/extensions). A human
   reviews it; on merge it publishes to the Store.
4. Tag the release (`git tag vX.Y.Z && git push --tags`) to cut a GitHub Release
   via the release workflow.

## CI

`.github/workflows/ci.yml` runs on every push/PR to `main`: `lint`, `build`
(which compiles the Swift and type-checks), and `test:unit`. The safety and
hardware suites need BetterDisplay and an iPad, so they run locally, not in CI.
