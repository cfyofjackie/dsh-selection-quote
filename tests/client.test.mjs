/**
 * Headless smoke test for the browser half.
 *
 * The plugin's logic touches the browser globals plus four platform-seed
 * modules. This test stubs exactly those and drives the *built bundle* the way
 * the shell would: function components get a hook runtime, class components get
 * real error-boundary semantics, and portals are unwrapped so the portalled
 * surfaces can be asserted.
 *
 * Run: `node --test tests/`
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Shallow dependency comparison, matching React's `Object.is` per element. */
function sameDeps(previous, next) {
  if (previous === undefined || next === undefined) return previous === next
  if (previous.length !== next.length) return false
  return previous.every((value, index) => Object.is(value, next[index]))
}

/**
 * Minimal component renderer: hook slots per function component, class
 * components with error-boundary semantics, and portals unwrapped in place.
 * @returns the React stand-in plus a mount helper.
 */
function createRenderer() {
  const instances = new Map()
  let current = null
  let root = null
  let tree = null
  let renderDepth = 0
  let needsRender = false
  let pendingEffects = []

  function renderClass(Type, props) {
    const instance = new Type(props)
    instance.props = props
    instance.state = instance.state ?? {}
    try {
      return renderNode(instance.render())
    } catch (error) {
      if (typeof Type.getDerivedStateFromError !== 'function') throw error
      instance.state = { ...instance.state, ...Type.getDerivedStateFromError(error) }
      if (typeof instance.componentDidCatch === 'function') instance.componentDidCatch(error)
      return renderNode(instance.render())
    }
  }

  function renderFunction(Component, props) {
    let instance = instances.get(Component)
    if (instance === undefined) {
      instance = { hooks: [], cursor: 0 }
      instances.set(Component, instance)
    }
    const previous = current
    current = instance
    instance.cursor = 0
    let output
    try {
      output = Component(props)
    } finally {
      current = previous
    }
    return renderNode(output)
  }

  function renderNode(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderNode)
    if (node.portal !== undefined) {
      return { portal: renderNode(node.portal), container: node.container }
    }
    const { type, props } = node
    if (typeof type === 'function') {
      return type.prototype && typeof type.prototype.render === 'function'
        ? renderClass(type, props)
        : renderFunction(type, props)
    }
    if (typeof type !== 'string') {
      // React's own contract: an undefined import reaches render as this error.
      throw new Error(
        `Element type is invalid: expected a string or a class/function but got: ${String(type)}.`,
      )
    }
    return hostNode(type, props)
  }

  /** A rendered host element: a DOM stand-in that also carries its tree node. */
  function hostNode(type, props) {
    const host = Object.assign(new FakeHTMLElement(), {
      type,
      props: { ...props, children: renderNode(props.children) },
    })
    const ref = props.ref
    if (ref !== null && typeof ref === 'object') ref.current = host
    return host
  }

  function flushEffects() {
    while (pendingEffects.length > 0) {
      const effect = pendingEffects.shift()
      effect()
    }
  }

  function renderRoot() {
    if (renderDepth > 0) {
      needsRender = true
      return
    }
    renderDepth += 1
    try {
      tree = renderFunction(root.Component, root.props)
    } finally {
      renderDepth -= 1
    }
  }

  function rerender() {
    if (root === null) return
    renderRoot()
    flushEffects()
    if (needsRender) {
      needsRender = false
      rerender()
    }
  }

  const react = {
    useState(initial) {
      const instance = current
      const slot = instance.cursor++
      if (!(slot in instance.hooks)) {
        instance.hooks[slot] = typeof initial === 'function' ? initial() : initial
      }
      const set = next => {
        const value = typeof next === 'function' ? next(instance.hooks[slot]) : next
        if (Object.is(value, instance.hooks[slot])) return
        instance.hooks[slot] = value
        rerender()
      }
      return [instance.hooks[slot], set]
    },
    useRef(initial) {
      const instance = current
      const slot = instance.cursor++
      if (!(slot in instance.hooks)) instance.hooks[slot] = { current: initial }
      return instance.hooks[slot]
    },
    useCallback(fn, deps) {
      const instance = current
      const slot = instance.cursor++
      const previous = instance.hooks[slot]
      if (previous === undefined || !sameDeps(previous.deps, deps)) {
        instance.hooks[slot] = { fn, deps }
      }
      return instance.hooks[slot].fn
    },
    useEffect(effect, deps) {
      const instance = current
      const slot = instance.cursor++
      const previous = instance.hooks[slot]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return
      const record = { effect: true, deps, cleanup: undefined }
      instance.hooks[slot] = record
      pendingEffects.push(() => {
        if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
        const cleanup = effect()
        record.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      })
    },
    Component: class Component {
      constructor(props) {
        this.props = props
        this.state = {}
      }
    },
  }

  return {
    react,
    mount(Component, props) {
      root = { Component, props }
      renderRoot()
      flushEffects()
      return {
        read: () => tree,
        unmount() {
          for (const instance of instances.values()) {
            for (const hook of instance.hooks) {
              if (
                hook !== null &&
                typeof hook === 'object' &&
                hook.effect === true &&
                typeof hook.cleanup === 'function'
              ) {
                hook.cleanup()
              }
            }
          }
        },
      }
    },
  }
}

