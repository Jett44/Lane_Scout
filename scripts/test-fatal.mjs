/*
 * Does the run stop when the account is out of room?
 *
 *   node scripts/test-fatal.mjs
 *
 * A miss here is expensive in a way that does not show up in the token count:
 * the run keeps spawning processes that cannot succeed, and it keeps competing
 * for whatever quota the user is trying to use themselves. Every string below
 * is one the CLI has actually returned.
 */
import { FATAL } from "./generate.mjs";

const shouldStop = [
  "You've hit your session limit · resets 2:10am (America/Chicago)",
  "You've hit your usage limit · resets 9pm",
  "Claude usage limit reached. Your limit will reset at 3pm.",
  "Not logged in · Please run /login",
  "rate limit exceeded",
  "Too Many Requests",
  "Your credit balance is too low",
  "insufficient quota",
  "401 unauthorized",
  "Overloaded"
];

const shouldContinue = [
  "no JSON in reply",
  "rejected: tell incomplete; powerCurve needs 3+ segments",
  "spawn failed: ETIMEDOUT",
  "The brief describes a lane where the enemy has a limit to their engage range",
  "Build a limit-testing item path once you are ahead"
];

let pass = 0, fail = 0;
for (const s of shouldStop) {
  const ok = FATAL.test(s);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  stops on: ${s.slice(0, 62)}`);
}
for (const s of shouldContinue) {
  const ok = !FATAL.test(s);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  continues: ${s.slice(0, 62)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
