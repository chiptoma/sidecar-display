// =============================================================================
// HARDWARE TEST - DISPLAY MODE (BetterDisplay engine)
// Reproduces the mirroring case and asserts the extension heals it.
// -----------------------------------------------------------------------------
// Context: Requires BetterDisplay running and an iPad connected over Sidecar.
// WARN: Briefly mirrors the iPad. Asserts the main display never moves.
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

  const devices = await backend.listDevices();
  expect("listDevices finds a Sidecar device", devices.length >= 1, JSON.stringify(devices));

  const ipad = await sc.resolveIpadName(backend, "");
  const config = { ipadName: ipad, mode: "extend", settleTimeoutMs: 8000 };
  const mainBefore = mainUuid();
  expect("the iPad is not main at the start", !(await backend.isIpadMain(ipad)));

  expect("readMirror of an absent display is null", (await backend.readMirror("No Such")) === null);
  expect("isConnected reports the iPad is attached", (await sc.isConnected(backend, config)) === true);

  const noop = await sc.ensureDisplayMode(backend, config);
  expect("ensureDisplayMode(extend) no-ops when extending", !noop.changed && noop.settled, JSON.stringify(noop));

  console.log("\n--- forcing mirror, then healing ---");
  await backend.mirrorToMain(ipad);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect("iPad is mirroring (case reproduced)", (await backend.readMirror(ipad)) === true);

  const healed = await sc.ensureDisplayMode(backend, config);
  expect("ensureDisplayMode(extend) healed it", healed.changed && healed.settled, JSON.stringify(healed));
  expect("iPad extends again", (await backend.readMirror(ipad)) === false);

  const mainAfter = mainUuid();
  expect("main display never moved", mainAfter === mainBefore, `${mainBefore} -> ${mainAfter}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
