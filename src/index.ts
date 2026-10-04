/**
 * Host half of `dsh-selection-quote`.
 *
 * The feature is entirely browser-side: it reads a text selection in the
 * transcript and appends a Markdown quote to the composer draft through the
 * Conversation input machine. The Host therefore contributes no Service, no
 * tool, no prompt section, and no session-log event — an empty plugin body is
 * the honest implementation.
 *
 * This half still has to exist: the client module system only composes a
 * browser bundle for packages that appear as Loader entries declaring
 * `dsh.client`, and a Loader entry mounts this package's main export.
 */

/** No Host service is consumed. */
export const inject = []

/**
 * Host plugin body: deliberately empty.
 *
 * Keeping the body free of side effects means enabling or disabling the
 * plugin changes only the browser composition, never Host state.
 */
export function apply(): void {}
