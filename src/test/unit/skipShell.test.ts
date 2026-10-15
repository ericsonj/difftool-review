import * as assert from 'assert';
import { missingSkipShellCommands, TERMINAL_COMMANDS } from '../../terminal/skipShell';

describe('missingSkipShellCommands', () => {
  it('returns every terminal command when none is listed', () => {
    assert.deepStrictEqual(missingSkipShellCommands([]), [...TERMINAL_COMMANDS]);
  });

  it('returns nothing when all are listed', () => {
    assert.deepStrictEqual(missingSkipShellCommands(['other.command', ...TERMINAL_COMMANDS]), []);
  });

  it('returns only the commands not listed yet', () => {
    const current = TERMINAL_COMMANDS.filter(command => command !== 'difftoolReview.focus');
    assert.deepStrictEqual(missingSkipShellCommands(current), ['difftoolReview.focus']);
  });

  it('respects commands the user excluded with a leading "-"', () => {
    const current = [...TERMINAL_COMMANDS.slice(1), `-${TERMINAL_COMMANDS[0]}`];
    assert.deepStrictEqual(missingSkipShellCommands(current), []);
  });
});
