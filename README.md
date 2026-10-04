# dsh-selection-quote

[![CI](https://github.com/cfyofjackie/dsh-selection-quote/actions/workflows/ci.yml/badge.svg)](https://github.com/cfyofjackie/dsh-selection-quote/actions/workflows/ci.yml)

Select text in a DSH conversation and attach it to the composer as a **quote
reference** — an atomic chip, not pasted text. Nothing is sent.

English | [中文](README.zh.md)

![Selecting a passage in the transcript; a floating "add to chat" pill appears next to the selection](docs/demo.png)

## What it does

1. Select a non-empty passage in the transcript (an assistant reply, your own
   message, or a steering note).
2. A small pill appears next to the selection: **「添加到对话框」 / "Add to chat"**.
3. Clicking it places a **quote chip** in the composer, labelled with a short
   taste of the passage:

   ```text
   what you had already typed [引用：the passage…] 
   ```

4. The chip is a node in the editor, not a string:
   - one Backspace removes the whole thing;
   - it undoes in the same step as the typing around it;
   - copying the draft expands it to the quote text (`> …`), so it stays
     readable wherever it is pasted;
   - **at submit time** this plugin's reference codec turns it into the model
     text, rather than splicing text into the draft when you click.

   Which makes it the same kind of thing as `@file` / `@session` — DSH's own
   answer to "an object in the composer".

5. Focus returns to the composer so you can type your question and send it
   yourself.

**What it does not do**: it never sends, never writes storage, and never touches
the session log.

## How a quote becomes model text

This is the plugin's actual mechanism, and the difference from "paste the text
in":

| Projection | Owner | Value |
|---|---|---|
| Chip label on screen | `label` at insertion | `引用：the passage…` |
| Clipboard / persisted draft | `codec.clipboardText(ref)` | `> the passage` |
| **What the model receives** | `codec.serialize(ref, signal)` | `> the passage` |

- The source is registered with
  `ctx.inputTriggers.registerSource({ trigger: '@', name: 'quote', codec })`.
  `ReferenceInsert.source` on every inserted chip must equal that `name`, or the
  submit path cannot find the codec.
- DSH defines a missing codec as **a refused submission**, not a silent
  downgrade to the clipboard text. So `ref` is self-contained — the passage is
  base64url-encoded inside it — and resolution never depends on plugin memory.
  A restored draft, a hot reload, or a chip from another session can always be
  serialized.
- The insertion point is expressed in **detect coordinates**. The composer walks
  its document into two projections: `detectText`, where each chip is exactly
  one object-replacement character, and the clipboard projection the shell
  publishes as `InputState.draft`, where each chip is its full clipboard form.
  So "the end of the document" has to be folded back:

  ```js
  end = state.draft.length - Σ(occurrence.length - 1)
  ```

- The entry point is the one the service documents in its own error message:
  `ctx.sessions.scope(sessionId).conversation.input.for(actx).insertReference(ref, span)`.
- If the insertion is refused (a stale revision, a span the fold could not
  place) the plugin **falls back to plain-text quoting** rather than dropping
  the passage. Set `DIAGNOSTIC = true` in `src/client.tsx` to see which path was
  taken.

## Install

The plugin has a Host half and a browser half, and it is mounted by naming it in
a profile. There are three ways to do that. **Pick one** — listing the package as
a bundle *and* writing an explicit insert leaves two entries sharing an id, and
only one of them stays active.

| | needs a package manager | edits | verified |
|---|---|---|---|
| **1. As a package** | yes | none | yes |
| **2. From a clone, by absolute path** | no | four lines of YAML | yes |
| **3. As a package, inserted by name** | yes | four lines of YAML | yes |

### 1. As a package

```sh
dsh plugin --profile desktop add github:cfyofjackie/dsh-selection-quote
```

That is the whole install. The command forwards to pnpm inside the profile
directory, and because the package declares `dsh.bundle.patch` it also appends
the package name to `dsh.profile.bundles` — which is what actually mounts the
plugin. It does not say so in its output, so **check the bundle list rather than
adding the name yourself**: a duplicate entry mounts the same layer twice and
leaves two entries sharing one id, of which only one stays active.

A package listed as a bundle without declaring `dsh.bundle` fails the boot loudly
rather than silently doing nothing. Installing without being listed leaves the
package present but inert.

### 2. From a clone, by absolute path

No package manager involved. On macOS and Linux the desktop profile lives at
`~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: dsh-selection-quote
      name: "/absolute/path/to/dsh-selection-quote/lib/index.js"
```

> **A freshly created profile's patch file contains just `[]`.** Replace that
> line with the block above — do not append after it, because `[]` followed by a
> list item is a YAML parse error and the profile will fail to boot. If the file
> already holds entries, append normally.

On Windows the profile is `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`
and the path is a Windows path. Forward slashes work and avoid YAML escaping:

```yaml
- insert:
    - id: dsh-selection-quote
      name: "C:/path/to/dsh-selection-quote/lib/index.js"
```

### 3. As a package, inserted by name

Same `dsh plugin … add` as above, but mount it through the profile's patch file
instead of its bundle list. The Loader resolves a bare name from the profile's
own `node_modules`, which is where the package manager put it:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: dsh-selection-quote
      name: "dsh-selection-quote"
```

### After mounting

Profile patches reload live, but an already-loaded page keeps the boot graph it
was served — **reload once** (Cmd+R on macOS, Ctrl+R elsewhere, or restart DSH).

To remove it, undo whichever mount you chose and reload.

`lib/` is committed on purpose: the profile loads `lib/index.js` and
`lib/client.js` directly, so a checkout works without a build step.

### Trying it without touching your main profile

A profile is a self-contained plugin tree, so a throwaway one is the safe way to
evaluate this — and pointing a separate `DSH_HOME` at it keeps sessions and
storage out of the way too:

```sh
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
export DSH_HOME=/tmp/dsh-sandbox
"$CLI" --profile sandbox --from-default-profile web --dump-config   # create
"$CLI" plugin --profile sandbox add github:cfyofjackie/dsh-selection-quote
"$CLI" --profile sandbox --port 3917                                # boot
```

(Without a package manager, skip the second line and put install route 2's YAML
in `$DSH_HOME/profiles/sandbox/cordis.patch.yml` instead.)

To check the mount actually took before booting, `--dump-config` prints the
composed tree, and the `dsh web` page's boot graph carries one row per client
plugin with the content hash of its bundle.

Two things that surprise people about a fresh `DSH_HOME`:

- **it has no model credentials.** The UI loads and the plugin registers, but a
  conversation has nothing to answer with. Copy `~/.dsh/.credentials.yaml` into
  the sandbox home to lend it your key — or, if you would rather not, create the
  second profile inside your *real* `DSH_HOME` instead (`--profile sandbox
  --from-default-profile web` without the `export`); that shares credentials and
  sessions and differs only in its plugin tree.
- **the web auth token is not a setting.** It is minted per boot and carried in
  the URL `dsh web` prints. Opening the bare `127.0.0.1:<port>` answers 401; open
  the printed URL instead.

### UI language

The pill follows DSH's active locale. The plugin registers both `zh` and `en`
dictionaries (`ctx.locale.register`), matching the shipped convention that a
language's fallback chain terminates at English — so switching DSH's language to
English shows "Add to chat" with no plugin change.

## Development

```sh
npm install --no-save esbuild   # the only build tool; DSH's own runtime also works
npm run build                   # writes lib/index.js and lib/client.js
npm run watch                   # rebuild on change
npm test                        # build, then the headless suite (no browser needed)
```

The underlying commands are plain Node, so npm is a convenience rather than a
requirement: `node build.mjs`, `node build.mjs --watch`, `node --test`. Nothing
in the repository depends on a package being installed — `npm install` above is
only there to supply esbuild when the machine has no DSH runtime to borrow it
from. `build.mjs` looks for esbuild in the plugin folder,
`$DSH_HOME/profiles/node_modules`, the npm npx cache (POSIX and Windows), and the
DSH app runtime; `DSH_ESBUILD=/path/to/esbuild` overrides the search.

### Build output

| File | Role |
|---|---|
| `lib/index.js` | Host half. It must exist: the client module system only composes a browser bundle for packages that appear as Loader entries *and* declare `dsh.client`. The body is deliberately empty. |
| `lib/client.js` | Browser half: a CJS bundle wrapped in the `window.__ModuleLoader__.load({ id, factory })` registration envelope. |
| `cordis.patch.yml` | This package's own profile layer, named by `dsh.bundle.patch`. It is what makes "add the name to `dsh.profile.bundles`" a complete install. |

### Tests

`npm test` runs the **built bundle**, not the TypeScript source: it stubs the
browser globals and the platform-seed modules, renders components with a small
hook runtime that also implements React's error-boundary semantics, and replays
real event orderings (`pointerdown` capture before `click`). Regression tests
cover each failure this plugin has actually had.

## Notes from building this

Four failures shaped the current design; every one of them was invisible
without instrumentation, and each is generalizable to any DSH client plugin:

1. **A slot entry that throws once is silently abdicated.** The slot renderer
   wraps every entry in an error boundary and marks a crashed entry
   `abdicated`, after which it is skipped forever — no error UI, no log the user
   sees, and the plugin still reports `active` in the loader.
2. **Platform-seed module exports drift between shell builds.** The desktop app
   serves the `dsh-web-frontend` dist bundled inside `app.asar`, which is *not*
   the copy published in the profile's `node_modules`. In that build the icon
   set is named `Icon*OutlineRegular` / `Icon*OutlineMedium`, so
   `IconPlusOutline16` resolved to `undefined` and React raised error #130.
3. **A document-level capture `scroll` listener that measures the selection
   forces a layout per event.** During a drag-select with autoscroll that is
   dozens of forced layouts, and it made the pill take a second or two to
   appear.
4. **A transcript selection does not clear by itself.** Chromium only collapses
   an existing selection when the press lands on a selectable target, and the
   transcript's own chrome opts out of selection — so pressing next to a message
   left the blue highlight up with no way to remove it. The plugin now dismisses
   it on a primary press, while deliberately leaving shift-press (extend) and
   secondary press (context menu → Copy) alone.

The full writeup, with the code each conclusion came from, is in
[docs/gotchas.md](docs/gotchas.md).

## Known limitations

- **The quote lands at the end of the document**, not at the caret. The caret is
  not part of the public standard props (`ComposerKeyboard.caretSpan()` is
  package-internal), whereas the document end can be computed exactly.
- If insertion is refused the quote **falls back to plain text**: the passage is
  not lost, it just stops being a chip.
- One quote is capped at 20 000 characters; beyond that it is truncated with an
  explicit marker in the quote, never silently shortened.
- A quote is **not editable** — it is an atomic node; delete it and select
  again.
- The pill is disabled while the composer is `adjudicating` / `claimed` /
  `submitting`.
- Chat view only. The selection must sit inside `[data-chat-flow]`; the
  trajectory and waterfall views do not carry those anchors.
- A selection spanning several transcript nodes is judged by the node it starts
  in.
- A quote carries **no provenance** (which message it came from). The
  `INCLUDE_PROVENANCE` constant is the hook for adding it.

## Compatibility

Built and verified against DSH `0.1.5-rc.3` client packages on the macOS desktop
profile. It deliberately depends on nothing but React from the platform seed, so
it does not break when a shell build renames its own exports.

**Platform support.** Nothing in the plugin is OS-specific: the browser half is
React plus DOM APIs, and the build script uses only `node:fs`/`node:path`. The
parts that *could* differ are covered explicitly:

- the esbuild search walks POSIX **and** Windows locations
  (`%LOCALAPPDATA%\npm-cache\_npx`, the packaged runtime under `%PROGRAMFILES%`),
  and `DSH_ESBUILD` overrides it outright;
- `lib/` is committed, so a user never needs the build step at all — the only
  thing a Windows user does is point a patch at the path;
- line endings are pinned by `.gitattributes`, esbuild normalizes output to LF,
  and a test asserts the committed bundle contains no CRLF;
- the test that imports the Host half goes through `pathToFileURL`, because a
  dynamic `import()` of `C:\…` is rejected as an unsupported URL scheme;
- CI runs the build and the full test suite on **ubuntu, windows and macos**,
  and fails if the committed `lib/` no longer matches the source.

What is *not* verified is DSH's own Windows build: the desktop app's Electron
shell, and therefore which dist it serves, was only inspected on macOS. If
something misbehaves there, the plugin's `DIAGNOSTIC` switch will say which gate
refused the selection.

Not affiliated with DeepSeek.

## License

MIT — see [LICENSE](LICENSE).
