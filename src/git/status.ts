// Kept free of `vscode` imports so it can be unit-tested in plain Node.
// `Status` is a const enum: tsc inlines its values, so no runtime import remains.
import { Status } from './git';

export interface StatusDescription {
  readonly letter: string;
  readonly label: string;
  /** Theme color contributed by the built-in Git extension. */
  readonly colorId: string;
}

export function describeStatus(status: Status): StatusDescription {
  switch (status) {
    case Status.INDEX_MODIFIED:
      return { letter: 'M', label: 'Modified', colorId: 'gitDecoration.stageModifiedResourceForeground' };
    case Status.MODIFIED:
      return { letter: 'M', label: 'Modified', colorId: 'gitDecoration.modifiedResourceForeground' };
    case Status.INDEX_ADDED:
    case Status.INTENT_TO_ADD:
      return { letter: 'A', label: 'Added', colorId: 'gitDecoration.addedResourceForeground' };
    case Status.INDEX_DELETED:
      return { letter: 'D', label: 'Deleted', colorId: 'gitDecoration.stageDeletedResourceForeground' };
    case Status.DELETED:
      return { letter: 'D', label: 'Deleted', colorId: 'gitDecoration.deletedResourceForeground' };
    case Status.INDEX_RENAMED:
    case Status.INTENT_TO_RENAME:
      return { letter: 'R', label: 'Renamed', colorId: 'gitDecoration.renamedResourceForeground' };
    case Status.INDEX_COPIED:
      return { letter: 'C', label: 'Copied', colorId: 'gitDecoration.addedResourceForeground' };
    case Status.UNTRACKED:
      return { letter: 'U', label: 'Untracked', colorId: 'gitDecoration.untrackedResourceForeground' };
    case Status.TYPE_CHANGED:
      return { letter: 'T', label: 'Type changed', colorId: 'gitDecoration.modifiedResourceForeground' };
    default:
      return { letter: '!', label: 'Conflict', colorId: 'gitDecoration.conflictingResourceForeground' };
  }
}

/** The file has no previous version, so the left side of its diff is empty. */
export function isAddition(status: Status): boolean {
  return status === Status.INDEX_ADDED
    || status === Status.UNTRACKED
    || status === Status.INTENT_TO_ADD;
}

/** The file has no new version, so the right side of its diff is empty. */
export function isDeletion(status: Status): boolean {
  return status === Status.INDEX_DELETED || status === Status.DELETED;
}
