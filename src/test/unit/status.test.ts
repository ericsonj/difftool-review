import * as assert from 'assert';
import { Status } from '../../git/git';
import { describeStatus, isAddition, isDeletion } from '../../git/status';

describe('describeStatus', () => {
  it('maps git statuses to the letters of the plan', () => {
    const letters: [Status, string][] = [
      [Status.INDEX_MODIFIED, 'M'],
      [Status.MODIFIED, 'M'],
      [Status.INDEX_ADDED, 'A'],
      [Status.INTENT_TO_ADD, 'A'],
      [Status.INDEX_DELETED, 'D'],
      [Status.DELETED, 'D'],
      [Status.INDEX_RENAMED, 'R'],
      [Status.INTENT_TO_RENAME, 'R'],
      [Status.UNTRACKED, 'U'],
      [Status.TYPE_CHANGED, 'T'],
    ];
    for (const [status, letter] of letters) {
      assert.strictEqual(describeStatus(status).letter, letter, `status ${status}`);
    }
  });

  it('uses the staged colors for index changes', () => {
    assert.strictEqual(
      describeStatus(Status.INDEX_MODIFIED).colorId,
      'gitDecoration.stageModifiedResourceForeground',
    );
    assert.strictEqual(describeStatus(Status.MODIFIED).colorId, 'gitDecoration.modifiedResourceForeground');
  });
});

describe('isAddition / isDeletion', () => {
  it('treats added, untracked and intent-to-add files as additions', () => {
    assert.ok(isAddition(Status.INDEX_ADDED));
    assert.ok(isAddition(Status.UNTRACKED));
    assert.ok(isAddition(Status.INTENT_TO_ADD));
    assert.ok(!isAddition(Status.MODIFIED));
  });

  it('treats staged and unstaged deletions as deletions', () => {
    assert.ok(isDeletion(Status.INDEX_DELETED));
    assert.ok(isDeletion(Status.DELETED));
    assert.ok(!isDeletion(Status.INDEX_RENAMED));
  });
});
