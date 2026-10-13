// This transport is isolated to domestic.contract.test.ts. There is deliberately
// no reference to the original fetch, so even an unexpected request fails closed.
import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';

if (process.env.ONEIROS_CONTRACT_TEST !== '1' || !process.env.FAKE_DOMESTIC_REQUESTS || !process.env.FAKE_DOMESTIC_SCENARIO ||
    !['', 'deepseek-contract-only'].includes(process.env.DEEPSEEK_API_KEY) ||
    !['', 'dashscope-contract-only'].includes(process.env.DASHSCOPE_API_KEY)) {
  throw new Error('The domestic AI transport must only run in its isolated contract test.');
}

const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVhcAAAAASUVORK5CYII=';
const imageUrl = 'https://oneiros-contract.oss-cn-beijing.aliyuncs.com/generated.png?signature=fixture';
const interpretation = {
  title: 'The Blue Door', coreTheme: 'A possible transition.', unconsciousTension: 'Curiosity and uncertainty.',
  dominantMood: 'Curiosity',
  archetypes: [{ name: 'Threshold', description: 'A possible transition.', appearanceInDream: 'A blue garden door.' }],
  symbols: [{ symbol: 'Door', archetypalMeaning: 'A possible opportunity.', personalReflectionPrompt: 'What does the door remind you of?' }],
  individuationGuidance: 'Write down your personal associations with the garden.',
  surrealistImagePrompt: 'A quiet blue doorway in a surrealist garden, oil painting.',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (content, finish_reason = 'stop') => json({ choices: [{ index: 0, finish_reason, message: { role: 'assistant', content } }] });

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const scenario = JSON.parse(await readFile(process.env.FAKE_DOMESTIC_SCENARIO, 'utf8'));
  assert.equal(url.protocol, 'https:', 'Contract tests prohibit external network access.');
  const body = request.method === 'POST' ? await request.json() : null;
  await appendFile(process.env.FAKE_DOMESTIC_REQUESTS,
    `${JSON.stringify({ host: url.hostname, pathname: url.pathname, method: request.method, body })}\n`, 'utf8');

  if (url.hostname === 'oneiros-contract.oss-cn-beijing.aliyuncs.com') {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.get('authorization'), null, 'The API key must not be sent to the image host.');
    if (scenario.mode === 'redirect-unsafe') return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
    if (scenario.mode === 'non-image') return new Response('<html>Not an image</html>', { headers: { 'Content-Type': 'image/png' } });
    return new Response(Buffer.from(imageBase64, 'base64'), { headers: { 'Content-Type': 'image/png' } });
  }

  assert.ok(['api.deepseek.com', 'dashscope.aliyuncs.com', 'contractspace.cn-beijing.maas.aliyuncs.com'].includes(url.hostname),
    `Unexpected external host in contract test: ${url.hostname}`);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('authorization'), url.hostname === 'api.deepseek.com' ? 'Bearer deepseek-contract-only' : 'Bearer dashscope-contract-only');
  if (scenario.mode === 'auth') return json({ error: { message: 'invalid api key sk-secret-must-not-leak', code: 'invalid_api_key' } }, 401);
  if (scenario.mode === 'quota') return json({ code: 'Throttling', message: 'quota exceeded sk-secret-must-not-leak' }, 429);
  if (scenario.mode === 'malformed') return new Response('{invalid JSON', { headers: { 'Content-Type': 'application/json' } });
  if (scenario.mode === 'network') throw new TypeError('fetch failed sk-secret-must-not-leak');

  if (url.hostname === 'api.deepseek.com') {
    assert.equal(url.pathname, '/chat/completions');
    if (scenario.mode === 'empty') return completion('   ');
    if (scenario.mode === 'truncated') return completion('{"title":"Partial"}', 'length');
    if (body.response_format?.type === 'json_object') {
      if (scenario.mode?.startsWith('blank-')) {
        const result = structuredClone(interpretation);
        const [field, itemField] = scenario.mode.slice('blank-'.length).split('.');
        if (itemField) result[field][0][itemField] = ' \t\n';
        else result[field] = ' \t\n';
        return completion(JSON.stringify(result));
      }
      if (scenario.mode === 'no-associations') return completion(JSON.stringify({ ...interpretation, archetypes: [], symbols: [] }));
      return completion(scenario.mode === 'invalid-json' ? '{incomplete JSON' : JSON.stringify(scenario.mode === 'incomplete' ? { title: 'Incomplete' } : interpretation));
    }
    return completion('What personal memory comes to mind when you imagine the blue door?');
  }

  if (url.pathname === '/compatible-mode/v1/chat/completions') {
    return completion(scenario.mode === 'empty' ? '' : '  I walked through a quiet garden beside a blue door.  ');
  }

  assert.equal(url.pathname, '/api/v1/services/aigc/multimodal-generation/generation');
  if (/^qwen-audio-3\.[01]-asr-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(body.model)) {
    assert.equal(request.headers.get('x-dashscope-sse'), 'disable');
    if (scenario.mode === 'asr-missing-text') return json({ output: { choices: [{ message: { content: 'Wrong response shape' } }] } });
    if (scenario.mode === 'asr-nontext') return json({ output: { text: ['Wrong response type'] } });
    return json({ output: { text: scenario.mode === 'empty' ? ' \t\n' : '  I walked through a quiet garden beside a blue door.  ' } });
  }
  const generatedUrl = scenario.mode === 'unsafe-image-url' ? 'http://127.0.0.1/private' : imageUrl;
  return json({ output: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: scenario.mode === 'empty' ? [] : [{ image: generatedUrl }] } }] } });
};
