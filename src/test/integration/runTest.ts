import { execFileSync } from 'child_process';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

const TEST_REPO = '/tmp/difftool-review-test';

/**
 * Launches VS Code with the extension and runs the integration tests in it.
 * Set VSCODE_EXECUTABLE to use an installed VS Code instead of downloading one.
 */
async function main(): Promise<void> {
  const root = path.resolve(__dirname, '../../..');
  execFileSync(path.join(root, 'scripts/make-test-repo.sh'), { stdio: 'inherit' });
  // Set in VS Code's integrated terminal; it would start VS Code as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'index'),
    launchArgs: [TEST_REPO, '--disable-extensions'],
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Integration tests failed: ${String(error)}\n`);
  process.exitCode = 1;
});
