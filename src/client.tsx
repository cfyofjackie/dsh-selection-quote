/**
 * Client half of `dsh-selection-quote`.
 *
 * Behaviour: selecting text inside a conversation node floats a small
 * "add to chat" pill next to the selection. Clicking it inserts a **quote
 * reference** into the composer — an atomic chip that carries the passage, not
 * pasted text. The chip and its neighbours are one undo step, one Backspace
 * removes it, and the model receives the blockquote produced by this plugin's
 * own reference codec at submit time.
 *
 * Why the composer-overlay seat: the input surface is Session-scoped, and
 * `inputActions`/`useInput` are Session-scoped standard props. A root-scoped
 * seat such as `shell.overlay` receives only the global standard props, so it
 * could draw the pill but could not reach the draft. The entry therefore lives
 * in `conversation.input.overlay` (Session scope) and renders its pill through
 * a body portal, which is the same pattern the shipped feedback dialog uses.
 *
 * Why a reference chip rather than `setDraft`: text written with `setDraft` is
 * indistinguishable from something the user typed, and flattening a draft
 * destroys every chip already in it. The reference pipeline is the shell's own
 * answer to "an object in the composer": `insertReference` places an atomic
 * node, and the registered source's codec owns both the clipboard projection
 * and the model text — a split this plugin needs anyway, because a persisted
 * draft keeps only the clipboard form.
 *
 * Failure posture: the slot renderer wraps every entry in its own error
 * boundary and *abdicates* an entry that throws — the registration survives but
 * is permanently skipped, with nothing on screen. This plugin installs its own
 * boundary inside that one, so a crash here reports itself instead of turning
 * into a feature that silently does nothing.
 */
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'

/** Locale namespace owned by this plugin. */
const NS = 'selection-quote'

/** Globally unique entry id inside `conversation.input.overlay`. */
const ENTRY_ID = 'selection-quote'

/**
 * Reference source name. It must match in three places: the registered trigger
 * source, the `ReferenceInsert.source` on every chip this plugin inserts, and
 * therefore the codec the submit path looks up. A chip whose source is not
 * registered blocks the send, so this name is the plugin's single most
 * load-bearing constant.
 */
const QUOTE_SOURCE = 'quote'

/**
 * Transcript node kinds whose text is not prose, mirrored from the Chat View's
 * `data-chat-flow-kind` attribute. Everything else in the transcript is
 * accepted on purpose: an allowlist would silently disable the feature the
 * moment the Chat View adds or renames a node kind.
 */
const NON_PROSE_KINDS = new Set([
  'command',
  'command-input',
  'compaction',
  'context',
  'manual-compaction',
  'model-retry',
  'question-reply',
  'system-prompt',
  'tool-call',
  'turn-error',
  'turn-max-tokens',
  'turn-process',
  'turn-tail',
  'turn-trigger',
  'unknown',
  'workflow-run',
])

const SOURCE_LABEL: Record<string, string> = {
  'assistant-step': '助手回复',
  user: '用户消息',
  steering: '插话',
}

/**
 * When true the quote carries a trailing provenance line naming the source node
 * kind. Off by default: the blockquote form already tells the model that the
 * material is quoted, and a provenance line on text the model itself wrote
 * reads as noise.
 */
const INCLUDE_PROVENANCE = false

/**
 * Diagnostics switch, off in normal use.
 *
 * While true the entry draws a status strip reporting what the last selection
 * probe and the last insertion did, and records gesture-to-pill latency. It is
 * kept behind a flag rather than deleted because every real failure this plugin
 * has had was invisible without it — turn it on, rebuild, reload, and the strip
 * says which gate refused the selection or which insertion path was taken.
 */
const DIAGNOSTIC = false

/**
 * Longest passage this plugin will carry in a chip, in UTF-16 code units of the
 * selected text. The whole passage travels inside the reference id, and that id
 * is re-read on every editor rescan, so the ceiling keeps a pathological
 * select-all from bloating the editor state. Truncation is marked in the quote
 * itself so the model is never quietly shown a partial passage.
 */
