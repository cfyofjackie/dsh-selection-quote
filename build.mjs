/**
 * Build script for `dsh-selection-quote`.
 *
 * Produces the two halves the DSH Loader expects:
 *
 * - `lib/index.js` — the Host half, an ordinary ESM module. The Loader mounts
 *   it as an entry; it must exist for the package to appear in the tree at all.
 * - `lib/client.js` — the browser half, wrapped in the client module system's
 *   registration envelope. The Web shell serves this file and the bundle
 *   registers itself through `window.__ModuleLoader__.load`.
 *
 * The browser half must be CJS-shaped inside the envelope (the module system
 * answers factory-form `require`) and must keep the platform seed external:
 * React and the DSH client runtime are inlined into the shell, and bundling a
 * second copy of React would break hooks.
 *
 * Usage: `node build.mjs [--watch]`
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const watch = process.argv.includes('--watch')

/**
 * Browser platform seed, exactly as the Web shell builds it. These specifiers
 * resolve at runtime from the shell's static module table; a client bundle must
 * never inline them.
 */
const SEED_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * Locate an installed esbuild without requiring a local `node_modules`. The
 * plugin deliberately ships no dependencies: the only build tool it needs is
 * the one already present in the DSH runtime or in an npx/pnpm store. Every
 * candidate is optional, so the search is platform-neutral — a path that does
 * not exist on this OS simply loses.
 * @returns absolute path of the esbuild package directory.
 */
function findEsbuild() {
  const home = homedir()
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  const candidates = []
  if (process.env.DSH_ESBUILD !== undefined) candidates.push(process.env.DSH_ESBUILD)
  candidates.push(join(root, 'node_modules', 'esbuild'))
  candidates.push(join(dshHome, 'profiles', 'node_modules', 'esbuild'))
  // npm keeps its npx cache under ~/.npm on POSIX and under
  // %LOCALAPPDATA%\npm-cache on Windows.
  const npxRoots = [join(home, '.npm', '_npx')]
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData !== undefined) npxRoots.push(join(localAppData, 'npm-cache', '_npx'))
  for (const npx of npxRoots) {
    if (!existsSync(npx)) continue
    for (const entry of readdirSync(npx)) {
      candidates.push(join(npx, entry, 'node_modules', 'esbuild'))
    }
  }
  // Packaged DSH runtimes. The macOS bundle is the only layout known today; the
  // others are guesses a future release may satisfy, and cost nothing to try.
  const resources = [
    '/Applications/DeepSeek Harness.app/Contents/Resources',
    join(process.env.PROGRAMFILES ?? '', 'DeepSeek Harness', 'resources'),
    join(localAppData ?? '', 'Programs', 'DeepSeek Harness', 'resources'),
  ]
  for (const base of resources) {
    candidates.push(join(base, 'runtime', 'node_modules', 'esbuild'))
    candidates.push(
      join(base, 'app.asar.unpacked', 'dsh', 'node_modules', 'esbuild'),
    )
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  throw new Error(
    'build: no esbuild found. Set DSH_ESBUILD to an esbuild package directory, ' +
      'or run `npm install --no-save esbuild` in this folder.',
  )
}

const require = createRequire(import.meta.url)
const esbuild = require(findEsbuild())

/**
 * Wrap browser code in the client module system registration envelope.
 * @param id - graph row id, which is this package's name.
 * @param code - the CJS factory body.
 * @returns the registration script.
 */
function envelope(id, code) {
  return [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(id)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    code,
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
}

/** esbuild plugin that wraps the browser bundle once it has been written. */
const envelopePlugin = {
  name: 'dsh-client-envelope',
  setup(build) {
    build.onEnd(result => {
      if (result.errors.length > 0) return
      const outfile = build.initialOptions.outfile
      if (outfile === undefined) return
      writeFileSync(outfile, envelope(pkg.name, readFileSync(outfile, 'utf8')))
    })
  },
}

/**
 * Options every half shares.
 *
 * Line endings are not set here: `lineEnding` is a CLI-only flag, and esbuild
 * already normalizes output to LF regardless of the source's endings (verified:
 * a CRLF copy of `src/client.tsx` produces a bundle with zero CR bytes). That
 * matters because `lib/` is committed — `.gitattributes` pins the checkout and
 * the manifest test asserts the committed bundle carries no CRLF, so a Windows
 * clone cannot silently change the bytes the profile loads.
 */
const shared = {
  bundle: true,
  logLevel: 'info',
  legalComments: 'none',
}

/** Host half: plain ESM, bundled so the plugin folder stays dependency-free. */
const host = {
  ...shared,
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(root, 'lib', 'index.js'),
  format: 'esm',
  platform: 'node',
  target: 'node22',
}

/** Browser half: CJS factory, platform seed external, automatic JSX runtime. */
const client = {
  ...shared,
  entryPoints: [join(root, 'src', 'client.tsx')],
  outfile: join(root, 'lib', 'client.js'),
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  external: SEED_EXTERNALS,
  plugins: [envelopePlugin],
}

if (watch) {
  const contexts = await Promise.all([esbuild.context(host), esbuild.context(client)])
  await Promise.all(contexts.map(context => context.watch()))
  console.log('build: watching src/')
} else {
  await Promise.all([esbuild.build(host), esbuild.build(client)])
  const built = ['lib/index.js', 'lib/client.js'].map(
    file => `${file} (${String(readFileSync(join(root, file)).length)} B)`,
  )
  console.log(`build: wrote ${built.join(', ')}`)
}
