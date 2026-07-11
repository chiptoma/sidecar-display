// =============================================================================
// HARDWARE TEST - SAFETY (no iPad required)
// Proves the extension makes no display changes when the iPad is absent.
// -----------------------------------------------------------------------------
// Context: Requires BetterDisplay running. Does NOT require an iPad, does NOT
//   connect Sidecar, and makes no topology writes. Safe to run any time.
// WARN: This is the regression guard for the incident where connecting an
//   unreachable iPad cycled the main display. It asserts the main display is
//   untouched across an attempt to settle a display that is not present.
// =============================================================================

const bd = require("../.test-build/betterdisplay");
const sc = require("../.test-build/sidecar");

const CLI = process.env.BD_CLI || "/opt/homebrew/bin/betterdisplaycli";

let failures = 0;

function expect(label, pass, extra = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
  if (!pass) {
    failures += 1;
  }
}

async function main() {
  expect("BetterDisplay reports a main display", Boolean(await bd.readMainDisplay(CLI)));
  const mainBefore = (await bd.readMainDisplay(CLI)).uuid;

  expect("resolveIpadName honours an override and trims it", (await sc.resolveIpadName(CLI, "  X  ")) === "X");
  expect("readMirrorState of an absent display is null", (await bd.readMirrorState(CLI, "No Such Display")) === null);

  // The incident scenario: ask the extension to settle a display that is not
  // present. It must refuse before writing anything, and the main display must
  // be exactly as it was.
  const absent = { cliPath: CLI, ipadName: "No Such Display", mode: "extend", settleTimeoutMs: 2000 };

  let threw = false;
  try {
    await sc.ensureDisplayMode(absent);
  } catch {
    threw = true;
  }
  expect("ensureDisplayMode refuses an absent display", threw);

  const mainAfter = (await bd.readMainDisplay(CLI)).uuid;
  expect("main display untouched by the refused attempt", mainAfter === mainBefore, `${mainBefore} -> ${mainAfter}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
