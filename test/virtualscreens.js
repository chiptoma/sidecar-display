// =============================================================================
// UNIT TEST - VIRTUAL SCREENS (fake CLI, no hardware)
// Proves the mirror fix never leaves a virtual screen disconnected.
// -----------------------------------------------------------------------------
// Context: Drives reconnectVirtualScreens against a stub betterdisplaycli script
//   so the real execFile path, argument construction, and error handling run
//   with zero hardware and no BetterDisplay. Proves the safety-critical
//   guarantee that the reconnect ALWAYS runs (the screen never stays down) even
//   when the disconnect is rejected, that the main virtual screen is targeted by
//   UUID with a --type fallback, and that a failed reconnect still surfaces.
// =============================================================================

const { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { reconnectVirtualScreens } = require("../.test-build/virtualscreens");

let failures = 0;

function expect(label, pass, extra = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
  if (!pass) {
    failures += 1;
  }
}

const oneLine = (text) => text.trim().replace(/\n/g, " | ");

// A stub betterdisplaycli: logs every invocation's args and returns exit codes
// and get-output driven by environment variables set per test case.
const dir = mkdtempSync(join(tmpdir(), "vs-test-"));
const cliPath = join(dir, "fake-betterdisplaycli");
const logPath = join(dir, "calls.log");

const script = `#!/bin/bash
echo "$@" >> "${logPath}"
case "$*" in
  *"--displayWithMainStatus"*) printf '%s' "$FAKE_GET_OUTPUT"; exit "\${FAKE_GET_EXIT:-0}" ;;
  *"--connected=off"*) exit "\${FAKE_OFF_EXIT:-0}" ;;
  *"--connected=on"*) exit "\${FAKE_ON_EXIT:-0}" ;;
  *) exit 0 ;;
esac
`;
writeFileSync(cliPath, script);
chmodSync(cliPath, 0o755);

async function runCase({ getOutput = "", getExit = "0", offExit = "0", onExit = "0" }) {
  writeFileSync(logPath, "");
  process.env.FAKE_GET_OUTPUT = getOutput;
  process.env.FAKE_GET_EXIT = getExit;
  process.env.FAKE_OFF_EXIT = offExit;
  process.env.FAKE_ON_EXIT = onExit;
  let threw = false;
  try {
    await reconnectVirtualScreens(cliPath, 5);
  } catch {
    threw = true;
  }
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  return { log, threw };
}

async function main() {
  // Main IS a virtual screen and the disconnect is rejected: the reconnect must
  // still run, targeting the main screen by UUID, so it is never left down.
  {
    const { log, threw } = await runCase({
      getOutput: '{"UUID":"ABC-123","deviceType":"VirtualScreen"}',
      offExit: "1",
    });
    expect("targets the main virtual screen by UUID", log.includes("--UUID=ABC-123 --connected=on"), oneLine(log));
    expect("reconnect runs even when the disconnect is rejected", !threw && log.includes("--UUID=ABC-123 --connected=on"));
    expect("attempts the disconnect first", log.includes("--UUID=ABC-123 --connected=off"));
  }

  // Main is a real display: no UUID to target, so it falls back to cycling all
  // virtual screens by --type.
  {
    const { log, threw } = await runCase({ getOutput: '{"UUID":"XYZ","deviceType":"Display"}' });
    expect(
      "falls back to --type=VirtualScreen when main is not a virtual screen",
      !threw && log.includes("--type=VirtualScreen --connected=on"),
      oneLine(log),
    );
  }

  // The main-status read itself fails: still safe, falls back to --type.
  {
    const { log, threw } = await runCase({ getExit: "1" });
    expect(
      "falls back to --type when the main-status read fails",
      !threw && log.includes("--type=VirtualScreen --connected=on"),
      oneLine(log),
    );
  }

  // A genuinely failed reconnect is the one thing that should surface an error,
  // not be swallowed.
  {
    const { threw } = await runCase({
      getOutput: '{"UUID":"ABC-123","deviceType":"VirtualScreen"}',
      onExit: "1",
    });
    expect("a failed reconnect surfaces as an error", threw === true);
  }

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
