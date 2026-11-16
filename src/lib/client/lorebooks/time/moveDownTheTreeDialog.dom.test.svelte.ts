/**
 * Move down the tree: the lines on offer and why one is out of reach, what the
 * move takes along and says, and the confirm, a refusal and Cancel.
 *
 * Lines: main <- A (forked at Year 3) <- B (forked at Year 5).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { asks, reply } = vi.hoisted(() => ({
	asks: [] as Array<{ event: string; params: any }>,
	reply: { fail: null as string | null }
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async (o: { event: string; params: any }) => {
		asks.push({ event: o.event, params: o.params })
		if (reply.fail) throw new Error(reply.fail)
		return { lorebookId: o.params.lorebookId, ...o.params }
	}
}))

import MoveDownTheTreeDialog from "./MoveDownTheTreeDialog.svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"
import { openBookTime } from "./bookTime.svelte"

const BOOK = 7
const branch = (
	id: number,
	name: string,
	from: number | null,
	forkYear: number
) => ({
	id,
	lorebookId: BOOK,
	name,
	forkedFromBranchId: from,
	forkYear,
	forkMonth: null,
	forkDay: null
})

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
	asks.length = 0
	reply.fail = null
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, [
		branch(1, "A", null, 3),
		branch(2, "B", 1, 5)
	])
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	openBookTime.open(null)
})

const row = (id: number, name: string, over: Record<string, any> = {}) => ({
	id,
	name,
	typeId: 1,
	branchId: 2,
	anchorEntryId: null,
	...over
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function draw(
	rows: Record<string, any>[],
	over: {
		entryId?: number
		entryIds?: number[]
		prefer?: { branchId: number | null }
		dirty?: boolean
		timeline?: boolean
	} = {}
) {
	const onClose = vi.fn()
	const onMoved = vi.fn()
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				rawRows: { entries: rows },
				timelineEnabled: over.timeline ?? true
			}) as any
	)
	app = mount(MoveDownTheTreeDialog, {
		target: document.body,
		props: {
			open: true,
			lorebookId: BOOK,
			...(over.entryIds
				? { entryIds: over.entryIds }
				: { entryId: over.entryId ?? rows[0].id }),
			prefer: over.prefer,
			dirty: over.dirty ?? false,
			onClose,
			onMoved
		},
		context: bookDataContext(data)
	})
	await settle()
	return { onClose, onMoved }
}

const radios = () =>
	[
		...document.body.querySelectorAll<HTMLInputElement>(
			'input[type="radio"]'
		)
	].map((r) => ({
		label: r.closest("label")?.textContent?.replace(/\s+/g, " ").trim(),
		disabled: r.disabled,
		checked: r.checked,
		why: r.getAttribute("aria-describedby")
			? document
					.getElementById(r.getAttribute("aria-describedby")!)
					?.textContent?.trim()
			: undefined
	}))
const button = (label: string) =>
	[...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label
	) as HTMLButtonElement | undefined
const consequences = () =>
	[...document.body.querySelectorAll("[data-move-down-consequence]")].map(
		(p) => p.textContent?.trim()
	)
const confirmButton = () =>
	[...document.body.querySelectorAll("footer button")].pop() as
		| HTMLButtonElement
		| undefined

describe("the lines", () => {
	test("current first, main last; the current line is disabled", async () => {
		await draw([row(10, "Gate")])
		const r = radios()
		expect(r.map((x) => x.label)).toEqual(["B Here now", "A", "main"])
		expect(r[0].disabled).toBe(true)
	})

	test("an entry dated Year 4 on B reaches A, not main", async () => {
		await draw([row(10, "Gate", { year: 4 })])
		const r = radios()
		expect(r[1]).toMatchObject({ disabled: false, checked: true })
		expect(r[2].disabled).toBe(true)
		expect(r[2].why).toBe("Gate began at Year 4; A left main at Year 3.")
		expect(confirmButton()!.textContent!.trim()).toBe("Move to A")
	})

	test("with the Timeline off the reason has no dates", async () => {
		await draw([row(10, "Gate", { year: 4 })], { timeline: false })
		expect(radios()[2].why).toBe("A left main before Gate began.")
	})

	test("a perpetual entry reaches both; the words name what changes", async () => {
		await draw([row(10, "Gate")])
		const r = radios()
		expect(r[1].disabled).toBe(false)
		expect(r[2].disabled).toBe(false)
		expect(r[1].checked).toBe(true)
		expect(consequences()).toEqual([
			"A will start reading it, and so will the sessions playing on it.",
			"Its dated changes and links written on B stay on B.",
			"It can't be moved back."
		])
	})
})

describe("entries filed under one another", () => {
	test("a child names its parent, and both go", async () => {
		await draw([row(11, "Child", { anchorEntryId: 12 }), row(12, "Parent")])
		expect(consequences()[0]).toBe(
			"Also moves Parent: entries filed under one another move together."
		)
		expect(consequences()).toContain("They can't be moved back.")
		expect(confirmButton()!.textContent!.trim()).toBe("Move 2 entries to A")
		confirmButton()!.click()
		await settle()
		expect(asks[0].params.entryIds.sort()).toEqual([11, 12])
	})
})

describe("several entries and a preferred line", () => {
	const title = () =>
		document.body
			.querySelector("[data-part='title']")
			?.textContent?.replace(/\s+/g, " ")
			.trim() ?? document.body.textContent
	test("two asked entries: the title names 2, the confirm and the emit hold both", async () => {
		await draw(
			[
				row(10, "Gate"),
				row(11, "Door"),
				row(12, "Roof", { anchorEntryId: 11 })
			],
			{
				entryIds: [10, 12]
			}
		)
		expect(title()).toContain("Move 2 entries down the tree")
		expect(document.body.textContent?.replace(/\s+/g, " ")).toContain(
			"Pick a line B was forked from. The entries move there for good."
		)
		expect(confirmButton()!.textContent!.trim()).toBe("Move 3 entries to A")
		confirmButton()!.click()
		await settle()
		expect([...asks[0].params.entryIds].sort()).toEqual([10, 11, 12])
	})
	test("two asked entries with none taken along say Move 2 entries", async () => {
		await draw([row(10, "Gate"), row(11, "Door")], { entryIds: [10, 11] })
		expect(confirmButton()!.textContent!.trim()).toBe("Move 2 entries to A")
	})
	test("prefer main checks main when it is reachable", async () => {
		await draw([row(10, "Gate")], { prefer: { branchId: null } })
		expect(radios().map((x) => x.checked)).toEqual([false, false, true])
		expect(confirmButton()!.textContent!.trim()).toBe("Move to main")
	})
	test("prefer a line with a reason falls back to the first allowed line", async () => {
		await draw([row(10, "Gate", { year: 4 })], {
			prefer: { branchId: null }
		})
		expect(radios().map((x) => x.checked)).toEqual([false, true, false])
	})
})

describe("dirty", () => {
	test("says to save first and disables the confirm", async () => {
		await draw([row(10, "Gate")], { dirty: true })
		expect(document.body.textContent).toContain(
			"Save or discard your changes first."
		)
		expect(confirmButton()!.disabled).toBe(true)
	})
})

describe("confirm and Cancel", () => {
	test("the confirm emits the exact params; the reply moves and closes", async () => {
		const { onClose, onMoved } = await draw([row(10, "Gate")])
		confirmButton()!.click()
		await settle()
		expect(asks).toEqual([
			{
				event: "amendments:moveDownTheTree",
				params: { lorebookId: BOOK, entryIds: [10], branchId: 1 }
			}
		])
		expect(onMoved).toHaveBeenCalledWith(1)
		expect(onClose).toHaveBeenCalled()
	})

	test("a refusal shows its sentence in place and the dialog stays", async () => {
		reply.fail = "Gate cannot go there."
		const { onClose, onMoved } = await draw([row(10, "Gate")])
		confirmButton()!.click()
		await settle()
		expect(
			document.body.querySelector('[role="alert"]')?.textContent?.trim()
		).toBe("Gate cannot go there.")
		expect(onClose).not.toHaveBeenCalled()
		expect(onMoved).not.toHaveBeenCalled()
		const main = [
			...document.body.querySelectorAll<HTMLInputElement>(
				'input[type="radio"]'
			)
		][2]
		main.click()
		await settle()
		expect(document.body.querySelector('[role="alert"]')).toBeNull()
	})

	test("Cancel closes and emits nothing", async () => {
		const { onClose } = await draw([row(10, "Gate")])
		button("Cancel")!.click()
		await settle()
		expect(onClose).toHaveBeenCalled()
		expect(asks).toEqual([])
	})
})
