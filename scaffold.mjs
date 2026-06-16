// One-shot monorepo scaffolder for bibdesk-electron (B1 bootstrap).
// Generates root config + workspace package stubs. Idempotent-ish: overwrites
// config files but will NOT clobber a src/index.ts that already has real code
// (guarded by a marker comment) so re-runs during the build are safe.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();
const STUB_MARKER = '// @bibdesk-stub';

function w(rel, content, { stubGuard = false } = {}) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  if (stubGuard && existsSync(p)) {
    const cur = readFileSync(p, 'utf8');
    if (!cur.includes(STUB_MARKER)) {
      console.log(`  skip (real code present): ${rel}`);
      return;
    }
  }
  writeFileSync(p, content);
  console.log(`  wrote ${rel}`);
}

const j = (o) => JSON.stringify(o, null, 2) + '\n';

// ---------------------------------------------------------------------------
// Package definitions
// ---------------------------------------------------------------------------
// Each core package exports its TS source directly (internal-package pattern):
// no build step for libs; Vitest (esbuild) and Vite bundle the .ts. tsc is used
// only for typecheck (`build` script -> tsc --noEmit).
const corePkgs = [
  {
    dir: 'core/tex',
    name: '@bibdesk/tex',
    desc: 'TeXify/deTeXify codec: CharacterConversion table + accent algorithm (NFC/NFD). Platform-agnostic.',
    deps: {},
    devDeps: {},
  },
  {
    dir: 'core/names',
    name: '@bibdesk/names',
    desc: 'BibTeX name splitting (Patashnik first/von/last/jr) + display variants. Platform-agnostic.',
    deps: { '@bibdesk/tex': 'workspace:*' },
    devDeps: {},
  },
  {
    dir: 'core/config',
    name: '@bibdesk/config',
    desc: 'Ported BibDesk type/field config (TypeInfo.plist + Preferences field-type arrays) as JSON + typed accessors.',
    deps: {},
    devDeps: {},
  },
  {
    dir: 'core/model',
    name: '@bibdesk/model',
    desc: 'BibItem/BibAuthor/ComplexValue, TypeManager, MacroResolver, crossref inheritance, change events. Platform-agnostic.',
    deps: {
      '@bibdesk/tex': 'workspace:*',
      '@bibdesk/names': 'workspace:*',
      '@bibdesk/config': 'workspace:*',
    },
    devDeps: {},
  },
  {
    dir: 'core/bibtex',
    name: '@bibdesk/bibtex',
    desc: 'Custom byte-faithful BibTeX round-trip parser + serializer incl. BibDesk @comment/bdsk-* extensions.',
    deps: {
      '@bibdesk/tex': 'workspace:*',
      '@bibdesk/model': 'workspace:*',
      '@bibdesk/config': 'workspace:*',
      'bplist-parser': '^0.3.2',
      'bplist-creator': '^0.1.1',
    },
    devDeps: {},
  },
  {
    dir: 'core/formats',
    name: '@bibdesk/formats',
    desc: 'BDSKFormatParser cite-key + autofile mini-language, CRC32, sanitizers. Platform-agnostic.',
    deps: { '@bibdesk/model': 'workspace:*', '@bibdesk/names': 'workspace:*' },
    devDeps: {},
  },
  {
    dir: 'core/groups',
    name: '@bibdesk/groups',
    desc: 'Group taxonomy + BDSKFilter/BDSKCondition predicate evaluator. Platform-agnostic.',
    deps: { '@bibdesk/model': 'workspace:*' },
    devDeps: {},
  },
];

const sharedPkg = {
  dir: 'shared',
  name: '@bibdesk/shared',
  desc: 'IPC contracts + shared TS types between Electron main and renderer.',
  deps: {},
  devDeps: {},
};

const pluginsPkg = {
  dir: 'plugins-sdk',
  name: '@bibdesk/plugins-sdk',
  desc: 'JS plugin API surface (stub this session; designed for cross-platform native hooks).',
  deps: {},
  devDeps: {},
};

const libPkgs = [...corePkgs, sharedPkg, pluginsPkg];

// ---------------------------------------------------------------------------
// Per-package files
// ---------------------------------------------------------------------------
function pkgIndexStub(name, desc) {
  const slug = name.replace('@bibdesk/', '');
  return `${STUB_MARKER} — replace with real implementation.
/**
 * ${name}
 * ${desc}
 */
export const __package = '${slug}';
`;
}

