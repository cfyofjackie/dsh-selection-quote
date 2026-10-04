# Notes from building a DSH client plugin

Three failures shaped this plugin. Each one produced **no visible error** — the
plugin reported `active` in the loader while doing nothing at all, or worked,
or worked slowly — and each one is generalizable to any DSH client plugin.

Everything below is quoted from the shipped bundles in the profile, so the
conclusions are traceable rather than inferred.

---

## 1. A slot entry that throws once is silently abdicated

### Symptom

The host loader reported the plugin as `active`. The feature did nothing. No
error surfaced anywhere in the UI.

### How it was found

The slots Inspect provider returns the live occupant list for one exact slot:

```json
{"id": "slash-menu",      "order": 0,  "active": true}
{"id": "command-popup",   "order": 1,  "active": true}
{"id": "feedback-dialog", "order": 2,  "active": true}
{"id": "selection-quote", "order": 30, "active": false}
```

The registration was there, and `active` was false. `active` has exactly one
source. In `dsh-client-ui-renderer`'s slot core:

```js
entriesOfSlot(slot) {
  // ...
  for (const entry of record.entries) {
    if (this.abdicated.has(entry)) continue;      // ← the only way to be inactive
    const key = kind === "keyed" ? entry.options.key
              : kind === "list"  ? entry.options.id
              : undefined;
    if (!seen.has(key)) { seen.add(key); survivors.push(entry); }
  }
  return survivors;
}
```

and `abdicated` is written in exactly one place:

```js
reportEntryError(slot, entry, error, { abdicate }) {
  if (abdicate) {
    if (this.abdicated.has(entry)) return;
    this.abdicated.add(entry);
    // ... mark dirty so the outlet re-renders onto the next survivor
  }
  // ... notify error listeners
}
```

which the per-entry boundary calls on **any** render error:

```js
var SlotErrorBoundary = class extends react.Component {
  static getDerivedStateFromError(error) {
    if (error instanceof SlotAssemblyError) throw error;   // assembly failures still crash loud
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error(`slot entry crashed in '${this.props.slotKey}':`, error);
    this.props.onEntryError(error);                        // → abdicated.add(entry)
  }
  render() {
    if (this.state.failed) return jsx("div", { "data-slot-error": this.props.slotKey });
    return this.props.children;
  }
};
```

### The consequence

**One throw during render and the entry is skipped forever.** The registration
survives, the loader says `active`, the DOM gets an empty
`<div data-slot-error>` that `display: contents` keeps invisible, and the user
sees a feature that simply does not work.

### The specific throw

Standard hooks such as `useInput` are bound through a selector hook that the
renderer invokes **during render**:

```js
function bindSnapshotSelector(source) {
  const subscribe = (fn) => source.subscribe(fn);
  const getSnapshot = () => source.getSnapshot();
  return function useSelector(sel, eq) {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, sel, eq);
  };
}
```

So a selector that dereferences an absent snapshot —

```js
const draft = useInput(state => state.draft)   // TypeError when state is undefined
```

— throws inside render and takes the entry with it. (The bundled
`use-sync-external-store` copy makes this worse in the shim path: its change
check is `try { return !is(inst.value, getSnapshot()) } catch { return true }`,
so a throwing selector reads as "changed forever". React 18 uses its own
`useSyncExternalStore` instead, where the same throw surfaces once, straight to
the boundary.)

### What to do

- Write every selector defensively: `state => state?.x ?? fallback`. It costs
  nothing.
- **Install your own error boundary inside the slot's.** The slot's boundary is
  outside yours and will abdicate; yours can report the failure on screen and
  keep the entry alive. This plugin's `SelectionQuoteGuard` does exactly that,
  and it is the reason the real cause was ever found.

---

## 2. Platform-seed module exports drift between shell builds

### Symptom

After the boundary was added, the on-screen report gave the real error:

```
dsh-selection-quote crashed
Error: Minified React error #130; ...
  at bi (dsh-app://app/assets/index-5SrrfWpU.js:56:49799)
```

React #130 is *"Element type is invalid: expected a string ... or a
class/function but got: undefined"*. The stack's asset name was the important
part — **that file is not the one being read while developing.**

### What is actually served

For the desktop app, `app.asar/lib/main.js` resolves the frontend like this:

```js
return serveWebDocument(
  request,
  join(resources.dsh, "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist"),
);
```

`resources.dsh` is `…/app.asar/dsh`, so the desktop app serves the dist **bundled
inside `app.asar`** — not the copy published in
`$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-web-frontend`. They are
different builds, and the two files tell the story:

| | desktop (actually running) | profile copy |
|---|---|---|
| asset | `index-5SrrfWpU.js` | `index-BKQ_L1z6.js` |
| icon naming | `IconArchiveOutlineRegular` / `…Medium` | `IconArchiveOutline16` / `…20` |
| `IconPlusOutline16` | **absent** | present |

