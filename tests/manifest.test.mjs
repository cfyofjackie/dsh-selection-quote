/**
 * Packaging contract tests.
 *
 * The Loader and the client module system each impose a shape on this package.
 * These tests mirror the two gates that fail loudest in a real profile:
 * `dsh-client-modules`'s manifest scan and the bundle purity gate (a browser
 * bundle may only require platform-seed words and its own files).
 *
 * Run: `node --test tests/`
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** The Web shell's static module table, from `dsh-web-frontend`'s boot bundle. */
const PLATFORM_SEED = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

test('the manifest declares a web client half with a resolvable bundle', () => {
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  const clientRel = pkg.exports?.['./client']
  assert.equal(typeof clientRel, 'string', 'exports["./client"] must be a string')
  assert.ok(existsSync(join(root, clientRel)), `${clientRel} must exist`)
  assert.ok(existsSync(join(root, pkg.main)), `${pkg.main} must exist`)
  for (const entry of pkg.dsh.client.inject ?? []) {
    assert.equal(typeof entry, 'string')
  }
})

test('the package declares itself a profile bundle, so a package install mounts', () => {
  // `dsh plugin --profile <name> add <spec>` installs the package and then warns
  // "declares no dsh.bundle — installed as a plain dependency, not a profile
  // layer". Declaring it is what lets a user mount the plugin by adding one name
  // to dsh.profile.bundles instead of hand-writing a patch entry.
  const patchRel = pkg.dsh?.bundle?.patch
  assert.equal(typeof patchRel, 'string', 'dsh.bundle.patch must be declared')
  assert.equal(
    pkg.exports?.['./cordis.patch.yml'],
    './cordis.patch.yml',
    'the patch must be exported so the manifest is addressable',
  )
  assert.ok(pkg.files?.includes('cordis.patch.yml'), 'the patch must ship with the package')

  const patchPath = join(root, patchRel)
  assert.ok(existsSync(patchPath), `${patchRel} must exist`)
  const patch = readFileSync(patchPath, 'utf8')
  assert.match(patch, /^- insert:$/mu)
  assert.match(patch, /id: dsh-selection-quote/u)
  // Naming the package (rather than a path) is what makes the layer work from
  // wherever the package manager put it.
  assert.match(
    patch,
    /name: "dsh-selection-quote"/u,
    'the bundle patch must insert the package by name',
  )
})

test('the host half exports a mountable plugin', async () => {
  // `pathToFileURL`, not the bare path: on Windows a dynamic import of
  // `C:\...` is rejected as an unsupported URL scheme.
  const mod = await import(pathToFileURL(join(root, pkg.main)).href)
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject))
})

test('the browser bundle uses the registration envelope and only seed externals', () => {
  const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.match(bundle, /^window\.__ModuleLoader__\.load\(\{/)
  assert.match(bundle, new RegExp(`id: ${JSON.stringify(pkg.name)},`))
  assert.match(bundle, /factory: \(require\) => \{/)
  // LF-only: the build pins `lineEnding: 'lf'` and .gitattributes pins the
  // checkout, so a Windows clone cannot silently change these bytes.
  assert.match(bundle, /\n\t\treturn module\.exports;\n\t\}\n\}\);\n$/)
  assert.ok(!bundle.includes('\r\n'), 'the committed bundle must use LF line endings')

  const required = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
  assert.ok(required.length > 0, 'the bundle must require its seed modules')
  for (const specifier of new Set(required)) {
    assert.ok(
      PLATFORM_SEED.has(specifier),
      `client bundle requires "${specifier}", which is not a platform-seed word`,
    )
  }
})
