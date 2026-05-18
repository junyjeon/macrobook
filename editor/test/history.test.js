const test = require('node:test');
const assert = require('node:assert');
const { createHistory } = require('../history');

test.describe('createHistory', () => {
  test('exposes the initial state as current', () => {
    const h = createHistory({ x: 1 });
    assert.deepStrictEqual(h.current(), { x: 1 });
  });

  test('push() advances state and stores the previous in past', () => {
    const h = createHistory({ x: 1 });
    h.push({ x: 2 });
    assert.deepStrictEqual(h.current(), { x: 2 });
    assert.strictEqual(h.canUndo(), true);
    assert.strictEqual(h.canRedo(), false);
  });

  test('undo() restores the previous state and enables redo', () => {
    const h = createHistory({ x: 1 });
    h.push({ x: 2 });
    h.push({ x: 3 });
    assert.strictEqual(h.undo(), true);
    assert.deepStrictEqual(h.current(), { x: 2 });
    assert.strictEqual(h.canUndo(), true);
    assert.strictEqual(h.canRedo(), true);
  });

  test('undo() returns false when there is no past', () => {
    const h = createHistory({ x: 1 });
    assert.strictEqual(h.undo(), false);
    assert.deepStrictEqual(h.current(), { x: 1 });
  });

  test('redo() replays the most recent undone state', () => {
    const h = createHistory({ x: 1 });
    h.push({ x: 2 });
    h.undo();
    assert.strictEqual(h.redo(), true);
    assert.deepStrictEqual(h.current(), { x: 2 });
    assert.strictEqual(h.canRedo(), false);
  });

  test('redo() returns false when there is no future', () => {
    const h = createHistory({ x: 1 });
    assert.strictEqual(h.redo(), false);
  });

  test('push() after an undo clears the future (timeline branches off)', () => {
    const h = createHistory({ x: 1 });
    h.push({ x: 2 });
    h.push({ x: 3 });
    h.undo();
    h.push({ x: 99 });
    assert.strictEqual(h.canRedo(), false);
    assert.deepStrictEqual(h.current(), { x: 99 });
  });

  test('capacity drops the oldest past state once exceeded', () => {
    const h = createHistory({ n: 0 }, { capacity: 3 });
    h.push({ n: 1 });
    h.push({ n: 2 });
    h.push({ n: 3 });
    h.push({ n: 4 });
    while (h.canUndo()) h.undo();
    assert.deepStrictEqual(h.current(), { n: 1 });
  });

  test('push() with a state equal to current is a no-op (no duplicate history)', () => {
    const h = createHistory({ x: 1 });
    h.push({ x: 1 });
    assert.strictEqual(h.canUndo(), false);
  });

  test('current() returns the same reference until push() is called', () => {
    const initial = { x: 1 };
    const h = createHistory(initial);
    assert.strictEqual(h.current(), initial);
  });
});