const MAX_QUOTE_CHARS = 20000

/** Distance in px between the selection box and the pill. */
const PILL_GAP = 8

/** Keeps the pill inside the viewport when the selection hugs an edge. */
const VIEWPORT_MARGIN = 12

/** Above transcript content, below the shell's modal layer (which uses 1100). */
const PILL_Z_INDEX = 1050

/** The diagnostic strip must stay readable even when something else is broken. */
const DIAGNOSTIC_Z_INDEX = 1080

const zh = {
  'action.add': '添加到对话框',
  'action.addHint': '把选中的文字作为引用加入输入框（不会立即发送）',
  'action.blocked': '输入框正在提交，暂不能插入引用',
  'diag.mounted': '已挂载',
  'diag.none': '尚未捕获选区',
  'diag.hit': '命中，可引用',
  'diag.chip': '已插入引用芯片',
  'diag.text': '已回退为纯文本引用',
  'diag.latency': '手势到出现',
}

const en = {
  'action.add': 'Add to chat',
  'action.addHint': 'Attach the selected text as a quote without sending it',
  'action.blocked': 'The composer is submitting; quoting is unavailable',
  'diag.mounted': 'mounted',
  'diag.none': 'no selection probed yet',
  'diag.hit': 'hit — quoteable',
  'diag.chip': 'quote chip inserted',
  'diag.text': 'fell back to plain text',
  'diag.latency': 'gesture to pill',
}

/** Composer phase in which a programmatic editor write is still meaningful. */
type InputPhase = 'plain' | 'adjudicating' | 'claimed' | 'submitting'

/** One reference chip already in the draft, as the input machine publishes it. */
interface Occurrence {
  /** Length of this chip's clipboard form. */
  readonly length: number
}

/** The input-machine facts this plugin reads. */
interface InputState {
  readonly draft: string
  readonly draftRev: number
  readonly phase: InputPhase
  readonly occurrences: readonly Occurrence[]
}

/** The structured reference this plugin inserts. */
interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly clipboardText: string
}

/** Draft span the insertion replaces, guarded by the input revision. */
interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** Session-scoped standard props this plugin consumes. */
interface SelectionQuoteProps {
  useInput: <S>(selector: (state: InputState | undefined) => S) => S
  inputActions: { setDraft(text: string): void }
  insertQuote: (text: string, state: InputState | undefined) => boolean
  t: (key: keyof typeof zh) => string
}

/** A live, measured selection that can be quoted. */
interface SelectionHit {
  /** Raw selected text, trimmed at the edges. */
  readonly text: string
  /** Transcript node kind the selection sits inside. */
  readonly kind: string
  /** Viewport-space box of the selection, used to place the pill. */
  readonly rect: {
    readonly left: number
    readonly right: number
    readonly top: number
    readonly bottom: number
  }
}

/** Outcome of one selection probe: a quoteable hit, or the gate that refused it. */
type Probe = { readonly hit: SelectionHit } | { readonly miss: string }

/** Browser services the plugin needs from the client root context. */
export const inject = ['slots', 'locale', 'sessions', 'inputTriggers']

//#region passage encoding

/**
 * Cache of decoded passages. The input machine folds every chip's clipboard
 * form on each editor rescan, so decoding must not be quadratic in keystrokes.
 */
const decodedQuotes = new Map<string, string>()

/**
 * Encode one passage into a self-contained reference id.
 *
 * The id travels with the chip, so resolving it never depends on plugin memory:
 * the codec answers identically in this page, after an editor state import, and
 * for a chip this plugin did not insert in this session. The alternative — a
 * side table — would let a restore turn into a blocked send, because reference
 * serialization failure is defined to refuse the submission rather than
 * downgrade it.
 * @param text - the passage.
 * @returns the reference id.
 */
function encodeQuote(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `q.${btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')}`
}

/**
 * Decode one reference id back into its passage.
 * @param ref - reference id produced by {@link encodeQuote}.
 * @returns the passage, or the raw id when it is not one of ours.
 */
