import { test } from 'node:test';
import assert from 'node:assert';
import { coverBox, label } from './detect-box';

test('label is class plus rounded percent', () => {
  assert.equal(label({ class: 'person', score: 0.941, bbox: [0, 0, 1, 1] }), 'person 94%');
  assert.equal(label({ class: 'bottle', score: 0.005, bbox: [0, 0, 1, 1] }), 'bottle 1%');
});

test('a frame that already matches the view maps 1:1', () => {
  // Same aspect and size -> scale 1, no crop.
  const b = coverBox([10, 20, 30, 40], 640, 480, 640, 480);
  assert.deepEqual(b, { x: 10, y: 20, w: 30, h: 40 });
});

test('cover crops the wider axis, not letterbox it', () => {
  // 640x480 (4:3) into a 480x480 square: cover scales by max(480/640, 480/480)
  // = 1.0 on height, so scale=1, and the extra 160px width is cropped 80 each
  // side. A box at the left edge shifts left by that 80.
  const b = coverBox([80, 0, 100, 100], 640, 480, 480, 480);
  assert.equal(b.x, 0);      // 80*1 - (640*1-480)/2 = 80 - 80
  assert.equal(b.y, 0);
  assert.equal(b.w, 100);
  assert.equal(b.h, 100);
});

test('cover scales up a small frame to fill a larger view', () => {
  // 320x240 into 640x480: both ratios are 2, uniform scale, no crop.
  const b = coverBox([10, 10, 50, 50], 320, 240, 640, 480);
  assert.deepEqual(b, { x: 20, y: 20, w: 100, h: 100 });
});

test('a zero-sized frame yields an empty box, not NaN', () => {
  assert.deepEqual(coverBox([1, 2, 3, 4], 0, 0, 640, 480), { x: 0, y: 0, w: 0, h: 0 });
});
