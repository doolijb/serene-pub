import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { SHIPPED_CONTEXT_TEMPLATE } from "./contextTemplateDefaults"
import { SHIPPED_VARIABLE_TEMPLATES, wrapFor } from "./variableLayouts"

/**
 * The headings and fences 0.6 took out of the context template are exactly the
 * ones the shipped layouts put back.
 *
 * Two strings now exist that are supposed to differ: `context_configs` holds
 * what 0.5 shipped, frozen; `pipeline_context_templates` holds 0.6's. That is
 * the whole reframing, and it is also the easiest thing in the release to get
 * silently wrong, because *any* difference between them looks intentional. This
 * pins the difference to precisely one thing: put each layout's wrapper back
 * around the variable it renders, and you must land on 0.5's template character
 * for character.
 *
 * Not covered by anything else. The layout parity test proves each shipped row
 * reproduces its own in-code expression — it would stay green if a heading were
 * dropped from *both* sides. The corpus proves whole prompts match, but needs a
 * database and several seconds and tells you *that* something diverged rather
 * than which byte.
 *
 * 0.5's is read from disk rather than imported because `defaults.ts` opens a
 * database connection at import — the same trick `docsContextTemplate.test`
 * uses. 0.6's imports cleanly, which is why `contextTemplateDefaults.ts` has no
 * schema import.
 */

const TEMPLATE_START = "export const DEFAULT_CONTEXT_TEMPLATE = `"

function legacyTemplate(): string {
	const source = readFileSync(
		resolve(__dirname, "../db/legacyContextTemplate.ts"),
		"utf8"
	)
	const start = source.indexOf(TEMPLATE_START)
	if (start === -1)
		throw new Error("DEFAULT_CONTEXT_TEMPLATE is no longer declared here")
	let i = start + TEMPLATE_START.length
	// The closing backtick of the literal — the fences inside it are escaped,
	// so an unescaped one ends the string.
	while (source[i] !== "`" || source[i - 1] === "\\") i++
	return source
		.slice(start + TEMPLATE_START.length, i)
		.replace(/\\`/g, "`")
		.replace(/\\\$/g, "$")
}

describe("the wrappers moved without changing", () => {
	it("rebuilds 0.5's template from 0.6's plus the shipped layouts", () => {
		let rebuilt = SHIPPED_CONTEXT_TEMPLATE

		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			const wrap = wrapFor(t.key)
			if (!wrap) continue
			const bare = `{{{${t.key}}}}`
			const block = `{{#if ${t.key}}}\n${bare}\n{{/if}}`
			// Only inside its own `{{#if}}`, not every mention: `characters`
			// also appears in the block's condition, and a blind replace would
			// wrap that too.
			if (!rebuilt.includes(block)) continue
			rebuilt = rebuilt.replace(
				block,
				`{{#if ${t.key}}}\n${wrap(bare)}\n{{/if}}`
			)
		}

		expect(rebuilt).toBe(legacyTemplate())
	})

	it("still reads every wrapped variable through a triple stash", () => {
		// A wrapped value carries the fence's own `"""` and backticks. Read
		// through `{{x}}` rather than `{{{x}}}` those arrive HTML-escaped, so
		// the prompt gets `&quot;&quot;&quot;` where 0.5 had a fence. The
		// shipped template got this right before the move because the JSON
		// inside needed it; it has to keep being right for a new reason.
		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			if (!wrapFor(t.key)) continue
			if (!SHIPPED_CONTEXT_TEMPLATE.includes(`{{{${t.key}}}}`)) continue
			expect(
				SHIPPED_CONTEXT_TEMPLATE.includes(`{{${t.key}}}`) &&
					!SHIPPED_CONTEXT_TEMPLATE.includes(`{{{${t.key}}}}`),
				`${t.key} is read through a double stash`
			).toBe(false)
		}
	})
})
