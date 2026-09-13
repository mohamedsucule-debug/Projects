/* tests/harness.mjs — assertions and a tally. Kept separate from run.mjs so
   test files never import the module that is importing them. */

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', off: '\x1b[0m' }
  : { dim: '', red: '', green: '', off: '' };

export const tally = { passed: 0, failed: 0, failures: [] };

export function test(name, fn) {
  try {
    fn();
    tally.passed++;
    process.stdout.write(`  ${C.green}✓${C.off} ${C.dim}${name}${C.off}\n`);
  } catch (e) {
    tally.failed++;
    tally.failures.push({ name, error: e });
    process.stdout.write(`  ${C.red}✗ ${name}${C.off}\n    ${C.red}${e.message}${C.off}\n`);
  }
}

export const assert = {
  ok(cond, msg = 'expected a truthy value') { if (!cond) throw new Error(msg); },
  equal(actual, expected, msg) {
    if (!Object.is(actual, expected)) throw new Error(msg || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  deep(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(msg || `expected ${b}\n      got      ${a}`);
  },
  close(actual, expected, tol = 1e-6, msg) {
    if (Math.abs(actual - expected) > tol) throw new Error(msg || `expected ${expected} ±${tol}, got ${actual}`);
  },
  throws(fn, msg = 'expected a throw') {
    try { fn(); } catch { return; }
    throw new Error(msg);
  },
};
