/**
 * The **built-in layout document** — the floor of the resolution chain
 * (session layout v2 §4.4), shared by the server's resolver and the client's
 * stage so both render the same thing when nothing else answers.
 *
 * ## Why this is a module and not a literal at each end
 *
 * The chain ends here: a session with no document of its own, on no preset,
 * whose person has no default for the genre, in a genre that ships nothing,
 * still has to draw. If the server and the stage each carried their own idea
 * of that floor they would drift, and the drift would only show on the
 * sessions nobody has customised — which is most of them.
 *
 * ## What it says
 *
 * One zone, one widget: the conversation. No sides at all rather than empty
 * ones, because an empty side still declares a rail the reader can open onto
 * nothing. `look: {}` is the statement that this takes every declared default
 * (the cell module, the gap, the card chrome) rather than the absence of one —
 * the same idiom the shipped Adventure document uses.
 *
 * It is deliberately NOT the chat genre's preset: a genre may ship its own
 * document (`CORE_LAYOUTS_V2`) and the reconciler prefers it. This is what
 * answers for every genre that ships none.
 */
import type { LayoutDoc } from "@serene-pub/sdk"

/** The widget id the floor places. Core's conversation surface. */
export const BUILT_IN_WIDGET_ID = "messages"

/**
 * The document every unconfigured session resolves to.
 *
 * Frozen at every level: it is handed to readers that may hold it for the life
 * of a page, and one of them mutating it would silently re-floor every other
 * session in the process. Callers that need to EDIT it take a structured clone
 * (`builtInLayoutDoc()`), which is also what a save path must write — a stored
 * row must never share this object.
 */
export const BUILT_IN_LAYOUT_DOC: LayoutDoc = Object.freeze({
	version: 2,
	zones: Object.freeze({
		middle: Object.freeze({
			rows: Object.freeze(["grow"]),
			cols: Object.freeze(["grow"]),
			units: Object.freeze([
				Object.freeze({
					kind: "widget",
					key: BUILT_IN_WIDGET_ID,
					widget: BUILT_IN_WIDGET_ID,
					row: Object.freeze({ start: 1, span: 1 }),
					col: Object.freeze({ start: 1, span: 1 })
				})
			])
		})
	}),
	look: Object.freeze({})
}) as LayoutDoc

/** A fresh, mutable copy of the floor — what anything that edits or stores it takes. */
export function builtInLayoutDoc(): LayoutDoc {
	return structuredClone(BUILT_IN_LAYOUT_DOC) as LayoutDoc
}
