import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createDreamStore } from '../server/dreamStore.ts';
import { draftDream, temporaryArchive } from './fixtures.ts';

test('concurrent writes preserve every dream and chat update', async (t) => {
  const directory = await temporaryArchive('store');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDreamStore(directory);
  const entries = Array.from({ length: 24 }, (_, index) => draftDream(`parallel-${index}`));
  const creates = await Promise.allSettled(entries.map((dream) => store.create(dream)));
  for (const result of creates) {
    if (result.status === 'rejected') throw result.reason;
  }
  const stored = await store.list();
  assert.equal(stored.length, entries.length);
  assert.deepEqual(new Set(stored.map((dream) => dream.id)), new Set(entries.map((dream) => dream.id)));

  const chats = entries.map((entry) => [{ role: 'user' as const, content: `Question for ${entry.id}`, timestamp: '2026-10-13T12:01:00.000Z' }]);
  const updates = await Promise.allSettled(entries.map((entry, index) => store.updateChatHistory(entry.id, chats[index])));
  for (const result of updates) {
    if (result.status === 'rejected') throw result.reason;
  }
  const reopened = await createDreamStore(directory).list();
  for (const [index, entry] of entries.entries()) {
    assert.deepEqual(reopened.find((dream) => dream.id === entry.id)?.chatHistory, chats[index]);
  }

  const duplicate = draftDream('duplicate');
  const outcomes = await Promise.allSettled([store.create(duplicate), store.create(duplicate)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal((await store.list()).filter((dream) => dream.id === duplicate.id).length, 1);
});

test('corrupt archive is surfaced and never overwritten by a mutation', async (t) => {
  const directory = await temporaryArchive('corrupt');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'dreams.json');
  const damaged = '[{"id":"precious-entry","transcript":"unfinished';
  await writeFile(file, damaged, 'utf8');
  const store = createDreamStore(directory);
  await assert.rejects(() => store.list());
  await assert.rejects(() => store.create(draftDream('new-dream')));
  await assert.rejects(() => store.bootstrap([draftDream('seed')]));
  assert.equal(await readFile(file, 'utf8'), damaged);

  // A failed queued write must not poison subsequent operations after a repair.
  await writeFile(file, '[]\n', 'utf8');
  await store.create(draftDream('after-repair'));
  assert.equal((await store.list())[0].id, 'after-repair');
});