/**
 * DOM stand-ins. `Node` is a real constructor because the plugin both reads
 * `Node.ELEMENT_NODE` and tests `event.target instanceof Node`.
 */
class FakeNode {
  static ELEMENT_NODE = 1

  static TEXT_NODE = 3

  contains(candidate) {
    return containsNode(this, candidate)
  }
}

class FakeHTMLElement extends FakeNode {
  constructor(attributes = {}, ancestors = {}) {
    super()
    this.nodeType = 1
    this.parentElement = null
    this.attributes = attributes
    this.ancestors = ancestors
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  closest(selector) {
    return this.ancestors[selector] ?? null
  }

  focus() {
    this.focused = true
  }
}

/** Subtree containment over the rendered tree shape. */
function containsNode(node, candidate) {
  if (node === candidate) return true
  if (node === null || node === undefined || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(child => containsNode(child, candidate))
  if (node.portal !== undefined) return containsNode(node.portal, candidate)
  return containsNode(node.props?.children, candidate)
}

/**
 * Install the browser globals the bundle reads and capture document listeners.
 * @returns the captured listener table plus dispatch helpers.
 */
function installBrowser() {
  const listeners = new Map()
  const body = new FakeHTMLElement()
  const document = {
    body,
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler])
    },
    removeEventListener(type, handler) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(entry => entry !== handler),
      )
    },
    querySelector: () => null,
  }
  globalThis.Node = FakeNode
  globalThis.HTMLElement = FakeHTMLElement
  globalThis.document = document
  globalThis.requestAnimationFrame = callback => {
    callback()
    return 1
  }
  globalThis.cancelAnimationFrame = () => {}
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => null,
    innerWidth: 1200,
  }
  return {
    body,
    dispatch(type, event) {
      for (const handler of listeners.get(type) ?? []) handler(event)
    },
    listenerCount: () => [...listeners.values()].reduce((total, list) => total + list.length, 0),
  }
}

/** Load the built bundle's factory with stubbed platform-seed modules. */
function loadBundle(renderer) {
  let registration = null
  globalThis.window.__ModuleLoader__ = {
    load(entry) {
      registration = entry
    },
  }
  const script = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  // The bundle is a classic script that registers itself; evaluate it with the
  // stub `window` bound, exactly as the Web shell's <script> row would.
  new Function('window', script)(globalThis.window)
  assert.ok(registration !== null, 'bundle must register with the module loader')

  const jsx = (type, props) => ({ type, props })
  const Fragment = props => props.children
  const modules = {
    react: renderer.react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment },
    'react-dom': { createPortal: (children, container) => ({ portal: children, container }) },
  }
  return {
    id: registration.id,
    required: Object.keys(modules).filter(specifier => script.includes(`require("${specifier}")`)),
    exports: registration.factory(specifier => {
      const mod = modules[specifier]
      if (mod === undefined) throw new Error(`unexpected require("${specifier}")`)
      return mod
    }),
  }
}

/**
 * Run `apply` against a recording stand-in for the client root context.
 * @param exports - the bundle's plugin face.
 * @param scope - optional `sessions.scope` implementation.
 * @returns everything the plugin registered.
 */