function decodeQuote(ref: string): string {
  const cached = decodedQuotes.get(ref)
  if (cached !== undefined) return cached
  let text = ref
  try {
    const body = ref.slice(2).replace(/-/gu, '+').replace(/_/gu, '/')
    const binary = atob(body)
    text = new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
  } catch {
    text = ref
  }
  if (decodedQuotes.size > 64) decodedQuotes.clear()
  decodedQuotes.set(ref, text)
  return text
}

/**
 * Apply the passage ceiling, marking the cut so the model is never silently
 * shown a partial passage. The marker is English because it is model-facing
 * text, not UI copy.
 * @param text - the selected passage.
 * @returns the passage this plugin will carry.
 */
function clampQuote(text: string): string {
  if (text.length <= MAX_QUOTE_CHARS) return text
  return `${text.slice(0, MAX_QUOTE_CHARS)}\n… (quote truncated)`
}

/**
 * Remove the transcript's own whitespace noise from a selection without
 * rewrapping its prose: hard-wrapped source lines stay separate quote lines.
 * @param text - raw selected text.
 * @returns the normalized text.
 */
function normalizeSelection(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Render one passage as a Markdown blockquote.
 * @param text - the passage.
 * @param kind - transcript node kind, used only when provenance is enabled.
 * @returns the quote block, without a trailing newline.
 */
function blockquoteOf(text: string, kind: string): string {
  const body = normalizeSelection(text)
    .split('\n')
    .map(line => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n')
  if (!INCLUDE_PROVENANCE) return body
  return `${body}\n>\n> —— 来自${SOURCE_LABEL[kind] ?? kind}`
}

/**
 * The chip's visible text: a short, single-line taste of the passage.
 * @param text - the passage.
 * @returns the chip label.
 */
function snippetOf(text: string): string {
  const flat = normalizeSelection(text).replace(/\s+/gu, ' ')
  return flat.length <= 22 ? flat : `${flat.slice(0, 22)}…`
}

/**
 * Append a quote to plain text, preserving whatever the user already typed.
 * @param draft - current clipboard projection of the composer.
 * @param quote - the blockquote to append.
 * @returns the next draft.
 */
function appendQuote(draft: string, quote: string): string {
  const head = draft.replace(/\s+$/u, '')
  return head.length === 0 ? quote : `${head}\n\n${quote}`
}

/**
 * Detect-coordinate offset of the document end.
 *
 * The composer walks its document into two projections: `detectText`, where
 * each chip is one object-replacement character, and the clipboard projection
 * the shell publishes as `InputState.draft`, where each chip is its full
 * clipboard form. Insertion spans are detect coordinates, so the published end
 * offset has to be folded back — one character per chip.
 * @param state - current input state, absent before the machine publishes.
 * @returns the detect offset one past the last character.
 */
function detectEndOf(state: InputState | undefined): number {
  if (state === undefined) return 0
  let end = state.draft.length
  for (const occurrence of state.occurrences) end -= occurrence.length - 1
  return end
}

//#endregion

//#region reference source

/**
 * Build the codec the submit path calls for every chip of this source.
 *
 * `clipboardText` is the copy/paste and persisted-draft projection; `serialize`
 * is the model text. Both are the blockquote, so a copied draft and a sent
 * message read the same, and a draft restored from storage degrades into the
 * quote text rather than into an unresolvable chip.
 */
const quoteCodec = {
  clipboardText: (ref: string): string => blockquoteOf(decodeQuote(ref), 'unknown'),
  serialize: async (ref: string): Promise<string> =>
    blockquoteOf(decodeQuote(ref), 'unknown'),
}

/**
 * Bind a quote inserter to one Session.
 *
 * Resolution follows the service's own instruction — "address one via
 * `ctx.sessions.scope(id).conversation`" — and the returned boolean is the
 * caller's signal to fall back to plain text rather than lose the quote.
 * @param ctx - client root context captured at registration.
 * @param sessionId - Session the entry is rendered for.
 * @returns whether a chip was inserted.
 */
function makeQuoteInserter(
  ctx: Context,
  sessionId: string,
): (text: string, state: InputState | undefined) => boolean {
  return (text, state) => {
    if (state === undefined) return false
    try {
      const actx = ctx.sessions.scope(sessionId)
      if (actx === undefined) return false
      const conversation = actx.get('conversation')
      const session = conversation?.input?.for(actx)
      if (session === undefined) return false
      const ref = encodeQuote(clampQuote(text))
      const reference: ReferenceInsert = {
        source: QUOTE_SOURCE,
        ref,
        label: `引用：${snippetOf(text)}`,
        clipboardText: quoteCodec.clipboardText(ref),
      }
      const end = detectEndOf(state)
      return session.insertReference(reference, { start: end, end, draftRev: state.draftRev })
    } catch (error) {
      console.warn('selection-quote: chip insertion failed', error)
      return false
    }
  }
}

//#endregion

//#region plugin body

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch (error) {
      // A duplicate registration (HMR re-applying this half without a full
      // teardown) must not take the entry down with it: the previous
      // dictionaries are still installed under this exact namespace.
      console.warn('selection-quote: dictionaries already registered', error)
      return () => {}
    }
  }, 'selection-quote: dictionaries')

  // A codec is only reachable through a registered source, and a chip whose
  // source cannot be found refuses the submission. The source never offers a
  // menu row of its own: quoting starts from the transcript, not from typing.
  ctx.effect(
    () =>
      ctx.inputTriggers.registerSource({
        trigger: '@',
        name: QUOTE_SOURCE,
        order: 100,
        showGroupTitle: false,
        candidates: async () => [],
        onPick: () => undefined,
        codec: quoteCodec,
      }),
    'selection-quote: reference codec',
  )

  ctx.slots.inject('conversation.input.overlay', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.overlay',
        id: ENTRY_ID,
        order: 30,
        locale: NS,
        inject: (sessionId: string) => ({ insertQuote: makeQuoteInserter(ctx, sessionId) }),
      },
      SelectionQuoteEntry,
    ),
  )
}