for (const p of libPkgs) {
  w(`${p.dir}/package.json`, j({
    name: p.name,
    version: '0.0.0',
    private: true,
    type: 'module',
    description: p.desc,
    exports: { '.': './src/index.ts' },
    main: './src/index.ts',
    types: './src/index.ts',
    scripts: {
      build: 'tsc --noEmit',
      test: 'vitest run --passWithNoTests',
      'test:watch': 'vitest',
    },
    dependencies: p.deps,
    devDependencies: p.devDeps,
  }));
  const upDepth = p.dir.split('/').length; // 'core/tex' -> 2, 'shared' -> 1
  const baseRel = '../'.repeat(upDepth) + 'tsconfig.base.json';
  w(`${p.dir}/tsconfig.json`, j({
    extends: baseRel,
    compilerOptions: { rootDir: '.' },
    include: ['src/**/*.ts', 'test/**/*.ts'],
  }));
  w(`${p.dir}/vitest.config.ts`, `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
`);
  w(`${p.dir}/src/index.ts`, pkgIndexStub(p.name, p.desc), { stubGuard: true });
}

// core/bibtex: explicit stub API contract shared by T1 (golden harness) and C4.
w('core/bibtex/src/index.ts', `${STUB_MARKER} — parse/serialize implemented in Wave 3 (C4).
/**
 * @bibdesk/bibtex — custom byte-faithful BibTeX round-trip parser + serializer.
 *
 * PUBLIC CONTRACT (stable; T1's golden round-trip harness depends on these names):
 *   parse(text)      -> BibLibrary
 *   serialize(lib)   -> string
 * Round-trip property: serialize(parse(text)) === text  (modulo the documented
 * normalizations in subsystem-12 §2). C4 owns the full shape of BibLibrary;
 * it MUST keep these two entry points and the round-trip contract.
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(\`\${what} is implemented in Wave 3 (C4 — core/bibtex)\`);
    this.name = 'NotImplementedError';
  }
}

export interface ParseOptions {
  /** Source encoding hint; defaults to utf-8. */
  encoding?: string;
}
export interface SerializeOptions {
  /** Override the line ending; defaults to the document's detected ending. */
  newline?: string;
}

/** Opaque-ish parsed library; full structure defined by C4. */
export interface BibLibrary {
  entries: unknown[];
  [k: string]: unknown;
}

export function parse(_text: string, _opts?: ParseOptions): BibLibrary {
  throw new NotImplementedError('parse');
}

export function serialize(_lib: BibLibrary, _opts?: SerializeOptions): string {
  throw new NotImplementedError('serialize');
}
`, { stubGuard: true });

// ---------------------------------------------------------------------------
// app (electron-vite): main + preload + renderer. A2/A3 fill these in.
// ---------------------------------------------------------------------------
w('app/package.json', j({
  name: '@bibdesk/app',
  version: '0.0.0',
  private: true,
  type: 'module',
  description: 'Electron shell: main process, preload, and React renderer (read-only viewer this session).',
  main: 'out/main/index.js',
  scripts: {
    dev: 'electron-vite dev',
    'build:app': 'electron-vite build',
    start: 'electron-vite preview',
    build: 'tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json',
    test: 'vitest run --passWithNoTests',
  },
  dependencies: {
    '@bibdesk/bibtex': 'workspace:*',
    '@bibdesk/model': 'workspace:*',
    '@bibdesk/groups': 'workspace:*',
    '@bibdesk/names': 'workspace:*',
    '@bibdesk/tex': 'workspace:*',
    '@bibdesk/formats': 'workspace:*',
    '@bibdesk/shared': 'workspace:*',
    react: '^18.3.1',
    'react-dom': '^18.3.1',
    zustand: '^5.0.2',
    '@tanstack/react-table': '^8.20.5',
    '@tanstack/react-virtual': '^3.10.9',
  },
  devDependencies: {
    electron: '^33.2.1',
    'electron-vite': '^2.3.0',
    vite: '^5.4.11',
    '@vitejs/plugin-react': '^4.3.4',
    '@types/react': '^18.3.12',
    '@types/react-dom': '^18.3.1',
  },
}));

w('app/electron.vite.config.ts', `import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    plugins: [react()],
  },
});
`);

// Editor-convenience config (union of libs); precise per-target checks run via
// the two -p invocations in the `build` script.
w('app/tsconfig.json', j({
  extends: '../tsconfig.base.json',
  compilerOptions: {
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
    types: ['node'],
  },
  include: ['src/**/*.ts', 'src/**/*.tsx', 'electron.vite.config.ts'],
}));
w('app/tsconfig.node.json', j({
  extends: '../tsconfig.base.json',
  compilerOptions: {
    lib: ['ES2022'],
    types: ['node'],
  },
  include: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'electron.vite.config.ts'],
}));
w('app/tsconfig.web.json', j({
  extends: '../tsconfig.base.json',
  compilerOptions: {
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
    types: [],
  },
  include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
}));

// Minimal app stubs so install/typecheck don't fail before Wave 4.
w('app/src/main/index.ts', `${STUB_MARKER} — Electron main; implemented in Wave 4 (A2).
export {};
`, { stubGuard: true });
w('app/src/preload/index.ts', `${STUB_MARKER} — preload bridge; implemented in Wave 4 (A2/A1).
export {};
`, { stubGuard: true });
w('app/src/renderer/index.html', `<!doctype html>
<!-- ${STUB_MARKER}: renderer entry; implemented in Wave 4 (A3). -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BibDesk</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`, { stubGuard: true });
w('app/src/renderer/src/main.tsx', `${STUB_MARKER} — React entry; implemented in Wave 4 (A3).
export {};
`, { stubGuard: true });