function applyWithFakeContext(exports, scope = () => undefined) {
  const registrations = []
  const dictionaries = []
  const injections = []
  const disposers = []
  const sources = []
  const ctx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    get: () => undefined,
    locale: { register: (namespace, dicts) => dictionaries.push({ namespace, dicts }) },
    sessions: { scope },
    inputTriggers: {
      registerSource(source) {
        sources.push(source)
        return () => {}
      },
    },
    slots: {
      inject(key, callback) {
        injections.push(key)
        const dispose = callback()
        disposers.push(dispose)
        return dispose
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  return { registrations, dictionaries, injections, disposers, sources }
}

/**
 * A quoteable selection inside a transcript node.
 * @param text - the text the selection reports.
 * @param kind - the transcript node kind to report.
 */
function assistantSelection(text, kind = 'assistant-step') {
  const flow = new FakeHTMLElement()
  const anchor = new FakeHTMLElement({ 'data-chat-flow-kind': kind }, {
    '[data-chat-flow]': flow,
  })
  const container = new FakeHTMLElement({}, {
    '[data-chat-anchor-key]': anchor,
    '[data-chat-flow]': flow,
  })
  const range = {
    commonAncestorContainer: container,
    getBoundingClientRect: () => ({
      left: 100,
      right: 300,
      top: 400,
      bottom: 420,
      width: 200,
      height: 20,
    }),
  }
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => range,
    removeAllRanges() {
      this.cleared = true
    },
  }
}

/** Walk a rendered tree, collecting every node the predicate accepts. */
function collect(node, predicate, found = []) {
  if (node === null || node === undefined) return found
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, found)
    return found
  }
  if (typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  if (node.portal !== undefined) collect(node.portal, predicate, found)
  else collect(node.props?.children, predicate, found)
  return found
}

/** Every text string rendered anywhere in the tree. */
function texts(node, found = []) {
  if (typeof node === 'string') {
    found.push(node)
    return found
  }
  if (node === null || node === undefined) return found
  if (Array.isArray(node)) {
    for (const child of node) texts(child, found)
    return found
  }
  if (typeof node !== 'object') return found
  if (node.portal !== undefined) texts(node.portal, found)
  else texts(node.props?.children, found)
  return found
}

/**
 * Mount the registered entry with the given props.
 * @param registration - one recorded slot registration.
 * @param renderer - the component renderer.
 * @param input - the input state the standard hook answers.
 * @param setDraft - records plain-text fallback writes.
 * @param insertQuote - records chip insertions; defaults to "the pipeline refused".
 */
function mountEntry(registration, renderer, input, setDraft, insertQuote = () => false) {
  const view = renderer.mount(registration.component, {
    useInput: selector => selector(input),
    inputActions: { setDraft },
    insertQuote,
    t: key => key,
  })
  return {
    ...view,
    /** The portalled pill button, or null while the pill is hidden. */
    button() {
      const found = collect(view.read(), node => node.type === 'button')
      return found.length === 0 ? null : found[0]
    },
  }
}

test('the bundle registers a graph row and exposes the plugin face', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { id, exports } = loadBundle(renderer)
    assert.equal(id, 'dsh-selection-quote', 'row id must be the package name')
    assert.equal(typeof exports.apply, 'function')
    assert.deepEqual(exports.inject, ['slots', 'locale', 'sessions', 'inputTriggers'])
    assert.equal(browser.listenerCount(), 0, 'loading alone subscribes to nothing')
  } finally {
    delete globalThis.document
  }
})

test('apply registers the dictionaries and one composer-overlay entry', () => {
  const renderer = createRenderer()
  installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations, dictionaries, injections } = applyWithFakeContext(exports)
    assert.deepEqual(injections, ['conversation.input.overlay'])
    assert.equal(registrations.length, 1)
    const [entry] = registrations
    assert.equal(entry.options.name, 'conversation.input.overlay')
    assert.equal(entry.options.id, 'selection-quote')
    assert.equal(entry.options.locale, 'selection-quote')
    assert.equal(entry.options.order, 30)
    assert.equal(entry.component.name, 'SelectionQuoteEntry')
    assert.equal(dictionaries.length, 1)
    assert.equal(dictionaries[0].namespace, 'selection-quote')
    assert.deepEqual(Object.keys(dictionaries[0].dicts).sort(), ['en', 'zh'])
    assert.deepEqual(
      Object.keys(dictionaries[0].dicts.zh).sort(),
      Object.keys(dictionaries[0].dicts.en).sort(),
      'both dictionaries must cover the same keys',
    )
  } finally {
    delete globalThis.document
  }
})

