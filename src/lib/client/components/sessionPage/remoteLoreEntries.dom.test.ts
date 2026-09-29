/**
 * Core's Lore entries, remote (R21), draws what the native panel drew for
 * the same book: the same text, the same controls, the same states —
 * loading, a paged list, an empty book, a filter, a filter that matches
 * nothing, a book that is its owner's alone (what a guest sees), a session
 * with no book, a mark set and a mark refused.
 *
 * The remote is the BUILT module (`core-catalog/dist/components/
 * lore-entries.js`), mounted by the SDK's harness as core's box. The native
 * side is `remoteLoreEntries.native.json`: what the page's old
 * `LoreEntriesPanel` drew over these cases (`loreEntriesParity.fixture.ts`),
 * recorded — and compared live with this remote, equal in every case — on
 * 2026-09-25, before the native panel was deleted (R79 "native 100%
 * replaced").
 *
 * One difference is deliberate (R77): a refused mark was a global toast
 * natively; the remote says it in the widget, in the same words.
 */
import { describe, expect, test } from "vitest"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent } from "@serene-pub/cli/testing"
import {
	PARITY_CASES,
	buttonNamed,
	drawn,
	mark,
	page,
	text,
	type Drawn,
	type PageAsk
} from "./loreEntriesParity.fixture"
import recorded from "./remoteLoreEntries.native.json"
import { coreDefaultWidgets } from "./coreWidgets"

const NATIVE = recorded as unknown as Record<string, { drawn: Drawn; toasts: Array<{ title: string; description: string }> }>
const CORE_CATALOG = realpathSync(resolve(process.cwd(), "node_modules/@serene-pub/core-catalog"))

describe("core's remote Lore entries draws what the native panel drew", () => {
	test("every recorded case is a case here, and every case was recorded", () => {
		expect(Object.keys(NATIVE).sort()).toEqual(Object.keys(PARITY_CASES).sort())
	})

	test.each(Object.keys(PARITY_CASES))("%s", async (name) => {
		const c = PARITY_CASES[name]!()
		const book = structuredClone(c.book)
		const view = await mountComponent({
			root: CORE_CATALOG,
			entry: "dist/components/lore-entries.js",
			owner: "core",
			timeoutMs: 60_000,
			context: { settings: c.settings },
			requests: (kind, params) => {
				if (kind === "session-entries") return book.silent ? new Promise(() => {}) : page(book, params as PageAsk)
				if (kind === "set-entry-marks") return mark(book, params as never)
				throw new Error(`not asked: ${kind}`)
			}
		})
		try {
			await view.settle()
			if (c.step && "check" in c.step) await view.check(`input[type='radio'][value='${c.step.check}']`)
			else if (c.step) await view.click(buttonNamed(view.root, c.step.click))
			await view.settle()
			expect(view.refused).toEqual([])
			expect(drawn(view.root)).toEqual(NATIVE[name]!.drawn)
			// What went wrong: the native's toast, word for word, is the remote's own line (R77).
			const alerts = view.queryAll("[role='alert']").map((a) => text(a))
			expect(alerts).toEqual(NATIVE[name]!.toasts.map((t) => `${t.title}: ${t.description}`))
			expect(view.errors).toEqual([])
		} finally {
			await view.unmount()
		}
	}, 120_000)
})

describe("the page mounts Lore entries remote", () => {
	test("core's own module, served at /core-ui/lore-entries, granted 'lore' for its requests", () => {
		const widget = coreDefaultWidgets().find((p) => p.id === "lore-entries")!
		expect(widget.surface).toEqual({ kind: "remote", owner: "core", component: "lore-entries" })
		expect(widget.src).toBe("/core-ui/lore-entries")
		expect(widget.grants).toEqual(["lore"])
	})
})
