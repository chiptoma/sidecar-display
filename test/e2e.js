// =============================================================================
// HARDWARE TEST - DISPLAY MODE
// Reproduces the mirroring bug against real hardware and asserts it is healed.
// -----------------------------------------------------------------------------
// Context: Requires BetterDisplay running, an iPad paired for Sidecar, and at
//   least one BetterDisplay virtual screen. Run via `npm run test:hardware`.
// WARN: Briefly mirrors the iPad. Asserts the main display never moves.
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
  const devices = await bd.listSidecarDevices(CLI);
  expect("listSidecarDevices finds a Sidecar device", devices.length >= 1, JSON.stringify(devices));

  const ipad = await sc.resolveIpadName(CLI, "");
  expect("resolveIpadName auto-detects", ipad === devices[0].name, ipad);
  expect("resolveIpadName honours override and trims", (await sc.resolveIpadName(CLI, "  X  ")) === "X");

  const config = { cliPath: CLI, ipadName: ipad, mode: "extend", reconnectVirtualScreens: true, settleTimeoutMs: 8000 };

  const main = await bd.readMainDisplay(CLI);
  expect("readMainDisplay returns a device with a UUID", Boolean(main && main.uuid));
  const mainBefore = main.uuid;

  const screens = await bd.listVirtualScreens(CLI);
  expect("listVirtualScreens finds a virtual screen", screens.length >= 1);

  expect("readMirrorState of an absent display is null", (await bd.readMirrorState(CLI, "No Such")) === null);
  expect("isConnected reports the iPad is attached", (await sc.isConnected(config)) === true);

  const noop = await sc.ensureDisplayMode(config);
  expect("ensureDisplayMode(extend) no-ops when extending", !noop.changed && noop.settled, JSON.stringify(noop));

  console.log("\n--- forcing mirror, then healing ---");
  await bd.startMirroring(CLI, mainBefore, ipad);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect("iPad is mirroring (bug reproduced)", (await bd.readMirrorState(CLI, ipad)) === true);

  const healed = await sc.ensureDisplayMode(config);
  expect("ensureDisplayMode(extend) healed it", healed.changed && healed.settled, JSON.stringify(healed));
  expect("iPad extends again", (await bd.readMirrorState(CLI, ipad)) === false);
  expect("escalation was not needed", healed.escalated === false);

  const mainAfter = (await bd.readMainDisplay(CLI)).uuid;
  expect("main display never moved", mainAfter === mainBefore, `${mainBefore} -> ${mainAfter}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