//#endregion

//#region selection probe

/**
 * Resolve the transcript node that owns a selection.
 * @param range - the selection's range.
 * @returns the owning node plus its kind, or the gate that refused the selection.
 */
function transcriptNodeOf(
  range: Range,
): { readonly node: HTMLElement; readonly kind: string | null } | { readonly miss: string } {
  const container = range.commonAncestorContainer
  const start =
    container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement
  if (start === null) return { miss: 'no-anchor' }
  const transcript = start.closest('[data-chat-flow]')
  if (transcript === null) return { miss: 'not-in-transcript' }
  // A transcript row without the anchor attribute still counts: that attribute
  // is a provenance nicety, not the feature's permission slip.
  const anchor = start.closest('[data-chat-anchor-key]')
  const node = anchor instanceof HTMLElement ? anchor : (transcript as HTMLElement)
  return { node, kind: node.getAttribute('data-chat-flow-kind') }
}

/**
 * Whether the live selection currently sits inside the transcript.
 *
 * Deliberately cheaper than {@link probeSelection}: no geometry, no kind lookup.
 * It runs on every press, so it must not force layout.
 * @returns whether a non-collapsed transcript selection exists.
 */
function selectionInTranscript(): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false
  const container = selection.getRangeAt(0).commonAncestorContainer
  const element =
    container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement
  return element !== null && element.closest('[data-chat-flow]') !== null
}

/**
 * Read the current usable selection.
 * @returns the measured hit, or the gate that refused it.
 */
function probeSelection(): Probe {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return { miss: 'no-selection' }
  if (selection.isCollapsed) return { miss: 'collapsed' }
  const text = selection.toString().trim()
  if (text.length === 0) return { miss: 'empty-text' }
  const range = selection.getRangeAt(0)
  const owner = transcriptNodeOf(range)
  if ('miss' in owner) return owner
  const kind = owner.kind
  if (kind !== null && NON_PROSE_KINDS.has(kind)) return { miss: `kind:${kind}` }
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return { miss: 'zero-rect' }
  return {
    hit: {
      text,
      kind: kind ?? 'unknown',
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    },
  }
}

