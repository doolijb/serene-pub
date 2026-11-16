/**
 * Could exist here: the muted group at the end of an entries list.
 *
 * Lines: main <- A (forked at Year 3) <- B (forked at Year 5); reading A.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async (o: { params: any }) => o.params
}))

import CouldExistHereGroup from "./CouldExistHereGroup.svelte"
import { bookDataContext, staticBookData } from "./bookData.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import { descriptorForKind } from "./sections"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

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

const descriptor = descriptorForKind(WORLD_LORE_TYPE_ID)!
const wire = (id: number, name: string, over: Record<string, any> = {}) => ({
	id,
	lorebookId: BOOK,
	name,
	content: `${name} content`,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: 2,
	anchorEntryId: null,
	keys: [],
	...over
})
const itemOf = (source: Record<string, any>) => descriptor.toPoolItem(source)

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
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

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function draw(
	input: {
		forked?: Record<string, any>[]
		bulk?: boolean
	},
	stored: Record<string, any>[] = input.forked ?? []
) {
	const sources = new Map<string, Record<string, any>>()
	const forked = (input.forked ?? []).map((s) => {
		const i = itemOf(s)
		sources.set(i.key, s)
		return i
	})
	const props = {
		onCheck: vi.fn()
	}
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				rawRows: {
					[WORLD_LORE_TYPE_ID]: stored
				},
				timelineEnabled: true
			}) as any
	)
	app = mount(CouldExistHereGroup, {
		target: document.body,
		props: {
			forked,
			sourceOf: (i: any) => sources.get(i.key),
			descriptorOf: () => descriptor,
			bindings: [],
			vectorizationEnabled: false,
			line: 1,
			bulk: input.bulk ?? false,
			isChecked: () => false,
			...props
		} as any,
		context: bookDataContext(data)
	})
	await settle()
	return { ...props, forked }
}

const q = <T extends Element>(s: string) => [
	...document.body.querySelectorAll<T>(s)
]
const moveButton = () => q<HTMLButtonElement>("[data-could-exist-move]")[0]

describe("could exist here", () => {
	test("both lists empty: nothing is drawn", async () => {
		await draw({})
		expect(
			document.body.querySelector("[data-could-exist-here]")
		).toBeNull()
	})

	test("a forked row names its line, is muted, and moves down the tree", async () => {
		await draw({ forked: [wire(10, "Gate")] })
		expect(document.body.querySelector("h3")?.textContent).toContain(
			"Could exist here"
		)
		expect(document.body.querySelector("h3")?.textContent).toContain("1")
		expect(q("[data-could-exist-why]")[0].textContent?.trim()).toBe("On B")
		expect(
			q("[data-could-exist-row]")[0].classList.contains("opacity-50")
		).toBe(true)
		expect(moveButton().textContent?.trim()).toBe("Move down the tree…")
		expect(moveButton().disabled).toBe(false)
		moveButton().click()
		await settle()
		const radios = q<HTMLInputElement>('input[type="radio"]')
		expect(
			radios.find((r) => r.checked)?.closest("label")?.textContent
		).toContain("A")
	})

	test("a cut row is disabled with its sentence named by aria-describedby", async () => {
		await draw({ forked: [wire(10, "Gate", { year: 6 })] })
		expect(moveButton().disabled).toBe(true)
		const why = document.getElementById(
			moveButton().getAttribute("aria-describedby")!
		)
		expect(why?.textContent?.trim()).toBeTruthy()
		expect(why?.textContent).toContain("Gate")
	})

	test("pressing a forked row shows its content read-only, again hides it", async () => {
		await draw({ forked: [wire(10, "Gate")] })
		const pick = q<HTMLElement>("[data-entry-pick]")[0]
		pick.click()
		await settle()
		expect(pick.getAttribute("aria-expanded")).toBe("true")
		const readout = q("[data-could-exist-readout]")[0]
		expect(readout.textContent).toContain("Gate content")
		expect(readout.querySelector("input, textarea, select")).toBeNull()
		pick.click()
		await settle()
		expect(pick.getAttribute("aria-expanded")).toBe("false")
		expect(q("[data-could-exist-readout]")).toHaveLength(0)
	})

	test("bulk: a checkbox on the forked row only", async () => {
		const { onCheck } = await draw({
			bulk: true,
			forked: [wire(10, "Gate")]
		})
		const boxes = q<HTMLInputElement>('input[type="checkbox"]')
		expect(boxes).toHaveLength(1)
		expect(boxes[0].getAttribute("aria-label")).toBe("Select Gate")
		expect(boxes[0].classList.contains("pointer-coarse:size-6")).toBe(true)
		boxes[0].click()
		expect(onCheck).toHaveBeenCalledWith(expect.anything(), true)
	})
})
