// =============================================================================
// HARDWARE TEST - CONNECT LIFECYCLE (BetterDisplay engine)
// Exercises connect, disconnect, and idempotence on real hardware.
// -----------------------------------------------------------------------------
// Context: Requires BetterDisplay running and an iPad paired for Sidecar.
// WARN: Disconnects and reconnects the iPad. Leaves it connected and extending.
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
  const ipad = await sc.resolveIpadName(backend, "");
  const config = { ipadName: ipad, mode: "extend", settleTimeoutMs: 15000 };
  const mainBefore = mainUuid();

  console.log("--- disconnect ---");
  await sc.disconnectSidecar(backend, config);
  expect("link is down", (await sc.isConnected(backend, config)) === false);
  expect("iPad display is gone", (await backend.readMirror(ipad)) === null);

  console.log("--- disconnect again ---");
  await sc.disconnectSidecar(backend, config);
  expect("redundant disconnect does not throw", true);

  console.log("--- connect ---");
  const outcome = await sc.connectSidecar(backend, config);
  expect("link is up", (await sc.isConnected(backend, config)) === true);
  const safeOutcome = outcome.settled === true || /main/.test(outcome.skippedReason || "");
  expect("connect reached a safe outcome", safeOutcome, JSON.stringify(outcome));

  console.log("--- connect again ---");
  const again = await sc.connectSidecar(backend, config);
  expect("redundant connect makes no change", again.changed === false, JSON.stringify(again));

  const mainAfter = mainUuid();
  if (mainAfter !== mainBefore) {
    console.log(`NOTE  macOS moved main across reconnect (${mainBefore} -> ${mainAfter}); not written by the extension`);
  } else {
    console.log("NOTE  main display unchanged across reconnect");
  }

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
