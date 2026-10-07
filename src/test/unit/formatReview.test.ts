import * as assert from 'assert';
import { formatReview, ReviewEntry } from '../../comments/formatReview';

function entry(overrides: Partial<ReviewEntry>): ReviewEntry {
  return {
    path: 'src/a.ts',
    startLine: 1,
    endLine: 1,
    staged: false,
    languageId: 'typescript',
    code: 'const a = 1;',
    body: 'Rename this.',
    ...overrides,
  };
}

describe('formatReview', () => {
  it('formats the example from the plan', () => {
    const markdown = formatReview('Please address the following review comments on your changes:', [
      entry({
        path: 'src/utils/date.ts',
        startLine: 12,
        endLine: 12,
        staged: true,
        code: 'const d = new Date(input);',
        body: 'Use the existing parseDate() helper instead.',
      }),
      entry({
        path: 'src/api/users.ts',
        startLine: 42,
        endLine: 45,
        code: 'try {\n  await db.save(user);\n} catch (e) {}',
        body: "Don't swallow this exception, log it and rethrow.",
      }),
    ]);

    assert.strictEqual(markdown, [
      'Please address the following review comments on your changes:',
      '',
      '### src/api/users.ts, lines 42–45',
      '```typescript',
      'try {',
      '  await db.save(user);',
      '} catch (e) {}',
      '```',
      "Don't swallow this exception, log it and rethrow.",
      '',
      '### src/utils/date.ts, line 12 (staged version)',
      '```typescript',
      'const d = new Date(input);',
      '```',
      'Use the existing parseDate() helper instead.',
      '',
    ].join('\n'));
  });

  it('sorts by path, then by start line', () => {
    const markdown = formatReview('', [
      entry({ path: 'b.ts', startLine: 1, endLine: 1 }),
      entry({ path: 'a.ts', startLine: 9, endLine: 9 }),
      entry({ path: 'a.ts', startLine: 2, endLine: 2 }),
    ]);
    const headings = markdown.split('\n').filter(line => line.startsWith('###'));
    assert.deepStrictEqual(headings, ['### a.ts, line 2', '### a.ts, line 9', '### b.ts, line 1']);
  });

  it('uses a longer fence when the code contains backticks', () => {
    const markdown = formatReview('', [entry({ code: 'const s = ```;', languageId: 'markdown' })]);
    assert.ok(markdown.includes('````markdown\nconst s = ```;\n````'));
  });

  it('omits the code block when there is no snippet', () => {
    const markdown = formatReview('', [entry({ code: '' })]);
    assert.strictEqual(markdown, '### src/a.ts, line 1\nRename this.\n');
  });

  it('leaves the fence language empty for plain text', () => {
    const markdown = formatReview('', [entry({ languageId: 'plaintext' })]);
    assert.ok(markdown.includes('```\nconst a = 1;\n```'));
  });
});
