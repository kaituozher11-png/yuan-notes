import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPresets, modelProviders, applyModelPreset } from '../src/modelCatalog.js';
import { normalizeEndpoint } from '../server/agent.js';

test('preset catalog has distinct Chat Completions model IDs across providers', () => {
  assert.ok(modelProviders.length >= 10);
  assert.ok(modelPresets.length >= 50);
  assert.equal(new Set(modelPresets.map((item) => item.key)).size, modelPresets.length);
  for (const item of modelPresets) {
    assert.ok(item.model);
    assert.match(normalizeEndpoint(item.endpoint), /\/chat\/completions$/);
  }
});

test('selecting a preset fills its model and endpoint without changing saved credentials', () => {
  const form = {
    name: '我的模型', model: 'old-model', endpoint: 'https://example.com/v1',
    key: 'private-key', passphrase: 'private-phrase', vision: true,
  };
  const deepSeek = applyModelPreset(form, 'DeepSeek:deepseek-chat');
  assert.deepEqual(deepSeek, {
    ...form, model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1', vision: false,
  });
  const gemini = applyModelPreset(deepSeek, 'Google Gemini:gemini-2.5-flash');
  assert.equal(gemini.endpoint, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(gemini.model, 'gemini-2.5-flash');
  assert.equal(gemini.vision, true);
  assert.equal(applyModelPreset(gemini, ''), gemini);
});
