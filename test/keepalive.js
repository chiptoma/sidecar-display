// =============================================================================
// UNIT TEST - KEEP-ALIVE DECISION
// Pure logic; no hardware, no BetterDisplay. Runs anywhere.
// -----------------------------------------------------------------------------
// Context: Proves the state machine only reconnects a link that dropped on its
//   own, backs off, gives up, and re-arms — the guarantees that keep background
//   auto-reconnect from nagging or fighting a deliberate disconnect.
// =============================================================================

const { decideKeepAlive, stateForIntent, INITIAL_STATE } = require("../.test-build/keepalive");

const TUNING = { maxAttempts: 3, backoffBaseMs: 1000, backoffCapMs: 60000 };

let failures = 0;

function expect(label, pass, extra = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
  if (!pass) {
    failures += 1;
  }
}

function decide(overrides) {
  return decideKeepAlive({ ...TUNING, nowMs: 1_000_000, ...overrides });
}

// A deliberate disconnect must never be chased.
expect(
  "does nothing when the user wants it disconnected",
  decide({ isConnected: false, state: stateForIntent("disconnected") }).action === "none",
);

// Nothing to do when the link is already up; counters are cleared.
{
  const d = decide({ isConnected: true, state: { intent: "connected", failedAttempts: 2, lastAttemptAtMs: 0, gaveUp: false } });
  expect("no action when already connected", d.action === "none");
  expect("clears failed attempts when connected", d.nextState.failedAttempts === 0);
}

// A link that dropped while the user wanted it connected is reconnected.
{
  const d = decide({ isConnected: false, state: stateForIntent("connected") });
  expect("reconnects a link that dropped on its own", d.action === "reconnect");
  expect("counts the attempt", d.nextState.failedAttempts === 1);
}

// Backoff: a second attempt is held off until the window elapses.
{
  const justTried = { intent: "connected", failedAttempts: 1, lastAttemptAtMs: 999_500, gaveUp: false };
  expect(
    "waits out the backoff window",
    decide({ isConnected: false, state: justTried, nowMs: 1_000_000 }).action === "none",
  );
  expect(
    "retries once the backoff window passes",
    decide({ isConnected: false, state: justTried, nowMs: 1_000_000 + 5000 }).action === "reconnect",
  );
}

// Give up after the attempt budget, and stay quiet.
{
  const spent = { intent: "connected", failedAttempts: 3, lastAttemptAtMs: 0, gaveUp: false };
  const d = decide({ isConnected: false, state: spent, nowMs: 9_000_000 });
  expect("gives up after the attempt budget", d.action === "none" && d.nextState.gaveUp === true);

  const gaveUp = { ...spent, gaveUp: true };
  expect("stays quiet after giving up", decide({ isConnected: false, state: gaveUp, nowMs: 9_000_000 }).action === "none");
}

// The link returning after a give-up clears the give-up.
{
  const gaveUp = { intent: "connected", failedAttempts: 3, lastAttemptAtMs: 0, gaveUp: true };
  const d = decide({ isConnected: true, state: gaveUp });
  expect("clears give-up when the link returns", d.nextState.gaveUp === false && d.nextState.failedAttempts === 0);
}

// A manual connect re-arms after a give-up.
expect("stateForIntent re-arms a fresh connected intent", stateForIntent("connected").gaveUp === false && stateForIntent("connected").failedAttempts === 0);
expect("initial state starts disconnected", INITIAL_STATE.intent === "disconnected");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