// ---------------------------------------------------------------------------
// Root files
// ---------------------------------------------------------------------------
w('pnpm-workspace.yaml', `packages:
  - 'core/*'
  - 'shared'
  - 'plugins-sdk'
  - 'app'
`);

w('package.json', j({
  name: 'bibdesk-electron',
  version: '0.0.0',
  private: true,
  type: 'module',
  description: 'Cross-platform Electron rewrite of BibDesk (placeholder name; user renames later).',
  packageManager: 'pnpm@11.2.2',
  engines: { node: '>=20' },
  scripts: {
    build: 'pnpm -r build',
    test: 'vitest run',
    'test:pkgs': 'pnpm -r test',
    lint: 'eslint .',
    format: 'prettier --write .',
    'format:check': 'prettier --check .',
    dev: 'pnpm --filter @bibdesk/app dev',
  },
  devDependencies: {
    typescript: '^5.7.2',
    vitest: '^2.1.8',
    eslint: '^9.16.0',
    'typescript-eslint': '^8.18.0',
    'eslint-config-prettier': '^9.1.0',
    prettier: '^3.4.2',
    '@types/node': '^22.10.2',
  },
}));

w('tsconfig.base.json', j({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    lib: ['ES2022'],
    types: [],
    strict: true,
    noUncheckedIndexedAccess: true,
    noImplicitOverride: true,
    exactOptionalPropertyTypes: false,
    verbatimModuleSyntax: false,
    isolatedModules: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    declaration: false,
    noEmit: true,
    sourceMap: true,
  },
}));

// Root editor config. Actual typechecking is per-package via `pnpm -r build`
// (each package runs `tsc --noEmit`); cross-package imports resolve through the
// workspace `exports` fields under Bundler module resolution.
w('tsconfig.json', j({
  extends: './tsconfig.base.json',
  compilerOptions: { types: ['node'] },
  include: ['core/*/src/**/*.ts', 'shared/src/**/*.ts', 'plugins-sdk/src/**/*.ts'],
}));

w('eslint.config.js', `import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/*.config.*', 'scaffold.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
`);

w('.prettierrc.json', j({
  singleQuote: true,
  semi: true,
  printWidth: 100,
  trailingComma: 'all',
}));

w('.prettierignore', `node_modules
dist
out
pnpm-lock.yaml
**/test/fixtures/**
`);

w('vitest.config.ts', `import { defineConfig } from 'vitest/config';

// Root config: run \`pnpm test\` to execute every package's tests at once.
export default defineConfig({
  test: {
    include: ['{core,shared,plugins-sdk,app}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**'],
    passWithNoTests: true,
  },
});
`);

w('.gitignore', `node_modules/
dist/
out/
*.log
.DS_Store
coverage/
.vitest/
*.tsbuildinfo
.eslintcache
`);

w('.npmrc', `auto-install-peers=true
strict-peer-dependencies=false
`);

w('electron-builder.yml', `# Packaging config only — no packaging run this session.
appId: org.placeholder.bibdesk-electron
productName: BibDesk
directories:
  output: release
  buildResources: build
files:
  - 'app/out/**/*'
mac:
  target: [dmg, zip]
  category: public.app-category.productivity
win:
  target: [nsis]
linux:
  target: [AppImage, deb]
  category: Office
`);

w('README.md', `# bibdesk-electron

Cross-platform Electron rewrite of [BibDesk](https://bibdesk.sourceforge.io/).
Working title — the user renames later.

**Status:** foundations build in progress. See \`BUILD-LOG.md\` for the running log,
and \`/Users/jalex/Source/BibDesk/port-analysis/\` for the analysis + plan that drives it.

## Layout

\`\`\`
core/tex      TeXify/deTeXify codec
core/names    BibTeX name splitting + display variants
core/config   ported BibDesk type/field configuration (JSON)
core/model    BibItem / ComplexValue / TypeManager / MacroResolver / crossref
core/bibtex   custom byte-faithful round-trip parser + serializer (the keystone)
core/formats  cite-key / autofile format mini-language, CRC32, sanitizers
core/groups   group taxonomy + smart-group predicate evaluator
shared        IPC contracts + shared types
plugins-sdk   JS plugin API surface (stub)
app           Electron shell (main + preload + React renderer)
\`\`\`

\`core/*\` is platform-agnostic (no Electron/DOM; \`fs\` only behind an injected
interface) and runs headless under Vitest.

## Develop

\`\`\`bash
pnpm install
pnpm test        # all unit tests
pnpm build       # typecheck every package
pnpm dev         # launch the Electron viewer (Wave 4+)
\`\`\`
`);

console.log('\\nScaffold complete.');
