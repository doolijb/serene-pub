/**
 * A component's runtime error, as a remote's box reports it to whoever
 * mounted it (`ComponentMount`'s `onRuntimeError`, C6 P5) — the editor's
 * errors pane reads it.
 *
 * The worker runtime posts one string: `failed` (the module did not load or
 * its mount function threw) carries the message and then, after a newline,
 * up to six stack frames; `error` (a handler threw after mounting) carries the
 * message alone. This splits that string back at its first stack frame — a
 * V8 `    at …` line or a SpiderMonkey/JSC `fn@url:line:col` line — so a
 * multi-line message (a compile error's) stays whole.
 */
export interface ComponentRuntimeError {
	message: string
	stack?: string
}

const FRAME = /^\s+at\s|^[^\s@]*@\S+:\d+:\d+$/

export function componentRuntimeError(text: unknown): ComponentRuntimeError {
	const s = typeof text === "string" ? text : String(text ?? "")
	const lines = s.split("\n")
	const at = lines.findIndex((line, i) => i > 0 && FRAME.test(line))
	if (at < 0) return { message: s }
	return {
		message: lines.slice(0, at).join("\n"),
		stack: lines.slice(at).join("\n")
	}
}
