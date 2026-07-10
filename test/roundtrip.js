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
  const config = { cliPath: CLI, ipadName: ipad, mode: "extend", reconnectVirtualScreens: true, settleTimeoutMs: 15000 };
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
  expect("settled into extend", outcome.settled === true, JSON.stringify(outcome));
  expect("iPad is extending", (await bd.readMirrorState(CLI, ipad)) === false);

  console.log("--- connect again ---");
  const again = await sc.connectSidecar(config);
  expect("redundant connect is a mode no-op", again.changed === false, JSON.stringify(again));

  const mainAfter = (await bd.readMainDisplay(CLI)).uuid;
  expect("main display never moved", mainAfter === mainBefore, `${mainBefore} -> ${mainAfter}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
