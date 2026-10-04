/**
 * The session page asks for the session's cast (`lorebooks:bindingList`) only
 * when the person viewing owns the session — pinned from the page's source,
 * as `streamedSessionReads.test.ts` pins its reads (the page is not
 * mountable in a test).
 *
 * The book is the host's. The server answers a guest's ask with a refusal
 * ("Lorebook not found."), which the guest's Layout toasted on every visit —
 * a sentence about the host's book, for something the guest never did.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

const PAGE = resolve(process.cwd(), "src/routes/sessions/[id]/+page.svelte")
const source = readFileSync(PAGE, "utf8")
const script = source.slice(
	source.indexOf("<script"),
	source.indexOf("</script>")
)

/** Each `$effect(() => { … })` body in the script that names `needle`. */
function effectsNaming(needle: string): string[] {
	const bodies: string[] = []
	let at = script.indexOf("$effect(")
	while (at >= 0) {
		let depth = 0
		let end = at + "$effect".length
		for (; end < script.length; end++) {
			const c = script[end]
			if (c === "(") depth++
			else if (c === ")" && --depth === 0) break
		}
		const body = script.slice(at, end + 1)
		if (body.includes(needle)) bodies.push(body)
		at = script.indexOf("$effect(", end)
	}
	return bodies
}

describe("the session's cast is the owner's to read", () => {
	test("the book id the page reads the cast by is the session's own only for its owner", () => {
		const derived = script.match(
			/const ownLorebookId = \$derived\(([\s\S]*?)\n\t\)/
		)
		expect(derived, "ownLorebookId is not declared").toBeTruthy()
		expect(derived![1]).toMatch(/sessionUserId/)
		expect(derived![1]).toMatch(/userCtx\.user\?\.id/)
		expect(derived![1]).toMatch(/sessionLorebookId/)
	})

	test("the ask and its interest both read that id, never the session's book as such", () => {
		const effects = effectsNaming('"lorebooks:bindingList"')
		expect(effects).toHaveLength(2)
		for (const body of effects) {
			expect(body).toMatch(/ownLorebookId/)
			expect(body).not.toMatch(/sessionLorebookId/)
		}
	})
})
