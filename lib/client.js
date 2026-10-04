window.__ModuleLoader__.load({
	id: "dsh-selection-quote",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var import_react_dom = require("react-dom");
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "selection-quote";
var ENTRY_ID = "selection-quote";
var QUOTE_SOURCE = "quote";
var NON_PROSE_KINDS = /* @__PURE__ */ new Set([
  "command",
  "command-input",
  "compaction",
  "context",
  "manual-compaction",
  "model-retry",
  "question-reply",
  "system-prompt",
  "tool-call",
  "turn-error",
  "turn-max-tokens",
  "turn-process",
  "turn-tail",
  "turn-trigger",
  "unknown",
  "workflow-run"
]);
var SOURCE_LABEL = {
  "assistant-step": "\u52A9\u624B\u56DE\u590D",
  user: "\u7528\u6237\u6D88\u606F",
  steering: "\u63D2\u8BDD"
};
var INCLUDE_PROVENANCE = false;
var DIAGNOSTIC = false;
var MAX_QUOTE_CHARS = 2e4;
var PILL_GAP = 8;
var VIEWPORT_MARGIN = 12;
var PILL_Z_INDEX = 1050;
var DIAGNOSTIC_Z_INDEX = 1080;
var zh = {
  "action.add": "\u6DFB\u52A0\u5230\u5BF9\u8BDD\u6846",
  "action.addHint": "\u628A\u9009\u4E2D\u7684\u6587\u5B57\u4F5C\u4E3A\u5F15\u7528\u52A0\u5165\u8F93\u5165\u6846\uFF08\u4E0D\u4F1A\u7ACB\u5373\u53D1\u9001\uFF09",
  "action.blocked": "\u8F93\u5165\u6846\u6B63\u5728\u63D0\u4EA4\uFF0C\u6682\u4E0D\u80FD\u63D2\u5165\u5F15\u7528",
  "diag.mounted": "\u5DF2\u6302\u8F7D",
  "diag.none": "\u5C1A\u672A\u6355\u83B7\u9009\u533A",
  "diag.hit": "\u547D\u4E2D\uFF0C\u53EF\u5F15\u7528",
  "diag.chip": "\u5DF2\u63D2\u5165\u5F15\u7528\u82AF\u7247",
  "diag.text": "\u5DF2\u56DE\u9000\u4E3A\u7EAF\u6587\u672C\u5F15\u7528",
  "diag.latency": "\u624B\u52BF\u5230\u51FA\u73B0"
};
var en = {
  "action.add": "Add to chat",
  "action.addHint": "Attach the selected text as a quote without sending it",
  "action.blocked": "The composer is submitting; quoting is unavailable",
  "diag.mounted": "mounted",
  "diag.none": "no selection probed yet",
  "diag.hit": "hit \u2014 quoteable",
  "diag.chip": "quote chip inserted",
  "diag.text": "fell back to plain text",
  "diag.latency": "gesture to pill"
};
var inject = ["slots", "locale", "sessions", "inputTriggers"];
var decodedQuotes = /* @__PURE__ */ new Map();
function encodeQuote(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `q.${btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")}`;
}
function decodeQuote(ref) {
  const cached = decodedQuotes.get(ref);
  if (cached !== void 0) return cached;
  let text = ref;
  try {
    const body = ref.slice(2).replace(/-/gu, "+").replace(/_/gu, "/");
    const binary = atob(body);
    text = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    text = ref;
  }
  if (decodedQuotes.size > 64) decodedQuotes.clear();
  decodedQuotes.set(ref, text);
  return text;
}
function clampQuote(text) {
  if (text.length <= MAX_QUOTE_CHARS) return text;
  return `${text.slice(0, MAX_QUOTE_CHARS)}
\u2026 (quote truncated)`;
}
function normalizeSelection(text) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
function blockquoteOf(text, kind) {
  const body = normalizeSelection(text).split("\n").map((line) => line.length === 0 ? ">" : `> ${line}`).join("\n");
  if (!INCLUDE_PROVENANCE) return body;
  return `${body}
>
> \u2014\u2014 \u6765\u81EA${SOURCE_LABEL[kind] ?? kind}`;
}
function snippetOf(text) {
  const flat = normalizeSelection(text).replace(/\s+/gu, " ");
  return flat.length <= 22 ? flat : `${flat.slice(0, 22)}\u2026`;
}
function appendQuote(draft, quote) {
  const head = draft.replace(/\s+$/u, "");
  return head.length === 0 ? quote : `${head}

${quote}`;
}
function detectEndOf(state) {
  if (state === void 0) return 0;
  let end = state.draft.length;
  for (const occurrence of state.occurrences) end -= occurrence.length - 1;
  return end;
}
var quoteCodec = {
  clipboardText: (ref) => blockquoteOf(decodeQuote(ref), "unknown"),
  serialize: async (ref) => blockquoteOf(decodeQuote(ref), "unknown")
};
function makeQuoteInserter(ctx, sessionId) {
  return (text, state) => {
    if (state === void 0) return false;
    try {
      const actx = ctx.sessions.scope(sessionId);
      if (actx === void 0) return false;
      const conversation = actx.get("conversation");
      const session = conversation?.input?.for(actx);
      if (session === void 0) return false;
      const ref = encodeQuote(clampQuote(text));
      const reference = {
        source: QUOTE_SOURCE,
        ref,
        label: `\u5F15\u7528\uFF1A${snippetOf(text)}`,
        clipboardText: quoteCodec.clipboardText(ref)
      };
      const end = detectEndOf(state);
      return session.insertReference(reference, { start: end, end, draftRev: state.draftRev });
    } catch (error) {
      console.warn("selection-quote: chip insertion failed", error);
      return false;
    }
  };
}
function apply(ctx) {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en });
    } catch (error) {
      console.warn("selection-quote: dictionaries already registered", error);
      return () => {
      };
    }
  }, "selection-quote: dictionaries");
  ctx.effect(
    () => ctx.inputTriggers.registerSource({
      trigger: "@",
      name: QUOTE_SOURCE,
      order: 100,
      showGroupTitle: false,
      candidates: async () => [],
      onPick: () => void 0,
      codec: quoteCodec
    }),
    "selection-quote: reference codec"
  );
  ctx.slots.inject(
    "conversation.input.overlay",
    () => ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: ENTRY_ID,
        order: 30,
        locale: NS,
        inject: (sessionId) => ({ insertQuote: makeQuoteInserter(ctx, sessionId) })
      },
      SelectionQuoteEntry
    )
  );
}
function transcriptNodeOf(range) {
  const container = range.commonAncestorContainer;
  const start = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
  if (start === null) return { miss: "no-anchor" };
  const transcript = start.closest("[data-chat-flow]");
  if (transcript === null) return { miss: "not-in-transcript" };
  const anchor = start.closest("[data-chat-anchor-key]");
  const node = anchor instanceof HTMLElement ? anchor : transcript;
  return { node, kind: node.getAttribute("data-chat-flow-kind") };
}
function probeSelection() {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return { miss: "no-selection" };
  if (selection.isCollapsed) return { miss: "collapsed" };
  const text = selection.toString().trim();
  if (text.length === 0) return { miss: "empty-text" };
  const range = selection.getRangeAt(0);
  const owner = transcriptNodeOf(range);
  if ("miss" in owner) return owner;
  const kind = owner.kind;
  if (kind !== null && NON_PROSE_KINDS.has(kind)) return { miss: `kind:${kind}` };
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return { miss: "zero-rect" };
  return {
    hit: {
      text,
      kind: kind ?? "unknown",
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }
  };
}
function sameHit(a, b) {
  return a.text === b.text && a.kind === b.kind && a.rect.left === b.rect.left && a.rect.right === b.rect.right && a.rect.top === b.rect.top && a.rect.bottom === b.rect.bottom;
}
function focusComposer() {
  requestAnimationFrame(() => {
    const seat = document.querySelector("[data-composer-seat]");
    const scope = seat ?? document;
    const editor = scope.querySelector('[contenteditable]:not([contenteditable="false"])');
    if (editor instanceof HTMLElement) editor.focus();
  });
}
function AddGlyph() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 3.4v9.2M3.4 8h9.2", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }) });
}
var SelectionQuoteGuard = class extends import_react.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("selection-quote: entry crashed", error);
  }
  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 6).join("\n") : "";
    return (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          style: {
            position: "fixed",
            zIndex: DIAGNOSTIC_Z_INDEX,
            left: "12px",
            bottom: "12px",
            maxWidth: "620px",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid var(--dsw-alias-state-error-primary)",
            background: "var(--dsw-alias-bg-overlay)",
            color: "var(--dsw-alias-label-primary)",
            font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: "pre-wrap"
          },
          children: `dsh-selection-quote crashed
${detail}

${stack}`
        }
      ),
      document.body
    );
  }
};
function SelectionQuoteEntry(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectionQuoteGuard, { t: props.t, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectionQuoteAction, { ...props }) });
}
function SelectionQuoteAction({
  useInput,
  inputActions,
  insertQuote,
  t
}) {
  const inputState = useInput((state) => state);
  const stateRef = (0, import_react.useRef)(inputState);
  stateRef.current = inputState;
  const draft = inputState?.draft ?? "";
  const phase = inputState?.phase ?? "plain";
  const [hit, setHit] = (0, import_react.useState)(null);
  const [lastMiss, setLastMiss] = (0, import_react.useState)(null);
  const [lastAction, setLastAction] = (0, import_react.useState)(null);
  const [latency, setLatency] = (0, import_react.useState)(null);
  const hitRef = (0, import_react.useRef)(null);
  const missRef = (0, import_react.useRef)(null);
  const probesRef = (0, import_react.useRef)(0);
  const gestureAt = (0, import_react.useRef)(null);
  const pointerDown = (0, import_react.useRef)(false);
  const scheduled = (0, import_react.useRef)(false);
  const pillRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    const publish = (probe) => {
      probesRef.current += 1;
      if ("hit" in probe) {
        const previous = hitRef.current;
        if (previous !== null && sameHit(previous, probe.hit)) return;
        hitRef.current = probe.hit;
        missRef.current = null;
        setHit(probe.hit);
        setLastMiss(null);
        return;
      }
      if (hitRef.current === null && missRef.current === probe.miss) return;
      hitRef.current = null;
      missRef.current = probe.miss;
      setHit(null);
      setLastMiss(probe.miss);
    };
    const retire = () => {
      if (hitRef.current === null) return;
      hitRef.current = null;
      setHit(null);
    };
    const probeNow = () => {
      if (pointerDown.current) return;
      publish(probeSelection());
    };
    const onSelectionChange = () => {
      probeNow();
    };
    const onPointerDown = (event) => {
      const pill = pillRef.current;
      if (pill !== null && event.target instanceof Node && pill.contains(event.target)) return;
      pointerDown.current = true;
      retire();
    };
    const onGestureEnd = () => {
      if (pointerDown.current) gestureAt.current = performance.now();
      pointerDown.current = false;
      probeNow();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") retire();
    };
    const onKeyUp = () => {
      probeNow();
    };
    const onReflow = () => {
      if (hitRef.current === null || scheduled.current) return;
      scheduled.current = true;
      requestAnimationFrame(() => {
        scheduled.current = false;
        if (pointerDown.current || hitRef.current === null) return;
        publish(probeSelection());
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onGestureEnd, true);
    document.addEventListener("mouseup", onGestureEnd);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onGestureEnd, true);
      document.removeEventListener("mouseup", onGestureEnd);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    if (!DIAGNOSTIC) return;
    const since = gestureAt.current;
    if (hit === null || since === null) return;
    gestureAt.current = null;
    setLatency(Math.round(performance.now() - since));
  }, [hit]);
  const blocked = phase !== "plain";
  const onAdd = (0, import_react.useCallback)(() => {
    if (hit === null || blocked) return;
    const passage = clampQuote(hit.text);
    const chipped = insertQuote(passage, stateRef.current);
    setLastAction(chipped ? "chip" : "text");
    if (!chipped) {
      inputActions?.setDraft(
        appendQuote(stateRef.current?.draft ?? "", blockquoteOf(passage, hit.kind))
      );
    }
    hitRef.current = null;
    setHit(null);
    window.getSelection()?.removeAllRanges();
    focusComposer();
  }, [blocked, hit, inputActions, insertQuote]);
  const surfaces = [];
  if (hit !== null) {
    const centre = (hit.rect.left + hit.rect.right) / 2;
    const half = 90;
    const viewport = Number.isFinite(window.innerWidth) ? window.innerWidth : 1200;
    const left = Math.min(
      Math.max(centre, half + VIEWPORT_MARGIN),
      Math.max(half + VIEWPORT_MARGIN, viewport - half - VIEWPORT_MARGIN)
    );
    const above = hit.rect.top > 56;
    const top = above ? hit.rect.top - PILL_GAP : hit.rect.bottom + PILL_GAP;
    surfaces.push(
      (0, import_react_dom.createPortal)(
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            ref: pillRef,
            "data-selection-quote": "pill",
            style: {
              position: "fixed",
              zIndex: PILL_Z_INDEX,
              left: `${String(left)}px`,
              top: `${String(top)}px`,
              transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)"
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "button",
              {
                type: "button",
                title: blocked ? t("action.blocked") : t("action.addHint"),
                "aria-label": t("action.add"),
                disabled: blocked,
                onMouseDown: (event) => {
                  event.preventDefault();
                },
                onClick: onAdd,
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 10px",
                  borderRadius: "8px",
                  border: "1px solid var(--dsw-alias-border-l1)",
                  background: "var(--dsw-alias-bg-overlay)",
                  color: "var(--dsw-alias-label-primary)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.16)",
                  font: "inherit",
                  fontSize: "13px",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                  cursor: blocked ? "not-allowed" : "pointer",
                  opacity: blocked ? 0.6 : 1
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddGlyph, {}),
                  t("action.add")
                ]
              }
            )
          },
          "pill"
        ),
        document.body
      )
    );
  }
  if (DIAGNOSTIC) {
    const status = hit === null ? `${t("diag.none")}${lastMiss === null ? "" : ` \xB7 ${lastMiss}`}` : `${t("diag.hit")} \xB7 kind=${hit.kind}`;
    const action = lastAction === null ? "" : ` \xB7 ${lastAction === "chip" ? t("diag.chip") : t("diag.text")}`;
    const timing = latency === null ? "" : ` \xB7 ${t("diag.latency")}=${String(latency)}ms`;
    surfaces.push(
      (0, import_react_dom.createPortal)(
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            style: {
              position: "fixed",
              zIndex: DIAGNOSTIC_Z_INDEX,
              right: "10px",
              bottom: "10px",
              maxWidth: "420px",
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid var(--dsw-alias-border-l1)",
              background: "var(--dsw-alias-bg-overlay)",
              color: "var(--dsw-alias-label-secondary)",
              font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
              whiteSpace: "pre-wrap",
              pointerEvents: "none"
            },
            children: `dsh-selection-quote ${t("diag.mounted")} \xB7 probes=${String(probesRef.current)}
${status}${action}${timing}`
          },
          "diagnostic"
        ),
        document.body
      )
    );
  }
  if (surfaces.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: surfaces });
}

		return module.exports;
	}
});
