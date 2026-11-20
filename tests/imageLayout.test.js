import test from 'node:test';
import assert from 'node:assert/strict';
import { imageWidth } from '../src/imageLayout.js';

test('keeps image sizes within readable bounds, including old notes without a size', () => {
  assert.equal(imageWidth(undefined), 100);
  assert.equal(imageWidth(0), 100);
  assert.equal(imageWidth(-20), 20);
  assert.equal(imageWidth(15), 20);
  assert.equal(imageWidth(40), 40);
  assert.equal(imageWidth(200), 100);
});
