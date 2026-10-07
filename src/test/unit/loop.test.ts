import * as assert from 'assert';
import { pickIndex } from '../../navigation/loop';

const KEYS = ['a', 'b', 'c'];

describe('pickIndex', () => {
  it('returns -1 for an empty group', () => {
    assert.strictEqual(pickIndex([], undefined, 0, 1), -1);
    assert.strictEqual(pickIndex([], 'a', 2, -1), -1);
  });

  it('starts at the first file going forward and the last going back', () => {
    assert.strictEqual(pickIndex(KEYS, undefined, 0, 1), 0);
    assert.strictEqual(pickIndex(KEYS, undefined, 0, -1), 2);
  });

  it('moves to the neighbour of the current file', () => {
    assert.strictEqual(pickIndex(KEYS, 'a', 0, 1), 1);
    assert.strictEqual(pickIndex(KEYS, 'c', 2, -1), 1);
  });

  it('loops at both ends of the group', () => {
    assert.strictEqual(pickIndex(KEYS, 'c', 2, 1), 0);
    assert.strictEqual(pickIndex(KEYS, 'a', 0, -1), 2);
  });

  it('continues from the old position when the current file left the group', () => {
    // 'b' (index 1) was staged; 'c' moved into its position.
    const remaining = ['a', 'c'];
    assert.strictEqual(pickIndex(remaining, 'b', 1, 1), 1);
    assert.strictEqual(pickIndex(remaining, 'b', 1, -1), 0);
  });

  it('loops when the removed file was the last one', () => {
    const remaining = ['a', 'b'];
    assert.strictEqual(pickIndex(remaining, 'c', 2, 1), 0);
    assert.strictEqual(pickIndex(remaining, 'c', 2, -1), 1);
  });

  it('handles a single file', () => {
    assert.strictEqual(pickIndex(['a'], 'a', 0, 1), 0);
    assert.strictEqual(pickIndex(['a'], 'a', 0, -1), 0);
  });
});
