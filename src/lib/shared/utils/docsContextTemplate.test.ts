import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * docs/context-configs.md reproduces the built-in Default Context Config's
 * template and says it is "shown here verbatim". Nothing kept that promise, and
 * it drifted: the doc still showed a `{{narrativeGraph}}` relationships block
 * long after the real template had moved to `{{speakerRelationships}}`, so
 * anyone following the docs to build a custom template silently lost their
 * relationships block and gained a variable that no longer renders.
 *
 * This compares the two directly. If you intentionally change the default
 * template, update the fenced block in the doc in the same commit.
 */

const TEMPLATE_START = "{{#systemBlock}}"
const TEMPLATE_END = "{{/each}}"

function extractTemplate(source: string, label: string): string[] {
	const start = source.indexOf(TEMPLATE_START)
	const end = source.indexOf(TEMPLATE_END, start)
	if (start === -1 || end === -1) {
		throw new Error(
			`Could not locate the context template in ${label} — looked for ${TEMPLATE_START} … ${TEMPLATE_END}`
		)
	}
	return (
		source
			.slice(start, end + TEMPLATE_END.length)
			// defaults.ts holds the template in a backtick string, so its
			// backticks and dollar signs are escaped in the source.
			.replace(/\\`/g, "`")
			.replace(/\\\$/g, "$")
			.split("\n")
			// Trailing whitespace is not worth failing a build over.
			.map((line) => line.trimEnd())
	)
}

describe("docs/context-configs.md default template", () => {
	it("matches the real template in defaults.ts", () => {
		const root = resolve(__dirname, "../../../..")
		const real = extractTemplate(
			readFileSync(
				resolve(root, "src/lib/server/db/defaults.ts"),
				"utf8"
			),
			"src/lib/server/db/defaults.ts"
		)
		const documented = extractTemplate(
			readFileSync(resolve(root, "docs/context-configs.md"), "utf8"),
			"docs/context-configs.md"
		)
		expect(documented).toEqual(real)
	})
})
