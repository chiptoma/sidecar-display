// =============================================================================
// HARDWARE TEST - SAFETY (BetterDisplay engine, no iPad required)
// Proves the extension makes no display changes when the iPad is absent.
// -----------------------------------------------------------------------------
// Context: Requires BetterDisplay running. Does NOT require an iPad and makes no
//   topology writes. Uses betterdisplaycli directly as an independent oracle for
//   the main-display check.
// =============================================================================

const { execFileSync } = require("node:child_process");

const { createBetterDisplayBackend } = require("../.test-build/betterdisplay");
const sc = require("../.test-build/sidecar");

const CLI = process.env.BD_CLI || "/opt/homebrew/bin/betterdisplaycli";

let failures = 0;

function expect(label, pass, extra = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
  if (!pass) {
    failures += 1;
  }
}

function mainUuid() {
  const raw = execFileSync(CLI, ["get", "--displayWithMainStatus", "--identifiers"], { encoding: "utf8" });
  const match = raw.match(/"UUID"\s*:\s*"([^"]+)"/);
  return match ? match[1] : "?";
}

async function main() {
  const backend = createBetterDisplayBackend(CLI);
  const mainBefore = mainUuid();
  expect("BetterDisplay reports a main display", mainBefore !== "?");

  expect("resolveIpadName honours an override and trims it", (await sc.resolveIpadName(backend, "  X  ")) === "X");
  expect("readMirror of an absent display is null", (await backend.readMirror("No Such Display")) === null);

  // The incident scenario: ask the extension to settle a display that is not
  // present. It must refuse before writing anything, main untouched.
  const absent = { ipadName: "No Such Display", mode: "extend", settleTimeoutMs: 2000 };
  let threw = false;
  try {
    await sc.ensureDisplayMode(backend, absent);
  } catch {
    threw = true;
  }
  expect("ensureDisplayMode refuses an absent display", threw);

  const mainAfter = mainUuid();
  expect("main display untouched by the refused attempt", mainAfter === mainBefore, `${mainBefore} -> ${mainAfter}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