/**
 * Whether two probes describe the same on-screen pill. Compared field by field
 * so an unchanged selection never costs a render.
 * @param a - previous hit.
 * @param b - next hit.
 * @returns whether the pill would look identical.
 */
function sameHit(a: SelectionHit, b: SelectionHit): boolean {
  return (
    a.text === b.text &&
    a.kind === b.kind &&
    a.rect.left === b.rect.left &&
    a.rect.right === b.rect.right &&
    a.rect.top === b.rect.top &&
    a.rect.bottom === b.rect.bottom
  )
}

/**
 * Put the caret back in the composer so the user can keep typing after the
 * quote. The editor is shell-owned; this only asks the browser for focus and
 * never writes to the document itself.
 */
function focusComposer(): void {
  requestAnimationFrame(() => {
    const seat = document.querySelector('[data-composer-seat]')
    const scope: ParentNode = seat ?? document
    const editor = scope.querySelector('[contenteditable]:not([contenteditable="false"])')
    if (editor instanceof HTMLElement) editor.focus()
  })
}

//#endregion

//#region surfaces

/**
 * The pill's leading mark, drawn inline.
 *
 * Deliberately not a `@deepseek-ai/dsh-client-ui-primitives` icon: that module
 * is a platform-seed word whose *export names drift between shell builds*. The
 * desktop app serves the dist bundled inside `app.asar`, which is not the copy
 * published in the profile's `dsh-web-frontend`; in that build the icon set is
 * named `Icon*OutlineRegular`/`Icon*OutlineMedium`, so `IconPlusOutline16`
 * resolved to `undefined` and React raised "Element type is invalid" (#130),
 * which the slot renderer answers by abdicating the entry. A 14px glyph is not
 * worth a version-coupled dependency.
 * @returns the inline SVG glyph.
 */
function AddGlyph(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.4v9.2M3.4 8h9.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Plugin-owned error boundary.
 *
 * The slot renderer's boundary sits outside this one. Catching here keeps the
 * entry alive and turns a silent abdication into a readable on-screen report.
 */
class SelectionQuoteGuard extends Component<
  { t: (key: keyof typeof zh) => string; children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error }
  }

  componentDidCatch(error: unknown): void {
    console.error('selection-quote: entry crashed', error)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    const stack = error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 6).join('\n') : ''
    return createPortal(
      <div
        style={{
          position: 'fixed',
          zIndex: DIAGNOSTIC_Z_INDEX,
          left: '12px',
          bottom: '12px',
          maxWidth: '620px',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid var(--dsw-alias-state-error-primary)',
          background: 'var(--dsw-alias-bg-overlay)',
          color: 'var(--dsw-alias-label-primary)',
          font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
          whiteSpace: 'pre-wrap',
        }}
      >
        {`dsh-selection-quote crashed\n${detail}\n\n${stack}`}
      </div>,
      document.body,
    )
  }
}

/**
 * The composer-overlay entry: the guard, then the real body.
 * @param props - Session-scoped standard props.
 * @returns the guarded entry.
 */
function SelectionQuoteEntry(props: SelectionQuoteProps): ReactNode {
  return (
    <SelectionQuoteGuard t={props.t}>
      <SelectionQuoteAction {...props} />
    </SelectionQuoteGuard>
  )
}

/**
 * Tracks the live selection and draws the pill (plus the diagnostic strip).
 * @param props - Session-scoped standard props.
 * @returns the portalled surfaces, or null while nothing needs drawing.
 */
