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
 * the one already present in the DSH runtime or in an npx cache.
 * @returns absolute path of the esbuild package directory.
 */
function findEsbuild() {
  const home = process.env.HOME ?? ''
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  const candidates = []
  if (process.env.DSH_ESBUILD !== undefined) candidates.push(process.env.DSH_ESBUILD)
  candidates.push(join(root, 'node_modules', 'esbuild'))
  candidates.push(join(dshHome, 'profiles', 'node_modules', 'esbuild'))
  const npx = join(home, '.npm', '_npx')
  if (existsSync(npx)) {
    for (const entry of readdirSync(npx)) {
      candidates.push(join(npx, entry, 'node_modules', 'esbuild'))
    }
  }
  candidates.push(
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/node_modules/esbuild',
  )
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  throw new Error(
    'build: no esbuild found. Set DSH_ESBUILD=/path/to/esbuild or run `npm i -D esbuild` here.',
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

/** Host half: plain ESM, bundled so the plugin folder stays dependency-free. */
const host = {
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(root, 'lib', 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'info',
  legalComments: 'none',
}

/** Browser half: CJS factory, platform seed external, automatic JSX runtime. */
const client = {
  entryPoints: [join(root, 'src', 'client.tsx')],
  outfile: join(root, 'lib', 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  external: SEED_EXTERNALS,
  logLevel: 'info',
  legalComments: 'none',
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
