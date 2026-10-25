/**
 * 🚧 An entry's note: what a replaced reply wrote that stayed (RF fix 4,
 * 2026-10-23). Each write says what the reply set and what Revert puts back;
 * whoever may edit the book gets **Revert** and **Keep**, which ask the server
 * and keep nothing of their own; a refusal is said in place; a reader is told
 * who can. The list row carries a mark.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

const { emitted, listeners } = vi.hoisted(() => ({
	emitted: [] as Array<[string, any]>,
	listeners: new Map<string, Set<(msg: any) => void>>()
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	}
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: (event: string, payload: unknown) => void emitted.push([event, payload]) })
}))

import KeptImprintNote from "./KeptImprintNote.svelte"
import EntryMarks from "./EntryMarks.svelte"
import { keptImprintLine } from "./keptImprints"

const KEPT = [
	{ id: 11, field: "fields.category", label: "Category", before: "Docks", after: "Harbour", at: "2026-10-23T18:00:00.000Z" },
	{ id: 12, field: null, label: null, at: "2026-10-23T18:00:00.000Z" }
]

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	emitted.length = 0
	listeners.clear()
})
const text = (sel: string) => (document.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim()
const answer = (event: string, data: unknown) => {
	for (const h of [...(listeners.get(event) ?? [])]) h(data)
	flushSync()
}
function show(component: any, props: Record<string, unknown>) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(component, { target: host, props })
	flushSync()
}

describe("the kept note's words", () => {
	test("say what the reply set and what Revert does", () => {
		expect(keptImprintLine(KEPT[0] as any)).toBe("Category: the reply set “Harbour”. Revert puts back “Docks”.")
		expect(keptImprintLine({ ...KEPT[0], before: undefined } as any)).toBe("Category: the reply set “Harbour”. Revert clears it.")
		expect(keptImprintLine(KEPT[1] as any)).toBe("The reply added this entry. Revert removes it.")
	})
})

describe("an entry's note, written by a reply that was since replaced", () => {
	test("whoever may edit the book reverts one write; the server is asked, and the refusal of another is said in place", async () => {
		show(KeptImprintNote, { imprints: KEPT, mayEdit: true })
		expect(text("[data-kept-imprints] p")).toBe("Written by a reply that was since replaced")
		expect(text('[data-kept-imprint="11"]')).toBe("Category: the reply set “Harbour”. Revert puts back “Docks”. Keep Revert")
		;(document.querySelector('[data-kept-imprint="11"] [data-kept-revert]') as HTMLButtonElement).click()
		flushSync()
		expect(emitted).toEqual([["lorebooks:settleImprint", { imprintId: 11, choice: "revert" }]])
		expect((document.querySelector('[data-kept-imprint="12"] [data-kept-keep]') as HTMLButtonElement).disabled).toBe(true)
		answer("lorebooks:settleImprint", { imprintId: 11, lorebookId: 3, choice: "revert" })
		await tick()
		await Promise.resolve()
		flushSync()
		expect((document.querySelector('[data-kept-imprint="12"] [data-kept-keep]') as HTMLButtonElement).disabled).toBe(false)

		;(document.querySelector('[data-kept-imprint="12"] [data-kept-keep]') as HTMLButtonElement).click()
		flushSync()
		expect(emitted.at(-1)).toEqual(["lorebooks:settleImprint", { imprintId: 12, choice: "keep" }])
		answer("lorebooks:settleImprint:error", { imprintId: 12, error: "That change is no longer waiting on a decision." })
		await tick()
		await Promise.resolve()
		flushSync()
		expect(text("[data-kept-refusal]")).toBe("That change is no longer waiting on a decision.")
	})

	test("a reader sees the note without its buttons, and is told who can settle it", () => {
		show(KeptImprintNote, { imprints: KEPT, mayEdit: false })
		expect(document.querySelectorAll("[data-kept-revert], [data-kept-keep]").length).toBe(0)
		expect(text("[data-kept-imprints]")).toContain("The lorebook's owner can revert it or keep it.")
	})

	test("the list row carries the mark; a row with none does not", () => {
		show(EntryMarks, { entry: { keptImprints: KEPT }, vectorizationEnabled: true })
		expect(text("[data-kept-imprints-mark]")).toBe("replaced")
		expect(document.querySelector("[data-kept-imprints-mark]")?.getAttribute("title")).toBe("Written by a reply that was since replaced")
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		show(EntryMarks, { entry: {}, vectorizationEnabled: true })
		expect(document.querySelectorAll("[data-kept-imprints-mark]").length).toBe(0)
	})
})
