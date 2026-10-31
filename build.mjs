import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
rmSync('dist', { recursive: true, force: true });
const compiler = 'node_modules/typescript/bin/tsc';
for (const [directory, module, resolution] of [
  ['esm', 'ES2022', 'Bundler'],
  ['cjs', 'CommonJS', 'Node'],
]) {
  execFileSync(
    process.execPath,
    [
      compiler,
      '--noEmit',
      'false',
      '--module',
      module,
      '--moduleResolution',
      resolution,
      '--outDir',
      `dist/${directory}`,
    ],
    { stdio: 'inherit' },
  );
}
mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
copyFileSync('src/styles.css', 'dist/styles.css');
