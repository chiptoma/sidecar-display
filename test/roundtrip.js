// =============================================================================
// HARDWARE TEST - CONNECT LIFECYCLE
// Exercises the connect, disconnect, and idempotence paths on real hardware.
// -----------------------------------------------------------------------------
// Context: Requires BetterDisplay running and an iPad paired for Sidecar.
// WARN: Disconnects and reconnects the iPad. Leaves it connected and extending.
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
  const ipad = await sc.resolveIpadName(CLI, "");
  const config = { cliPath: CLI, ipadName: ipad, mode: "extend", settleTimeoutMs: 15000 };
  const mainBefore = (await bd.readMainDisplay(CLI)).uuid;

  console.log("--- disconnect ---");
  await sc.disconnectSidecar(config);
  expect("link is down", (await sc.isConnected(config)) === false);
  expect("iPad display is gone", (await bd.readMirrorState(CLI, ipad)) === null);

  console.log("--- disconnect again ---");
  await sc.disconnectSidecar(config);
  expect("redundant disconnect does not throw", true);

  console.log("--- connect ---");
  const outcome = await sc.connectSidecar(config);
  expect("link is up", (await sc.isConnected(config)) === true);
  // A healthy connect either settles into extend, or safely declines because
  // macOS made the iPad main. Both are acceptable; a silent non-settle is not.
  const safeOutcome = outcome.settled === true || /main/.test(outcome.skippedReason || "");
  expect("connect reached a safe outcome", safeOutcome, JSON.stringify(outcome));

  console.log("--- connect again ---");
  const again = await sc.connectSidecar(config);
  expect("redundant connect makes no change", again.changed === false, JSON.stringify(again));

  // The extension never writes the main display. macOS itself may re-pick main
  // across a disconnect/reconnect, so this is reported, not asserted.
  const mainAfter = (await bd.readMainDisplay(CLI)).uuid;
  if (mainAfter !== mainBefore) {
    console.log(`NOTE  macOS moved the main display across reconnect (${mainBefore} -> ${mainAfter}); not written by the extension`);
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
