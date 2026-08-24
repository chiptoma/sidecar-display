# TODO

Outstanding work on Sidecar Display. Nothing here blocks release — it shipped.
What is left is real-use validation, stale gallery images, and maintenance.

Status: **shipped**. [raycast/extensions#29572](https://github.com/raycast/extensions/pull/29572)
was approved and merged on 2026-08-23 (merge commit `a3ef6fc`), and the extension
is live at <https://www.raycast.com/chiptoma/sidecar-display>. The reviewer asked
whether it should fold into the existing Sidecar extension; the separate-extension
case was made on the grounds that the two use different mechanisms (SidecarCore
directly vs AppleScript UI scripting) and was accepted.

---

## 1. Launch tasks — all done

- [x] **Set the repo Homepage URL** to the Store listing. Done 2026-08-23.
- [x] **Update the README "From the Raycast Store" section.** Done 2026-08-24.
- [x] **Re-cut `v1.0.0`** at the shipped commit. Retagged at `0cab389` on
      2026-08-24 (it pointed at `7ebf564`, 5 commits behind); `release.yml`
      re-cut the Release automatically.

## 2. Follow-ups now that it has shipped

- [ ] **Re-shoot `metadata/sidecar-display-3.png`** (and `media/preferences.png`).
      Both still show the removed **Engine** dropdown and the superseded extension
      description, against a manifest that now has 7 preferences. `metadata/` is
      the Store gallery, so a reviewer comparing it to the manifest sees an
      advertised setting that does not exist — the likeliest change-request.
      Preflight only validates dimensions (2000x1250), not content, so it passes.
- [ ] **Use the built extension for a day** (`npm run dev`). Nothing in `cd69d41`
      has run in a live Raycast session — auto-reconnect, the menu-bar refresh,
      the HUDs and the transport tooltips are verified only as logic and
      simulations. Every serious defect found so far surfaced from real use, not
      from tests or review: the `-501` banner storm, the stale menu bar, and
      BetterDisplay being cold-launched every 30s while closed.
- [ ] **Record a short screencast** of Connect plus the menu-bar toggle for the
      README. Wanted for the PR and never shot; it is the one thing a text
      README cannot convey about a display-manipulating extension. Needs the
      iPad on hand.
- [ ] **No outside review yet.** Greptile has run twice since and posted nothing
      new; its only review (2026-07-19) describes the original submission. The
      presence probe, the transport policy and the native-only rework have been
      seen by nobody outside this repo.

## 3. Optional enhancements (deferred, not blocking)

- [ ] **`readSnapshot()` on `SidecarBackend`.** The per-property interface does
      ~2 engine reads per converge tick (`readMirror` + `isIpadMain`); a single
      snapshot method would halve the CLI/Swift calls. Interface change; low
      priority. (Flagged as S3 in the smell scan.)
- [x] **Confirm the presence probe against the real undock/sleep scenario.**
      Confirmed 2026-07-31 at real distance: reports absent correctly. It also
      surfaced that "away" has two shapes — radios off keeps the device listed
      with bit 9 clear, while out-of-range drops it from the list entirely, which
      made auto-detection throw and killed the whole tick. Fixed by remembering
      the auto-detected name (`loadConfig`).
- [ ] **Explain the 31 Jul bits-2/24 sample.** Those bits track the cable (two
      clean plug/unplug cycles, 2026-08-05) and now back the "Cable only"
      option — but one earlier sample had them set with no cable knowingly
      attached. If something else can set them, "Cable only" will occasionally
      connect when not plugged in, which is what it exists to prevent.
- [ ] **Watch the probe across macOS updates and other hardware.** Bit 9 is
      undocumented and confirmed only on macOS 26.6 with one iPad. Two symptoms
      to watch for: banners piling up again (reads present when the iPad is gone)
      or auto-reconnect never firing on return (stuck absent — the hourly recheck
      caps the damage at one attempt/hour). Re-sample with a probe that dumps
      `SidecarDevice.status` if either shows up.
- [ ] **Auto-reconnect "reset to default" affordance.** The menu-bar toggle
      writes a LocalStorage override that supersedes the preference permanently
      once used. A menu item to clear the override (fall back to the preference)
      would round out the UX. (Noted in review as an accepted trade-off.)

## 4. Post-launch maintenance

- [ ] **Native engine / macOS updates.** `SidecarCore` is a private Apple
      framework reached via `dlopen`. Re-validate the selector set in
      `swift/Sources/Sidecar/SidecarBridge.swift` after each major macOS release;
      if it breaks, patch the Swift — there is no longer a fallback engine.
      Record the last-validated macOS version in the README.
- [ ] **Keep `@raycast/api` current** — Dependabot opens weekly PRs; staying
      current is a Store requirement, not just hygiene.
- [ ] **Toolchain pins.** `typescript` is held at `~6.0.3` and `@types/node` at
      `22.x` for peer/runtime compatibility (see [WORKFLOWS.md](./WORKFLOWS.md)
      and the project `CLAUDE.md`). Bump only when Raycast widens its peer
      ranges / the engines field.
- [ ] **Swift dependencies** are not covered by Dependabot — bump
      `swift/Package.swift` by hand and commit the regenerated
      `swift/Package.resolved`.
