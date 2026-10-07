import * as fs from 'fs';
import * as path from 'path';

/** Entry point called by VS Code inside the Extension Development Host. */
export async function run(): Promise<void> {
  // Mocha 12 is ESM-only, so it has to be loaded with a dynamic import.
  const { default: Mocha } = await import('mocha');
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 30_000 });
  fs.readdirSync(__dirname)
    .filter(file => file.endsWith('.test.js'))
    .forEach(file => mocha.addFile(path.join(__dirname, file)));
  await mocha.loadFilesAsync();
  await new Promise<void>((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}