test('the pill appears only for a quoteable passage inside the transcript', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const view = mountEntry(registrations[0], renderer, { draft: '', phase: 'plain' }, () => {})
    assert.equal(view.button(), null, 'no selection, no pill')

    globalThis.window.getSelection = () => assistantSelection('   ')
    browser.dispatch('selectionchange')
    assert.equal(view.button(), null, 'whitespace is not quoteable')

    globalThis.window.getSelection = () => assistantSelection('partial output', 'tool-call')
    browser.dispatch('selectionchange')
    assert.equal(view.button(), null, 'a tool-call node is not prose')

    globalThis.window.getSelection = () => assistantSelection('real prose')
    browser.dispatch('selectionchange')
    assert.notEqual(view.button(), null, 'an assistant passage is quoteable')

    // A node kind this plugin has never heard of is still prose: an allowlist
    // would silently disable the feature when the Chat View grows a kind.
    globalThis.window.getSelection = () => assistantSelection('new kind', 'assistant-note')
    browser.dispatch('selectionchange')
    assert.notEqual(view.button(), null, 'an unknown node kind must not disable the feature')
  } finally {
    delete globalThis.document
  }
})

test('clicking the pill hands the passage to the chip inserter and leaves the draft alone', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const drafts = []
    const handed = []
    const view = mountEntry(
      registrations[0],
      renderer,
      { draft: 'look at this:', draftRev: 3, phase: 'plain', occurrences: [] },
      text => drafts.push(text),
      (text, state) => {
        handed.push({ text, state })
        return true
      },
    )

    globalThis.window.getSelection = () =>
      assistantSelection('  first line\nsecond line  \n\n\nthird  ')
    browser.dispatch('selectionchange')
    const button = view.button()
    assert.notEqual(button, null)
    assert.equal(button.props.disabled, false)
    button.props.onClick()

    assert.equal(handed.length, 1, 'the passage reaches the reference pipeline')
    assert.equal(handed[0].text, 'first line\nsecond line  \n\n\nthird')
    assert.equal(handed[0].state.draftRev, 3, 'the live revision rides along for the span CAS')
    assert.deepEqual(drafts, [], 'a chip insertion must not also rewrite the draft')
    assert.equal(view.button(), null, 'the pill retires after quoting')
  } finally {
    delete globalThis.document
  }
})

test('a refused chip insertion falls back to a normalized Markdown blockquote', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const drafts = []
    const view = mountEntry(
      registrations[0],
      renderer,
      { draft: 'look at this:', draftRev: 1, phase: 'plain', occurrences: [] },
      text => drafts.push(text),
      () => false,
    )

    globalThis.window.getSelection = () =>
      assistantSelection('  first line\nsecond line  \n\n\nthird  ')
    browser.dispatch('selectionchange')
    view.button().props.onClick()

    assert.equal(drafts.length, 1, 'the quote is kept rather than lost')
    assert.equal(drafts[0], 'look at this:\n\n> first line\n> second line\n>\n> third')
    assert.equal(view.button(), null, 'the pill retires after quoting')
  } finally {
    delete globalThis.document
  }
})

