import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeMonoWav } from '../src/services/audio';
import { transcribeAudio } from '../src/services/api';
import { getSessionConfig } from '../src/services/cloud';

test('browser transcription preserves WAV bytes in direct upload and submits only the owned path', async (t) => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } });
  t.after(() => { if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window'); });

  // A valid 150-second recording exceeds Vercel's 4.5 MB request limit. Its
  // bytes must travel through the upload route, never the transcription JSON.
  const frames = new Float32Array(16_000 * 150);
  frames[0] = 0.5; frames[frames.length - 1] = -0.5;
  const wav = Buffer.from(encodeMonoWav([frames], 16_000));
  assert.ok(wav.length > 4.5 * 1024 * 1024);
  const mediaPath = '/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav';
  const uploadUrl = '/api/media/content/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav?token=synthetic';
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url === '/api/session') return Response.json({ mode: 'cloud', provider: 'aliyun', configured: true, authenticated: true });
    if (url === '/api/media/upload') {
      assert.deepEqual(JSON.parse(String(init?.body)), { kind: 'audio', mimeType: 'audio/wav' });
      return Response.json({ uploadUrl, mediaPath, method: 'PUT' });
    }
    if (url === uploadUrl) {
      assert.equal(init?.method, 'PUT'); assert.equal(init?.credentials, 'same-origin');
      assert.equal(new Headers(init?.headers).get('Content-Type'), 'audio/wav');
      assert.ok(init?.body instanceof Blob);
      assert.deepEqual(Buffer.from(await init.body.arrayBuffer()), wav, 'bare Base64 must decode to the complete original WAV');
      return Response.json({ mediaPath }, { status: 201 });
    }
    assert.equal(url, '/api/transcribe', 'unexpected request must never reach a live service');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { audioPath: mediaPath, mimeType: 'audio/wav' });
    assert.ok(Buffer.byteLength(String(init?.body)) < 256);
    return Response.json({ transcript: 'Synthetic dream recording.' });
  });

  await getSessionConfig(true);
  assert.equal(await transcribeAudio(wav.toString('base64'), 'audio/wav'), 'Synthetic dream recording.');
  assert.deepEqual(calls, ['/api/session', '/api/media/upload', uploadUrl, '/api/transcribe']);
});
