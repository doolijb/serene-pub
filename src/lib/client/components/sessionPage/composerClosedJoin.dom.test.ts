/**
 * 🚧 A guest's composer before they have a character (2026-10-16): when the
 * genre closed the composer, its waiting reason wins over "Add your
 * persona" — the Dungeon Crawler's Story and Planner say "Waiting: …".
 * Core's conversation is the BUILT module, mounted by the SDK's harness.
 */
import { describe, expect, test } from "vitest"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent } from "@serene-pub/cli/testing"
import { componentParitySections } from "@serene-pub/conformance"

const CORE_CATALOG = realpathSync(resolve(process.cwd(), "node_modules/@serene-pub/core-catalog"))
const JOIN = '[data-widget-part~="messages.join"]'

async function open(composer: Record<string, unknown>) {
	const sections = componentParitySections() as any
	const full = sections.scoped.session_full
	const view = await mountComponent({
		root: CORE_CATALOG,
		entry: "dist/components/messages.js",
		owner: "core",
		coreConversation: true,
		timeoutMs: 60_000,
		requests: () => new Promise(() => {}),
		context: {
			...sections,
			scoped: { session_full: { ...full, composer: { ...full.composer, ...composer } } }
		} as never
	})
	await view.settle()
	return view
}

describe("a closed composer's reason wins over the join prompt", () => {
	test("closed: no 'Add your persona', the waiting reason stands", async () => {
		const view = await open({ addPersona: true, closed: { "*": { reason: "Ann is choosing her class" } } })
		try {
			expect(view.query(JOIN)).toBeNull()
			expect(view.query("sp-composer-field")?.getAttribute("placeholder")).toBe(
				"Waiting: Ann is choosing her class"
			)
		} finally {
			await view.unmount()
		}
	}, 120_000)

	test("open: the join prompt is still the guest's one thing to do", async () => {
		const view = await open({ addPersona: true })
		try {
			expect(view.query(JOIN)).not.toBeNull()
		} finally {
			await view.unmount()
		}
	}, 120_000)
})