function SelectionQuoteAction({
  useInput,
  inputActions,
  insertQuote,
  t,
}: SelectionQuoteProps): ReactNode {
  // `state => state` never dereferences the snapshot: the renderer binds standard
  // hooks with a selector invoked during render, so a throwing selector takes
  // the whole entry down. Every field is read defensively below instead.
  const inputState = useInput(state => state)
  const stateRef = useRef<InputState | undefined>(inputState)
  stateRef.current = inputState
  const draft = inputState?.draft ?? ''
  const phase = inputState?.phase ?? 'plain'

  const [hit, setHit] = useState<SelectionHit | null>(null)
  const [lastMiss, setLastMiss] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<'chip' | 'text' | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const hitRef = useRef<SelectionHit | null>(null)
  const missRef = useRef<string | null>(null)
  const probesRef = useRef(0)
  const gestureAt = useRef<number | null>(null)
  const pointerDown = useRef(false)
  const scheduled = useRef(false)
  const pillRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    /**
     * Publish one probe's outcome, skipping state writes that would not change
     * what is on screen. A scroll-driven remeasure lands here on every frame,
     * and an identical hit must not cost a render.
     * @param probe - the measured selection.
     */
    const publish = (probe: Probe): void => {
      probesRef.current += 1
      if ('hit' in probe) {
        const previous = hitRef.current
        if (previous !== null && sameHit(previous, probe.hit)) return
        hitRef.current = probe.hit
        missRef.current = null
        setHit(probe.hit)
        setLastMiss(null)
        return
      }
      if (hitRef.current === null && missRef.current === probe.miss) return
      hitRef.current = null
      missRef.current = probe.miss
      setHit(null)
      setLastMiss(probe.miss)
    }

    const retire = (): void => {
      if (hitRef.current === null) return
      hitRef.current = null
      setHit(null)
    }

    /**
     * Measure now, in the event that reported the change.
     *
     * Deferring this through `requestAnimationFrame` put a frame — and, when the
     * transcript was busy, whatever the frame queue was doing — between the
     * user's gesture and the pill. Nothing here needs a layout-stable moment:
     * `selectionchange` already reports a committed selection.
     */
    const probeNow = (): void => {
      if (pointerDown.current) return
      publish(probeSelection())
    }

    const onSelectionChange = (): void => {
      probeNow()
    }
    const onPointerDown = (event: PointerEvent): void => {
      // A press on the pill must not withdraw it: this listener runs in the
      // document's CAPTURE phase, i.e. before the button's own handlers, so
      // hiding here would delete the button out from under its own click and
      // the quote would never be inserted.
      const pill = pillRef.current
      if (pill !== null && event.target instanceof Node && pill.contains(event.target)) return
      pointerDown.current = true
      retire()
      // Dismiss the highlight as well. Chromium collapses an existing selection
      // when the press lands on a selectable target — but the transcript's own
      // chrome opts out of selection, so pressing the padding around a message
      // leaves the blue highlight up with no way to remove it short of
      // selecting something else. Two presses must keep the selection:
      // shift-press extends it, and a secondary press is how the context menu
      // offers Copy.
      if (event.button !== 0 || event.shiftKey) return
      if (selectionInTranscript()) window.getSelection()?.removeAllRanges()
    }
    /** End of a selection gesture: the moment the user expects the pill. */
    const onGestureEnd = (): void => {
      if (pointerDown.current) gestureAt.current = performance.now()
      pointerDown.current = false
      probeNow()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') retire()
    }
    const onKeyUp = (): void => {
      probeNow()
    }
    /**
     * Reposition only. Re-measuring a selection that is not on screen costs a
     * forced layout per scroll event across the whole document, which is what
     * made the pill feel late; while a drag is in progress `hitRef` is already
     * null, so this returns immediately.
     */
    const onReflow = (): void => {
      if (hitRef.current === null || scheduled.current) return
      scheduled.current = true
      requestAnimationFrame(() => {
        scheduled.current = false
        if (pointerDown.current || hitRef.current === null) return
        publish(probeSelection())
      })
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onGestureEnd, true)
    document.addEventListener('mouseup', onGestureEnd)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onGestureEnd, true)
      document.removeEventListener('mouseup', onGestureEnd)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [])

  useEffect(() => {
    if (!DIAGNOSTIC) return
    const since = gestureAt.current
    if (hit === null || since === null) return
    gestureAt.current = null
    setLatency(Math.round(performance.now() - since))
  }, [hit])

  const blocked = phase !== 'plain'

  const onAdd = useCallback(() => {
    if (hit === null || blocked) return
    const passage = clampQuote(hit.text)
    const chipped = insertQuote(passage, stateRef.current)
    setLastAction(chipped ? 'chip' : 'text')
    // Falling back to text keeps the quote rather than losing it: an editor the
    // reference pipeline cannot address (a stale revision, a span the fold could
    // not place) is still better served by what the user asked for.
    if (!chipped) {
      inputActions?.setDraft(
        appendQuote(stateRef.current?.draft ?? '', blockquoteOf(passage, hit.kind)),
      )
    }
    hitRef.current = null
    setHit(null)
    // Retire the selection too: the quote now lives in the composer, and leaving
    // the highlight up would make the next probe re-raise the pill as if the
    // click had not registered.
    window.getSelection()?.removeAllRanges()
    focusComposer()
  }, [blocked, hit, inputActions, insertQuote])

  const surfaces: ReactNode[] = []

  if (hit !== null) {
    const centre = (hit.rect.left + hit.rect.right) / 2
    const half = 90
    const viewport = Number.isFinite(window.innerWidth) ? window.innerWidth : 1200
    const left = Math.min(
      Math.max(centre, half + VIEWPORT_MARGIN),
      Math.max(half + VIEWPORT_MARGIN, viewport - half - VIEWPORT_MARGIN),
    )
    const above = hit.rect.top > 56
    const top = above ? hit.rect.top - PILL_GAP : hit.rect.bottom + PILL_GAP
    surfaces.push(
      createPortal(
        <div
          key="pill"
          ref={pillRef}
          data-selection-quote="pill"
          style={{
            position: 'fixed',
            zIndex: PILL_Z_INDEX,
            left: `${String(left)}px`,
            top: `${String(top)}px`,
            transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          <button
            type="button"
            title={blocked ? t('action.blocked') : t('action.addHint')}
            aria-label={t('action.add')}
            disabled={blocked}
            onMouseDown={event => {
              event.preventDefault()
            }}
            onClick={onAdd}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-overlay)',
              color: 'var(--dsw-alias-label-primary)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.16)',
              font: 'inherit',
              fontSize: '13px',
              lineHeight: '18px',
              whiteSpace: 'nowrap',
              cursor: blocked ? 'not-allowed' : 'pointer',
              opacity: blocked ? 0.6 : 1,
            }}
          >
            <AddGlyph />
            {t('action.add')}
          </button>
        </div>,
        document.body,
      ),
    )
  }

  if (DIAGNOSTIC) {
    const status =
      hit === null
        ? `${t('diag.none')}${lastMiss === null ? '' : ` · ${lastMiss}`}`
        : `${t('diag.hit')} · kind=${hit.kind}`
    const action =
      lastAction === null ? '' : ` · ${lastAction === 'chip' ? t('diag.chip') : t('diag.text')}`
    const timing = latency === null ? '' : ` · ${t('diag.latency')}=${String(latency)}ms`
    surfaces.push(
      createPortal(
        <div
          key="diagnostic"
          style={{
            position: 'fixed',
            zIndex: DIAGNOSTIC_Z_INDEX,
            right: '10px',
            bottom: '10px',
            maxWidth: '420px',
            padding: '4px 8px',
            borderRadius: '6px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-overlay)',
            color: 'var(--dsw-alias-label-secondary)',
            font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
            whiteSpace: 'pre-wrap',
            pointerEvents: 'none',
          }}
        >
          {`dsh-selection-quote ${t('diag.mounted')} · probes=${String(probesRef.current)}\n${status}${action}${timing}`}
        </div>,
        document.body,
      ),
    )
  }

  if (surfaces.length === 0) return null
  return <>{surfaces}</>
}

//#endregion
