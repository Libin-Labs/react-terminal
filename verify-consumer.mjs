import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson(join(root, 'package.json'));
const scratch = join(root, '.consumer-check');
const app = join(scratch, 'app');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through the verify:consumer npm script.');
const npm = (args, cwd = root) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
assert.equal(manifest.dependencies, undefined);
assert.deepEqual(Object.keys(manifest.peerDependencies), ['react']);
assert.equal(manifest.version, '0.1.0');
assert.equal(manifest.license, 'MIT');
assert.equal(manifest.publishConfig.access, 'public');
assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
assert.equal(manifest.funding.url, 'https://www.paypal.me/LibinPrasanth');
assert.equal(manifest.author.name, 'Libin Prasanth');
assert.equal(manifest.author.url, 'https://www.linkedin.com/in/libinprasanth/');
assert.equal(manifest.name, '@lp-labs/react-terminal');
assert.equal(readFileSync(join(root, 'src', 'index.tsx'), 'utf8').match(/[^\x00-\x7f]/), null);
rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
mkdirSync(app, { recursive: true });
try {
  const [packed] = JSON.parse(
    npm(['pack', '--ignore-scripts', '--json', '--pack-destination', scratch]),
  );
  const react = readJson(join(root, 'node_modules', 'react', 'package.json')).version;
  const reactTypes = readJson(
    join(root, 'node_modules', '@types', 'react', 'package.json'),
  ).version;
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { [manifest.name]: `file:../${packed.filename}`, react },
      devDependencies: { '@types/react': reactTypes },
    }),
  );
  npm(
    ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    app,
  );
  const component = manifest.name
    .split('/')[1]
    .slice(6)
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  const source = `import * as api from "${manifest.name}";
import { createElement, type ComponentProps } from "react";
export type Props = ComponentProps<typeof api.${component}>;
declare const props: Props;
export const element = createElement(api.${component}, props);
export const allExports: typeof api = api;
`;
  writeFileSync(join(app, 'consumer.mts'), source);
  writeFileSync(join(app, 'consumer.cts'), source);
  writeFileSync(
    join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: [],
        lib: ['ES2022', 'DOM'],
        skipLibCheck: false,
      },
      include: ['consumer.mts', 'consumer.cts'],
    }),
  );
  execFileSync(
    process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', app],
    {
      cwd: app,
      stdio: 'inherit',
    },
  );
  writeFileSync(
    join(app, 'probe.mjs'),
    `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import * as esm from "${manifest.name}";
const require = createRequire(import.meta.url);
const cjs = require("${manifest.name}");
assert.equal(typeof window, "undefined");
assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
assert.equal(typeof esm.${component}, "function");
assert.ok(require.resolve("${manifest.name}").includes(".consumer-check"));
assert.ok(existsSync(require.resolve("${manifest.name}/styles.css")));
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
for (const name of Object.keys(esm)) {
  assert.ok(readme.includes(name), "Undocumented export: " + name);
  assert.equal(typeof esm[name], typeof cjs[name]);
}
`,
  );
  execFileSync(process.execPath, [join(app, 'probe.mjs')], { cwd: app, stdio: 'inherit' });
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log(
  `${manifest.name}: offline tarball install, ESM/CJS parity, CSS and strict NodeNext MTS/CTS passed.`,
);
