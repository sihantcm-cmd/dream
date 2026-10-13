// Preloaded only by ai.contract.test.ts. Never forward any request to the network.
// Wire envelopes follow @google/genai's candidates parser and its
// addOutputProperties(): interactions steps -> output_text / output_image.
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';

if (process.env.ONEIROS_CONTRACT_TEST !== '1' || process.env.GEMINI_API_KEY !== 'contract-test-only' || !process.env.FAKE_GEMINI_REQUESTS) {
  throw new Error('The fake Gemini transport must only run in its isolated contract test.');
}

export const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVhcAAAAASUVORK5CYII=';
const interpretation = {
  title: 'The Blue Door',
  coreTheme: 'The door may evoke a transition.',
  unconsciousTension: 'Curiosity and uncertainty may coexist.',
  dominantMood: 'Curiosity',
  archetypes: [{ name: 'Threshold', description: 'A possible transition.', appearanceInDream: 'A blue garden door.' }],
  symbols: [{ symbol: 'Door', archetypalMeaning: 'A possible opportunity.', personalReflectionPrompt: 'What does the door remind you of?' }],
  individuationGuidance: 'Write down your personal associations with the garden.',
  surrealistImagePrompt: 'A quiet blue doorway in a surrealist garden, oil painting.',
};

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textCandidate(text) {
  return response({
    candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
  });
}

function interaction(model, content) {
  // Do not supply SDK convenience properties: the real SDK must derive them.
  return response({
    id: 'contract-interaction', model, status: 'completed',
    created: '2026-10-13T12:00:00Z', updated: '2026-10-13T12:00:01Z',
    steps: [{ type: 'model_output', content }],
  });
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  // No saved reference to the original fetch: an unexpected URL fails closed.
  assert.equal(url.protocol, 'https:', 'Contract tests prohibit external network access.');
  assert.equal(url.hostname, 'generativelanguage.googleapis.com', 'Unexpected external host in contract test.');
  assert.equal(request.headers.get('x-goog-api-key'), 'contract-test-only');
  assert.equal(request.method, 'POST');
  const body = await request.json();
  await appendFile(process.env.FAKE_GEMINI_REQUESTS, `${JSON.stringify({ pathname: url.pathname, body })}\n`, 'utf8');

  if (url.pathname.endsWith(':generateContent')) {
    const text = JSON.stringify(body.contents);
    if (body.generationConfig?.responseMimeType === 'application/json') {
      const value = text.includes('contract-incomplete-interpretation') ? { title: 'Incomplete' } : interpretation;
      return textCandidate(JSON.stringify(value));
    }
    return textCandidate(text.includes('contract-empty-chat') ? '   ' : 'What personal memory comes to mind when you imagine the blue door?');
  }

  assert.match(url.pathname, /\/interactions$/);
  if (body.model === 'gemini-nano-banana-2.1') {
    return interaction(body.model, [{ type: 'image', mime_type: 'image/png', data: imageBase64 }]);
  }
  assert.equal(body.model, 'gemini-3.5-transcribe');
  return interaction(body.model, [{ type: 'text', text: '  I walked through a quiet garden beside a blue door.  ' }]);
};
