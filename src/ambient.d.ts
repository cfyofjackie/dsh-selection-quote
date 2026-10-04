/**
 * Ambient declarations for the browser platform seed.
 *
 * The Web shell hands every client bundle a fixed static module table
 * (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
 * `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`,
 * `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`,
 * `@deepseek-ai/dsh-client-ui-dockkit`). Those packages are not installed in a
 * profile's `node_modules` — the shell inlines them — so a plugin cannot get
 * their types from disk. Only the handful of symbols this plugin actually uses
 * are declared here.
 */

declare module 'react' {
  export type ReactNode = unknown
  export interface CSSProperties {
    [key: string]: string | number | undefined
  }
  export interface RefObject<T> {
    current: T
  }
  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void]
  export function useRef<T>(initial: T): RefObject<T>
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useCallback<F extends (...args: never[]) => unknown>(fn: F, deps: readonly unknown[]): F
  export class Component<P = unknown, S = unknown> {
    constructor(props: P)
    props: P
    state: S
    render(): ReactNode
  }
}

declare module 'react-dom' {
  import type { ReactNode } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): unknown
}

declare module 'react/jsx-runtime' {
  export const jsx: unknown
  export const jsxs: unknown
  export const Fragment: unknown
}

declare module '@deepseek-ai/cordis' {
  /** The per-Session input facade this plugin writes through. */
  export interface SessionInput {
    /**
     * Insert one atomic reference chip.
     * @param reference - the reference to place.
     * @param span - detect-coordinate span guarded by the input revision.
     * @returns whether the edit applied.
     */
    insertReference(reference: ReferenceInsert, span: TokenSpan): boolean
  }

  /** Draft span in detect coordinates, guarded by the input revision. */
  export interface TokenSpan {
    readonly start: number
    readonly end: number
    readonly draftRev: number
  }

  /** Structured reference inserted by a trigger source. */
  export interface ReferenceInsert {
    readonly source: string
    readonly ref: string
    readonly label: string
    readonly appearance?: 'session' | 'file' | 'folder'
    readonly clipboardText: string
  }

  /** One reference source; only the members this plugin supplies are declared. */
  export interface TriggerSource {
    trigger: '/' | '@'
    name: string
    order?: number
    showGroupTitle?: boolean
    candidates(session: unknown, request: unknown): Promise<readonly unknown[]>
    onPick(pick: unknown): unknown
    codec?: {
      clipboardText(ref: string): string
      serialize(ref: string, signal: AbortSignal): Promise<string>
    }
  }

  /** The slice of a Cordis context this plugin's client half uses. */
  export interface Context {
    effect(callback: () => void | (() => void), label?: string): void
    get(name: string): ConversationService | undefined
    locale: {
      register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    }
    sessions: {
      /** Session-scoped context, absent when that Session has no live scope. */
      scope(sessionId: string): Context | undefined
    }
    inputTriggers: {
      registerSource(source: TriggerSource): () => void
    }
    slots: {
      inject(key: string, callback: () => () => void): () => void
      register(options: SlotRegistrationOptions, component: unknown): () => void
    }
  }

  /** The scope-addressed conversation face, cut to the members this plugin reads. */
  export interface ConversationService {
    readonly input: { for(actx: Context): SessionInput }
  }

  export interface SlotRegistrationOptions {
    name: string
    id: string
    order?: number
    label?: string
    locale?: string
    inject?: (sessionId: string) => Record<string, unknown>
  }
}
