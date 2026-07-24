/**
 * Character Card V3 curly-brace macros (CBS) that aren't already covered by
 * plain Handlebars variable lookup — {{char}}/{{user}} already work today
 * since InterpolationEngine's context provides those keys directly, and
 * they don't match CBS_MACRO_PATTERN below so they pass through untouched.
 *
 * V3's colon/comma macro syntax (e.g. `{{random:A,B,C}}`) isn't valid
 * Handlebars on its own, so translateCardMacros() rewrites it into a real
 * Handlebars helper call before compilation. Spec:
 * https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md
 */

import type Handlebars from "handlebars"

const CBS_MACRO_PATTERN =
	/\{\{\s*(random|pick|roll|reverse|comment|hidden_key|\/\/)\s*:?\s*([^}]*)\}\}/gi

/** Splits macro args on unescaped commas per the spec's "," escaped with "\," rule. */
function splitEscapedCommas(raw: string): string[] {
	return raw
		.split(/(?<!\\),/)
		.map((s) => s.replace(/\\,/g, ",").trim())
		.filter((s) => s.length > 0)
}

export function translateCardMacros(template: string): string {
	return template.replace(CBS_MACRO_PATTERN, (match, name: string, argsRaw: string) => {
		const macro = name.toLowerCase()
		const arg = argsRaw.trim()

		switch (macro) {
			case "//":
				return `{{cardHidden ${JSON.stringify(arg)}}}`
			case "comment":
				return `{{cardComment ${JSON.stringify(arg)}}}`
			case "hidden_key":
				return `{{cardHiddenKey ${JSON.stringify(arg)}}}`
			case "reverse":
				return `{{cardReverse ${JSON.stringify(arg)}}}`
			case "roll":
				return `{{cardRoll ${JSON.stringify(arg)}}}`
			case "random":
			case "pick": {
				const args = splitEscapedCommas(argsRaw).map((a) =>
					JSON.stringify(a)
				)
				if (args.length === 0) return match
				const helper = macro === "random" ? "cardRandom" : "cardPick"
				return `{{${helper} ${args.join(" ")}}}`
			}
			default:
				return match
		}
	})
}

export function registerCardMacroHelpers(handlebars: typeof Handlebars) {
	if ((handlebars.helpers as Record<string, unknown>).cardRandom) return // already registered on this instance

	handlebars.registerHelper("cardRandom", (...args: unknown[]) => {
		const values = args.slice(0, -1) as string[] // last arg is Handlebars options
		if (values.length === 0) return ""
		return values[Math.floor(Math.random() * values.length)]
	})

	handlebars.registerHelper("cardRoll", (spec: unknown) => {
		const m = /^d?(\d+)$/i.exec(String(spec).trim())
		const max = m ? parseInt(m[1], 10) : NaN
		if (!max || max < 1) return String(spec)
		return String(1 + Math.floor(Math.random() * max))
	})

	handlebars.registerHelper("cardReverse", (value: unknown) =>
		[...String(value)].reverse().join("")
	)

	// {{// ...}} and {{comment: ...}} both render as empty — this app has no
	// inline chat-comment display to distinguish them for.
	handlebars.registerHelper("cardHidden", () => "")
	handlebars.registerHelper("cardComment", () => "")
	// Spec: hidden_key content SHOULD remain usable for lorebook keyword
	// scanning (unlike `//`), even though it's invisible in the rendered
	// prompt. Kept as its own helper (not aliased to cardHidden) so a future
	// pass can special-case it if content-text keyword scanning is added —
	// this app's keyword engine currently scans entry.keys metadata, not
	// entry body text, so the distinction is inert for now.
	handlebars.registerHelper("cardHiddenKey", () => "")
	// Not implemented: the spec wants pick to resolve to the same value
	// across repeated occurrences "for the same prompt" (unlike random),
	// which needs a stable seed (e.g. derived from message id) that doesn't
	// exist yet in this pipeline. Recognized so it doesn't throw and blank
	// out an entire field's interpolation, but always renders empty.
	handlebars.registerHelper("cardPick", () => "")
}
