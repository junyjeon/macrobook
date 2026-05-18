const test = require('node:test');
const assert = require('node:assert');
const {
  hydrate,
  reorder,
  insert,
  remove,
  update,
  duplicate,
  renumber,
  templates
} = require('../state');

const sample = () => ([
  { id: 'a', seq: 1, type: 'navigate', url: 'https://example.com' },
  { id: 'b', seq: 2, type: 'click', selector: { text: 'Login' } },
  { id: 'c', seq: 3, type: 'input', selector: { name: 'email' }, value: 'a@b.c' }
]);

test.describe('hydrate', () => {
  test('adds an id to events that lack one', () => {
    const raw = [{ seq: 1, type: 'click' }, { seq: 2, type: 'input' }];
    const out = hydrate(raw);
    assert.ok(out[0].id);
    assert.ok(out[1].id);
    assert.notStrictEqual(out[0].id, out[1].id);
  });

  test('preserves existing ids', () => {
    const raw = [{ id: 'keep-me', seq: 1, type: 'click' }];
    const out = hydrate(raw);
    assert.strictEqual(out[0].id, 'keep-me');
  });

  test('defaults disabled to false when missing', () => {
    const out = hydrate([{ seq: 1, type: 'click' }]);
    assert.strictEqual(out[0].disabled, false);
  });

  test('returns empty array for null or non-array input', () => {
    assert.deepStrictEqual(hydrate(null), []);
    assert.deepStrictEqual(hydrate(undefined), []);
    assert.deepStrictEqual(hydrate('garbage'), []);
  });
});

test.describe('reorder', () => {
  test('moves an item before the target', () => {
    const out = reorder(sample(), 'c', 'a', 'before');
    assert.deepStrictEqual(out.map(e => e.id), ['c', 'a', 'b']);
  });

  test('moves an item after the target', () => {
    const out = reorder(sample(), 'a', 'b', 'after');
    assert.deepStrictEqual(out.map(e => e.id), ['b', 'a', 'c']);
  });

  test('is a no-op when fromId equals toId', () => {
    const before = sample();
    const after = reorder(before, 'b', 'b', 'before');
    assert.deepStrictEqual(after.map(e => e.id), before.map(e => e.id));
  });

  test('returns a new array (does not mutate input)', () => {
    const before = sample();
    const after = reorder(before, 'c', 'a', 'before');
    assert.notStrictEqual(before, after);
    assert.deepStrictEqual(before.map(e => e.id), ['a', 'b', 'c']);
  });

  test('returns the original array when fromId is unknown', () => {
    const before = sample();
    const after = reorder(before, 'unknown', 'a', 'before');
    assert.deepStrictEqual(after.map(e => e.id), before.map(e => e.id));
  });
});

test.describe('insert', () => {
  test('inserts a new event after the given id', () => {
    const out = insert(sample(), 'a', { id: 'x', type: 'wait', duration_ms: 500 });
    assert.deepStrictEqual(out.map(e => e.id), ['a', 'x', 'b', 'c']);
  });

  test('inserts at the end when afterId is null', () => {
    const out = insert(sample(), null, { id: 'x', type: 'memo', note: 'end' });
    assert.deepStrictEqual(out.map(e => e.id), ['a', 'b', 'c', 'x']);
  });

  test('inserts at the start when afterId is "" (empty)', () => {
    const out = insert(sample(), '', { id: 'x', type: 'memo' });
    assert.deepStrictEqual(out.map(e => e.id), ['x', 'a', 'b', 'c']);
  });
});

test.describe('remove', () => {
  test('removes an event by id', () => {
    const out = remove(sample(), 'b');
    assert.deepStrictEqual(out.map(e => e.id), ['a', 'c']);
  });

  test('no-op when id is unknown', () => {
    const before = sample();
    const after = remove(before, 'unknown');
    assert.deepStrictEqual(after.map(e => e.id), before.map(e => e.id));
  });
});

test.describe('update', () => {
  test('merges patch into the event with the given id', () => {
    const out = update(sample(), 'b', { url: 'https://new.com', disabled: true });
    const target = out.find(e => e.id === 'b');
    assert.strictEqual(target.url, 'https://new.com');
    assert.strictEqual(target.disabled, true);
    assert.deepStrictEqual(target.selector, { text: 'Login' });
  });

  test('does not mutate the original event object', () => {
    const before = sample();
    update(before, 'b', { url: 'x' });
    assert.strictEqual(before.find(e => e.id === 'b').url, undefined);
  });

  test('no-op when id is unknown', () => {
    const before = sample();
    const after = update(before, 'unknown', { url: 'x' });
    assert.deepStrictEqual(after.map(e => e.id), before.map(e => e.id));
  });
});

test.describe('duplicate', () => {
  test('inserts a copy with a new id immediately after the source', () => {
    const out = duplicate(sample(), 'b');
    assert.strictEqual(out.length, 4);
    assert.strictEqual(out[1].id, 'b');
    assert.notStrictEqual(out[2].id, 'b');
    assert.strictEqual(out[2].type, 'click');
    assert.deepStrictEqual(out[2].selector, { text: 'Login' });
  });

  test('no-op when id is unknown', () => {
    const before = sample();
    const after = duplicate(before, 'unknown');
    assert.deepStrictEqual(after.map(e => e.id), before.map(e => e.id));
  });
});

test.describe('renumber', () => {
  test('assigns sequential seq starting at 1', () => {
    const shuffled = [
      { id: 'c', seq: 99, type: 'input' },
      { id: 'a', seq: 5, type: 'navigate' },
      { id: 'b', seq: 12, type: 'click' }
    ];
    const out = renumber(shuffled);
    assert.deepStrictEqual(out.map(e => e.seq), [1, 2, 3]);
  });

  test('preserves order and other fields', () => {
    const out = renumber(sample());
    assert.deepStrictEqual(out.map(e => e.id), ['a', 'b', 'c']);
    assert.deepStrictEqual(out.map(e => e.type), ['navigate', 'click', 'input']);
  });
});

test.describe('templates', () => {
  test('exposes wait/memo/click defaults', () => {
    const t = templates();
    assert.strictEqual(t.wait.type, 'wait');
    assert.strictEqual(typeof t.wait.duration_ms, 'number');
    assert.strictEqual(t.memo.type, 'memo');
    assert.strictEqual(typeof t.memo.note, 'string');
    assert.strictEqual(t.click.type, 'click');
  });

  test('each template call returns a fresh object (no shared refs)', () => {
    const a = templates();
    const b = templates();
    assert.notStrictEqual(a.wait, b.wait);
    a.wait.duration_ms = 9999;
    assert.notStrictEqual(b.wait.duration_ms, 9999);
  });
});