The seed table itself is identical in both — the same nine words:

```js
function seed() {
  return {
    react, "react/jsx-runtime": …, "react-dom": …, "react-dom/client": …,
    "@deepseek-ai/cordis": …,
    "@deepseek-ai/dsh-client-store": …,
    "@deepseek-ai/dsh-client-ui-slots": …,
    "@deepseek-ai/dsh-client-ui-primitives": …,     // ← present, but renamed inside
    "@deepseek-ai/dsh-client-ui-dockkit": …,
  };
}
```

So `require("@deepseek-ai/dsh-client-ui-primitives")` resolved fine, and the
**named export** did not exist:

```js
import { IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
// → undefined
jsx(undefined, {})   // → React #130 → entry abdicated (see §1)
```

### What to do

- **Treat every platform-seed module except React as having an unstable
  surface.** `react`, `react-dom` and `react/jsx-runtime` are stable APIs; a
  component library shipped inside the shell is not.
- Draw what you need yourself. This plugin's 14px glyph is an inline SVG, and
  the bundle now requires nothing but React —
  `require("react")`, `require("react-dom")`, `require("react/jsx-runtime")`.
  There is a regression test asserting exactly that list.
- When a client plugin misbehaves, **read the asset name in the stack trace and
  make sure you are reading that file.** Developing against a different copy of
  the shell than the one running is a trap that costs hours.

---

## 3. A capture-phase scroll listener that measures forces a layout per event

### Symptom

After selecting a passage, the action pill took a second or two to appear.

### Cause

Two things compounded:

1. Probing was deferred through `requestAnimationFrame`, putting at least a
   frame — and, when the page was busy, whatever the frame queue was doing —
   between the end of the gesture and the pill.
2. The `scroll` listener was registered on `document` **in the capture phase**,
   and every event re-measured the whole selection with
   `range.getBoundingClientRect()`, which **forces layout**. One scroll event,
   one forced layout, across the entire document — and drag-selecting with
   autoscroll fires them continuously. None of that work could ever be visible:
   the pill is deliberately withdrawn while a drag is in progress.

### What to do

- **Measure synchronously in the event that reports the change.** A
  `selectionchange` reports an already-committed selection; there is nothing to
  wait for.
- **Add `mouseup` / `keyup` as a direct path to the end of a gesture**, so the
  pill does not depend on when the browser decides to fire `selectionchange`.
- **Let `scroll` / `resize` only reposition.** If no pill is showing, return
  immediately; during a drag the hit is already `null`, so an entire drag costs
  zero measurements.
- **Deduplicate the result.** If the measured text and box are unchanged, do not
  write state at all.

---

## 4. A transcript selection never clears on its own

### Symptom

After selecting a passage, pressing anywhere else in the transcript left the blue
highlight in place — permanently. The floating pill stayed with it, so the whole
feature looked like a stuck overlay.

### Cause

Chromium collapses an existing selection on mousedown **only when the press lands
on a target that allows selection**. The transcript's own chrome — the padding
around a message, its row wrapper, the hover action strip — opts out, so a press
there leaves the selection exactly as it was. Nothing in the plugin held it; the
browser simply had no instruction to drop it.

This is the one failure in this document that is not the plugin's fault, and it
still has to be the plugin's problem: the plugin is what makes people select
transcript text at all, so it is where the annoyance surfaces.

### What to do

Dismiss the selection on a primary press that lands outside your own surface,
with the two guards that keep native gestures working:

```js
if (event.button !== 0 || event.shiftKey) return;   // extend / context menu
if (selectionInTranscript()) window.getSelection()?.removeAllRanges();
```

- `button !== 0` keeps the secondary press, which is how the context menu offers
  **Copy** — clearing there would destroy the thing being copied.
- `shiftKey` keeps shift-click, which *extends* a selection; clearing first would
  destroy exactly what the user is extending.
- `selectionInTranscript()` is a cheap walk (`closest('[data-chat-flow]')`), not
  a measurement — this runs on every press and must not force layout (see §3).

---

## Checklist for a new DSH client plugin

1. **Mount in the right scope.** Session-scoped standard props (`inputActions`,
   `useInput`) only reach Session-scoped slots. A root-scoped seat can draw a
   button but cannot act on the composer.
2. **Write defensive selectors** — `state => state?.x ?? fallback`.
3. **Ship your own error boundary**, inside the slot renderer's. Otherwise the
   first throw is a silent, permanent abdication.
4. **Require nothing but React** from the platform seed; inline everything else.
5. **Never bind high-frequency document listeners that measure.** Coalesce, and
   only measure when something is on screen.
6. **Check `active` on the slot occupant list** when a feature "does nothing" —
   it distinguishes "never registered" from "registered and abdicated".
7. **Set the profile's `DIAGNOSTIC`-style switch before guessing.** Every
   failure above was found by making the plugin report its own state on screen.
