import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfirmedPassword } from '../scripts/setup-aliyun.mjs';

test('setup keeps invalid passwords inside the hidden-input flow without confirming or echoing them', async () => {
  const invalid = ['short-test', `long-test-${'x'.repeat(256)}`, 'control-test-password\u0007'];
  const valid = 'Synthetic-test-password-only';
  const answers = [...invalid, valid, valid];
  const prompts: string[] = [], notices: string[] = [];
  const password = await readConfirmedPassword(async (prompt: string) => {
    prompts.push(prompt);
    const answer = answers.shift();
    assert.notEqual(answer, undefined, 'unexpected extra password prompt');
    return answer!;
  }, (notice: string) => notices.push(notice));

  assert.equal(password, valid);
  assert.equal(notices.length, invalid.length);
  assert.equal(prompts.length, invalid.length + 2);
  for (const prompt of prompts.slice(0, -1)) assert.equal(prompt, prompts[0], 'invalid entries must return to the first password prompt');
  assert.notEqual(prompts.at(-1), prompts[0], 'only the valid password should reach confirmation');
  for (const secret of [...invalid, valid]) assert.ok(![...prompts, ...notices].join('\n').includes(secret));
});

test('setup restarts confirmation after a mismatch and accepts both supported length boundaries', async () => {
  const first = 'first-password-test', mismatch = 'other-password-test';
  const minimum = 'a'.repeat(14), maximum = 'b'.repeat(256);
  const answers = [first, mismatch, minimum, minimum];
  const prompts: string[] = [], notices: string[] = [];
  assert.equal(await readConfirmedPassword(async (prompt: string) => {
    prompts.push(prompt);
    const answer = answers.shift();
    assert.notEqual(answer, undefined);
    return answer!;
  }, (notice: string) => notices.push(notice)), minimum);
  assert.equal(notices.length, 1);
  assert.equal(prompts[0], prompts[2]); assert.equal(prompts[1], prompts[3]);
  for (const secret of [first, mismatch, minimum]) assert.ok(!notices.join('\n').includes(secret));
  let reads = 0;
  assert.equal(await readConfirmedPassword(async () => { reads += 1; return maximum; }, () => assert.fail('valid boundary must not trigger a notice')), maximum);
  assert.equal(reads, 2);
});

test('setup propagates cancellation from either password prompt instead of swallowing it', async () => {
  for (const cancelAt of [1, 2]) {
    let reads = 0, notices = 0;
    const cancelled = new Error('Synthetic user cancellation');
    await assert.rejects(() => readConfirmedPassword(async () => {
      reads += 1;
      if (reads === cancelAt) throw cancelled;
      return 'Synthetic-test-password-only';
    }, () => { notices += 1; }), (error) => error === cancelled);
    assert.equal(reads, cancelAt);
    assert.equal(notices, 0);
  }
});