test('the injected inserter places one chip at the folded document end', () => {
  const renderer = createRenderer()
  installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const calls = []
    const session = {
      insertReference(reference, span) {
        calls.push({ reference, span })
        return true
      },
    }
    const actx = {
      get: name => (name === 'conversation' ? { input: { for: () => session } } : undefined),
    }
    const { registrations, sources } = applyWithFakeContext(exports, id =>
      id === 's1' ? actx : undefined,
    )
    assert.equal(typeof registrations[0].options.inject, 'function')
    const { insertQuote } = registrations[0].options.inject('s1')

    // Two chips already sit in the draft: 'hello world' is the clipboard
    // projection (11 chars), while the detect projection collapses each chip to
    // one character — 11 - (2-1) - (4-1) = 7.
    const state = {
      draft: 'hello world',
      draftRev: 7,
      phase: 'plain',
      occurrences: [{ length: 2 }, { length: 4 }],
    }
    assert.equal(insertQuote('quoted passage', state), true)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].span, { start: 7, end: 7, draftRev: 7 })
    assert.equal(calls[0].reference.source, 'quote')
    assert.equal(calls[0].reference.label, '引用：quoted passage')
    assert.equal(calls[0].reference.clipboardText, '> quoted passage')

    assert.equal(
      sources[0].name,
      calls[0].reference.source,
      'the codec must answer to the exact source name the chip carries',
    )
  } finally {
    delete globalThis.document
  }
})

test('the registered codec turns one chip reference back into the model text', async () => {
  const renderer = createRenderer()
  installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const calls = []
    const actx = {
      get: () => ({
        input: {
          for: () => ({
            insertReference(reference, span) {
              calls.push({ reference, span })
              return true
            },
          }),
        },
      }),
    }
    const { registrations, sources } = applyWithFakeContext(exports, () => actx)
    const { insertQuote } = registrations[0].options.inject('s1')
    const passage = '第一行\n\n第三行'
    insertQuote(passage, { draft: '', draftRev: 0, phase: 'plain', occurrences: [] })

    const source = sources[0]
    assert.equal(source.trigger, '@')
    assert.equal(source.order, 100)
    assert.equal(source.showGroupTitle, false)
    assert.deepEqual(await source.candidates({}, {}), [], 'the source never offers a menu row')

    const { ref } = calls[0].reference
    const expected = '> 第一行\n>\n> 第三行'
    assert.equal(source.codec.clipboardText(ref), expected, 'copy/paste projection')
    assert.equal(await source.codec.serialize(ref, new AbortController().signal), expected)
  } finally {
    delete globalThis.document
  }
})

test('a press on the pill does not withdraw it before its own click lands', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const drafts = []
    const view = mountEntry(
      registrations[0],
      renderer,
      { draft: '', phase: 'plain' },
      text => drafts.push(text),
    )

    globalThis.window.getSelection = () => assistantSelection('quoted')
    browser.dispatch('selectionchange')
    assert.notEqual(view.button(), null, 'the pill is up before the press')

    // Real event order: the document-level CAPTURE pointerdown runs before the
    // button's own click. Withdrawing the pill here deletes the button out from
    // under its own click, which is exactly how the quote went missing.
    browser.dispatch('pointerdown', { target: view.button() })
    assert.notEqual(view.button(), null, 'the pill survives a press on itself')

    view.button().props.onClick()
    assert.equal(drafts.length, 1, 'the click still inserts the quote')
    assert.equal(view.button(), null, 'and the pill retires afterwards')
  } finally {
    delete globalThis.document
  }
})

test('a press outside the pill withdraws it', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const view = mountEntry(registrations[0], renderer, { draft: '', phase: 'plain' }, () => {})

    globalThis.window.getSelection = () => assistantSelection('quoted')
    browser.dispatch('selectionchange')
    assert.notEqual(view.button(), null)

    // A press anywhere else starts a new gesture: the pill must get out of the way.
    const descendant = new FakeHTMLElement()
    browser.dispatch('pointerdown', { target: descendant })
    assert.equal(view.button(), null, 'an outside press withdraws the pill')
  } finally {
    delete globalThis.document
  }
})

test('scrolling never re-measures a selection that is not on screen', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const view = mountEntry(registrations[0], renderer, { draft: '', phase: 'plain' }, () => {})

    // The reported symptom was a pill that took a second or two to appear.
    // Probing on every scroll event forced one layout per event across the whole
    // document, so the observable is simply that the selection is never read.
    let reads = 0
    globalThis.window.getSelection = () => {
      reads += 1
      return null
    }
    for (let index = 0; index < 20; index += 1) browser.dispatch('scroll', {})
    assert.equal(reads, 0, 'a scroll with no pill must not measure anything')

    // Once a pill is up, a scroll does reposition it.
    globalThis.window.getSelection = () => {
      reads += 1
      return assistantSelection('quoted')
    }
    browser.dispatch('selectionchange')
    assert.notEqual(view.button(), null)
    const afterSelection = reads
    browser.dispatch('scroll', {})
    assert.equal(reads, afterSelection + 1, 'a scroll with a pill re-measures it once')
  } finally {
    delete globalThis.document
  }
})

