// ============ EXPORT LOCK — regression check ============
//
// Offline, no DOM, no React. Locks the single-flight + cooldown behaviour of
// lib/exportLock.js — the guard that stops a fast double-click on an export
// button from firing two downloads before React re-renders the `disabled`
// prop (see AuditReportTab.jsx / ScheduleIIIReviewer.jsx / GroupingMapper.jsx).
//
// Run: node test/exportLock.test.mjs   (or npm test, which chains it)

import assert from 'node:assert/strict';
import { createExportLock } from '../src/lib/exportLock.js';

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\nexport lock');

await check('two concurrent runExport calls execute the guarded function only once', async () => {
  const lock = createExportLock(50);
  let calls = 0;
  const fn = async () => { calls++; await sleep(10); };

  const [first, second] = await Promise.all([
    lock.runExport(fn),
    lock.runExport(fn),
  ]);

  assert.equal(calls, 1, `expected fn to run once, ran ${calls} times`);
  assert.equal(first, true, 'first (unlocked) call should return true');
  assert.equal(second, false, 'second (locked) call should return false');
});

await check('after the cooldown elapses, a later call runs again', async () => {
  const lock = createExportLock(30);
  let calls = 0;
  const fn = async () => { calls++; };

  const ran1 = await lock.runExport(fn);
  assert.equal(ran1, true);
  assert.equal(calls, 1);

  // Immediately after fn() resolves the lock is still held for the cooldown.
  const ranTooSoon = await lock.runExport(fn);
  assert.equal(ranTooSoon, false, 'call inside the cooldown window should be rejected');
  assert.equal(calls, 1, 'fn must not have run a second time yet');

  await sleep(50); // past the 30ms cooldown

  const ran2 = await lock.runExport(fn);
  assert.equal(ran2, true, 'call after the cooldown should run');
  assert.equal(calls, 2, 'fn should have run a second time');
});

await check('setBusy is driven true then false across the cooldown', async () => {
  const lock = createExportLock(30);
  const busyStates = [];
  const setBusy = (v) => busyStates.push(v);
  const fn = async () => { await sleep(5); };

  await lock.runExport(fn, setBusy);
  assert.deepEqual(busyStates, [true], 'setBusy(true) should fire before fn resolves');

  await sleep(50); // past the cooldown — the finally's setTimeout should have fired

  assert.deepEqual(busyStates, [true, false], 'setBusy(false) should fire after the cooldown elapses');
});

await check('a throwing fn still releases the lock (no permanent deadlock)', async () => {
  const lock = createExportLock(20);
  const setBusy = () => {};

  let threw = false;
  try {
    await lock.runExport(() => { throw new Error('boom'); }, setBusy);
  } catch {
    threw = true;
  }
  // runExport does not itself catch the caller's error — but per the contract
  // the finally block must still run and eventually release the lock, so a
  // rejecting fn must not deadlock every future export.
  assert.equal(threw, true, 'the thrown error should propagate to the caller');

  await sleep(40); // past the cooldown

  let ranAfter = false;
  await lock.runExport(() => { ranAfter = true; });
  assert.equal(ranAfter, true, 'lock must be released after a throwing fn, not stuck forever');
});

console.log(failures === 0 ? '\nall export lock checks passed\n' : `\n${failures} export lock check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
