# dsh-selection-quote

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

The plugin has a Host half and a browser half. It is mounted through a profile's
patch file — for the desktop profile:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: dsh-selection-quote
      name: "/absolute/path/to/dsh-selection-quote/lib/index.js"
```

Profile patches reload live, but an already-loaded page keeps the boot graph it
was served — **reload once** (Cmd+R on desktop, or restart DSH) after mounting.

To remove it, delete those lines and reload.

`lib/` is committed on purpose: the profile loads `lib/index.js` and
`lib/client.js` directly, so a checkout works without a build step.

## Development

```sh
node build.mjs          # writes lib/index.js and lib/client.js
node build.mjs --watch  # rebuild on change
node --test tests/      # headless smoke tests, no browser needed
```

The only build tool is esbuild; `build.mjs` looks for it in the plugin folder,
`$DSH_HOME/profiles/node_modules`, `~/.npm/_npx/*`, and the DSH app runtime.
`DSH_ESBUILD=/path/to/esbuild` overrides the search.

### Build output

| File | Role |
|---|---|
| `lib/index.js` | Host half. It must exist: the client module system only composes a browser bundle for packages that appear as Loader entries *and* declare `dsh.client`. The body is deliberately empty. |
| `lib/client.js` | Browser half: a CJS bundle wrapped in the `window.__ModuleLoader__.load({ id, factory })` registration envelope. |

### Tests

`node --test tests/` runs the **built bundle**, not the TypeScript source: it
stubs the browser globals and the platform-seed modules, renders components with
a small hook runtime that also implements React's error-boundary semantics, and
replays real event orderings (`pointerdown` capture before `click`). Regression
tests cover each failure this plugin has actually had.

## Notes from building this

Three failures shaped the current design; all three were invisible without
instrumentation, and each is generalizable to any DSH client plugin:

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

Built and verified against DSH `0.1.5-rc.3` client packages on the desktop
profile. It deliberately depends on nothing but React from the platform seed, so
it does not break when a shell build renames its own exports.

Not affiliated with DeepSeek.

## License

MIT — see [LICENSE](LICENSE).