test('an unmoved selection does not re-render the pill', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const view = mountEntry(registrations[0], renderer, { draft: '', phase: 'plain' }, () => {})
    globalThis.window.getSelection = () => assistantSelection('quoted')
    browser.dispatch('selectionchange')
    const pill = view.button()
    assert.notEqual(pill, null)

    // Same selection, same box: the probe still runs, but React must not receive
    // a new object and the rendered node must survive untouched.
    browser.dispatch('selectionchange')
    assert.equal(view.button(), pill, 'the identical hit keeps the same rendered node')
  } finally {
    delete globalThis.document
  }
})

test('an empty draft becomes the quote alone, and a busy composer refuses the write', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const drafts = []
    const input = { draft: '   \n', phase: 'plain' }
    const view = mountEntry(registrations[0], renderer, input, text => drafts.push(text))

    globalThis.window.getSelection = () => assistantSelection('quoted')
    browser.dispatch('selectionchange')
    view.button().props.onClick()
    assert.equal(drafts[0], '> quoted', 'no leading blank lines on an empty draft')

    input.phase = 'submitting'
    globalThis.window.getSelection = () => assistantSelection('later')
    browser.dispatch('selectionchange')
    const button = view.button()
    assert.equal(button.props.disabled, true, 'a submitting composer is not writable')
    button.props.onClick()
    assert.equal(drafts.length, 1, 'a blocked click writes nothing')
  } finally {
    delete globalThis.document
  }
})

test('every document listener is released when the entry unmounts', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    const view = mountEntry(registrations[0], renderer, { draft: '', phase: 'plain' }, () => {})
    assert.equal(
      browser.listenerCount(),
      7,
      'selectionchange, pointerdown, pointerup, mouseup, keyup, keydown, scroll',
    )
    view.unmount()
    assert.equal(browser.listenerCount(), 0)
  } finally {
    delete globalThis.document
  }
})

test('the bundle depends on no seed module whose exports can drift', () => {
  const renderer = createRenderer()
  installBrowser()
  try {
    const { required } = loadBundle(renderer)
    // The desktop app serves the dist bundled inside app.asar, whose
    // `@deepseek-ai/dsh-client-ui-primitives` names its icons
    // `Icon*OutlineRegular`/`Icon*OutlineMedium` — the profile's
    // dsh-web-frontend copy uses `Icon*Outline16`. A named import from that
    // module therefore resolves to undefined in one of the two shells and kills
    // the entry with React #130. Only React itself is stable enough to import.
    for (const specifier of required) {
      assert.ok(
        ['react', 'react-dom', 'react/jsx-runtime'].includes(specifier),
        `client bundle requires "${specifier}"; seed-module exports drift between shell builds`,
      )
    }
    assert.ok(!required.includes('@deepseek-ai/dsh-client-ui-primitives'))
  } finally {
    delete globalThis.document
  }
})

test('a crash inside the body is reported on screen instead of abdicating silently', () => {
  const renderer = createRenderer()
  const browser = installBrowser()
  try {
    const { exports } = loadBundle(renderer)
    const { registrations } = applyWithFakeContext(exports)
    // A throwing standard hook is the real failure mode that matters: the slot
    // renderer would abdicate the entry, leaving the feature silently dead.
    const view = renderer.mount(registrations[0].component, {
      useInput: () => {
        throw new Error('useInput exploded')
      },
      inputActions: { setDraft() {} },
      t: key => key,
    })
    const rendered = texts(view.read()).join('\n')
    assert.match(rendered, /dsh-selection-quote crashed/, 'the guard reports the crash')
    assert.match(rendered, /useInput exploded/, 'the guard names the actual error')
    assert.equal(browser.listenerCount(), 0, 'the half-mounted entry registers no listeners')
  } finally {
    delete globalThis.document
  }
})
