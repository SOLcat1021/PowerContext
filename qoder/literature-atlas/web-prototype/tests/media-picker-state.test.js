import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaPickerState } from '../src/media-picker-state.js';

test('the picker owns back while it is open, including a delayed native return', () => {
  let now = 0;
  const state = createMediaPickerState(() => now);
  assert.equal(state.blocksBack(), false);
  assert.equal(state.begin(), true);
  now = 60_000;
  assert.equal(state.blocksBack(), true);
  assert.equal(state.begin(), false);
  state.end();
  assert.equal(state.active, false);
  assert.equal(state.blocksBack(), true);
  now += 399;
  assert.equal(state.blocksBack(), true);
  now++;
  assert.equal(state.blocksBack(), false);
});

test('a second selection gets its own return protection after cancelling the first', () => {
  let now = 10;
  const state = createMediaPickerState(() => now);
  state.begin(); state.end(); now += 100;
  assert.equal(state.begin(), true);
  now += 10_000;
  assert.equal(state.blocksBack(), true);
  state.end(); now += 401;
  assert.equal(state.blocksBack(), false);
});
