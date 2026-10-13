import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeMonoWav } from '../src/services/audio.ts';

test('transcription encoder emits a complete mono PCM WAV with correct timing fields', () => {
  const sampleRate = 16_000;
  const frames = new Float32Array(sampleRate);
  const bytes = Buffer.from(encodeMonoWav([frames], sampleRate));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(bytes.readUInt32LE(16), 16);
  assert.equal(bytes.readUInt16LE(20), 1, 'WAV must contain uncompressed PCM.');
  assert.equal(bytes.readUInt16LE(22), 1, 'Stereo recordings must become mono.');
  assert.equal(bytes.readUInt32LE(24), sampleRate);
  assert.equal(bytes.readUInt32LE(28), sampleRate * 2);
  assert.equal(bytes.readUInt16LE(32), 2);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  assert.equal(bytes.readUInt32LE(40), frames.length * 2);
  assert.equal(bytes.length, 44 + frames.length * 2);
  assert.equal(bytes.readUInt32LE(40) / bytes.readUInt32LE(28), 1, 'One second of input must remain one second.');
});

test('stereo samples mix to mono with clipping and nonfinite samples safely silenced', () => {
  const left = Float32Array.from([-1, 1, 4, -4, 0, NaN, Infinity]);
  const right = Float32Array.from([1, 1, 2, -2, 0.5, 0, 0]);
  const bytes = Buffer.from(encodeMonoWav([left, right], 16_000));
  const samples = Array.from({ length: left.length }, (_, index) => bytes.readInt16LE(44 + index * 2));
  assert.deepEqual(samples, [0, 32767, 32767, -32768, 8192, 0, 0]);
});

test('encoder rejects empty or mismatched channels and invalid sample rates', () => {
  assert.throws(() => encodeMonoWav([], 16_000));
  assert.throws(() => encodeMonoWav([new Float32Array()], 16_000));
  assert.throws(() => encodeMonoWav([new Float32Array(2), new Float32Array(1)], 16_000));
  for (const rate of [0, -1, 16_000.5, NaN, Infinity]) {
    assert.throws(() => encodeMonoWav([new Float32Array(2)], rate));
  }
});
