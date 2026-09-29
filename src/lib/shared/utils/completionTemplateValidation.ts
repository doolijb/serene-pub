/**
 * What a `completion_templates` row is allowed to say — checked once, on save.
 *
 * ## Why validation is where the safety lives
 *
 * A template is DATA: a fixed prefix and a fixed suffix per role, and nothing
 * that can compute. That closure is what makes the whole set of hazards a
 * finite list of rules rather than a sandbox — every one of them below is a
 * thing the design map flagged, turned into a refusal at the one boundary a row
 * can be written through.
 *
 * Shared rather than server-only so the admin form can say the same sentence
 * before the round trip. ⚠ The client copy is a courtesy; the SERVER's call is
 * the one that decides, exactly as with every other handler in this app.
 */

import { ROLE_MARKER_PATTERN } from "$lib/shared/utils/PromptBlockFormatter"
import { BLOCK_ROLES } from "$lib/shared/constants/completionTemplates"

/** Loosely typed on purpose — this runs on a payload, not on a row. */
export interface CompletionTemplateDraft {
	key?: string | null
	name?: string | null
	renderMode?: string | null
	roles?: Record<string, { prefix?: string; suffix?: string } | null> | null
	fallbackRole?: { prefix?: string; suffix?: string } | null
	stopStrings?: unknown
}

/**
 * A slug, and lowercase.
 *
 * `connections.prompt_format` holds this string, it is the target of a foreign
 * key, and it rides the pipeline payload, the receipt and sixteen parity
 * goldens. So: no whitespace, no case that can be typed two ways, and never
 * empty — `''` is what a CLEARED format looks like, and 0097 spent an UPDATE
 * turning every one of those into NULL precisely so the two states stop being
 * spelled the same.
 */
export const TEMPLATE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Longest a marker may be. Generous; the point is to bound the column. */
const MAX_FRAMING = 512
const MAX_STOP_STRINGS = 32

const framingOf = (v: { prefix?: string; suffix?: string } | null | undefined) => ({
	prefix: typeof v?.prefix === "string" ? v.prefix : "",
	suffix: typeof v?.suffix === "string" ? v.suffix : ""
})

/**
 * The problem with this draft, as a sentence, or `null` if there is none.
 *
 * One sentence rather than a field map: every one of these is a refusal to
 * write, the form has one save button, and a list of five problems on a row
 * with three fields reads as a stack trace.
 */
export function validateCompletionTemplate(
	draft: CompletionTemplateDraft
): string | null {
	// ── key ────────────────────────────────────────────────────────────
	const key = typeof draft.key === "string" ? draft.key.trim() : ""
	if (!key)
		return (
			"A template needs a key. It is what a connection stores in " +
			"`prompt_format` and what the foreign key points at, so it cannot be blank."
		)
	if (!TEMPLATE_KEY_PATTERN.test(key))
		return (
			`'${key}' is not a usable key. Use lowercase letters, digits, '-' and '_', ` +
			`starting with a letter or digit, up to 64 characters — it is stored on every ` +
			`connection that selects this template and travels with the prompt payload.`
		)

	// ── name ───────────────────────────────────────────────────────────
	if (!(typeof draft.name === "string" && draft.name.trim()))
		return "A template needs a name — it is what the connection's format picker shows."

	// ── render mode ────────────────────────────────────────────────────
	//
	// ⚠ `role_array` is NOT admin-authorable, and this is the rule the whole
	// table's safety rests on.
	//
	// The one role-array template renders `<@role:user>` markers and then PARSES
	// THEM BACK OUT, neutralising any literal marker in user-controlled content
	// on the way — a guard held together by hand between an emitted template
	// literal, a regex source and a parser. A row that could select that mode
	// would be a row whose author defines markers the neutraliser does not know
	// about, and the guard would silently have a hole. So admin templates are
	// flat text only, and that is what makes them safe by construction rather
	// than by review.
	if (draft.renderMode != null && draft.renderMode !== "flat")
		return (
			`Render mode '${draft.renderMode}' cannot be set here. Templates you author are ` +
			`flat completion text: the role-array mode is the internal split-chat bridge, ` +
			`whose markers are emitted by hand-written code precisely so that no row can ` +
			`define one the marker neutraliser has never heard of.`
		)

	// ── framing ────────────────────────────────────────────────────────
	const fallback = framingOf(draft.fallbackRole)
	const roles = BLOCK_ROLES.map((role) => ({
		role,
		...framingOf(draft.roles?.[role] ?? draft.fallbackRole)
	}))

	/**
	 * ⚠ Defence in depth, and deliberately kept even though a flat template is
	 * never parsed back.
	 *
	 * `flat` is enforced above, so nothing here reaches `parseSplitChatPrompt`
	 * today. That is a property of two rules holding at once, and this is the
	 * cheaper of the two to keep true: a template whose delimiters happen to BE
	 * the reserved role markers is one paste away from being a prompt-injection
	 * vector the day anything downstream starts reading markers out of a flat
	 * render.
	 */
	const marker = new RegExp(ROLE_MARKER_PATTERN)
	for (const { role, prefix, suffix } of [
		...roles,
		{ role: "fallback", ...fallback }
	]) {
		for (const [what, text] of [
			["opening", prefix],
			["closing", suffix]
		] as const) {
			if (text.length > MAX_FRAMING)
				return `The ${role} ${what} is longer than ${MAX_FRAMING} characters.`
			if (marker.test(text))
				return (
					`The ${role} ${what} contains a reserved role marker. ` +
					`'<@role:…>' is how the internal split-chat bridge tags a message ` +
					`before parsing it back out, and a template that emits one could put a ` +
					`system-role message into a prompt from anywhere text is quoted.`
				)
		}
	}

	/**
	 * ⚠ A template that opens NOTHING, anywhere.
	 *
	 * Every block would be concatenated with no marker at all, so the model
	 * receives one undifferentiated wall of text with no way to tell the system
	 * prompt from a chat message. It does not error and it is not visibly empty
	 * — the prompt is full of words — which is exactly why it is refused rather
	 * than left to be discovered.
	 *
	 * Per-role emptiness is fine and is a real format: Alpaca opens the same way
	 * for every role, and a format that deliberately omits an opening for one
	 * role is the author's business. It is the ALL-of-them case that is never
	 * what anybody meant.
	 */
	if (!roles.some((r) => r.prefix) && !fallback.prefix)
		return (
			"Every role opens with nothing, so this template would run the whole prompt " +
			"together with no marker anywhere in it. Give at least one role an opening."
		)

	// ── stop strings ───────────────────────────────────────────────────
	if (draft.stopStrings !== undefined && draft.stopStrings !== null) {
		if (!Array.isArray(draft.stopStrings))
			return "Stop strings must be a list of strings."
		if (draft.stopStrings.length > MAX_STOP_STRINGS)
			return `A template may carry at most ${MAX_STOP_STRINGS} stop strings.`
		if (draft.stopStrings.some((s) => typeof s !== "string"))
			return "Stop strings must be a list of strings."
	}

	return null
}
