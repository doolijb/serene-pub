/**
 * Where a compile's review saves (plan A11 review).
 *
 * - On a branch, at now, an entry the line reads from main (or a parent
 *   line) is changed by an AMENDMENT on the branch dated at the entry's own
 *   date — never by writing the entry, which every other line reads too.
 *   The compile folded in the branch's own scenes; main must not read them.
 * - An entry that is the line's own is still written at now.
 * - The review saves at the reading the modal was OPENED at, even when the
 *   workspace's route moves underneath the open dialog.
 * - A modal hears only its own reading's compile: another line's compile of
 *   the same entry is another run.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { interestKey } from "$lib/shared/sockets/interest"

const sent: { event: string; data: any }[] = []
const bare = new Map<string, (msg: any) => void>()
const declared = new Map<string, Array<(msg: any) => void>>()

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, data: any) => sent.push({ event, data }),
		on: () => {},
		off: () => {}
	})
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		declared.set(key, [...(declared.get(key) ?? []), handler])
		return () => {
			declared.set(
				key,
				(declared.get(key) ?? []).filter((h) => h !== handler)
			)
		}
	},
	useInterest: (event: string, handler: (msg: any) => void) => {
		bare.set(event, handler)
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: () => {},
		error: () => {},
		info: () => {},
		warning: () => {}
	}
}))

import CompileHistoryEntryModal from "./CompileHistoryEntryModal.svelte"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { compileEntryStateOf } from "./compileEntryState"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"

const BOOK = 3
const NORTH = 7
const SOUTH = 9

/** Main's history entry, dated Year 4, Month 2, as the reader's line reads it. */
const mainEntry = (over: Record<string, unknown> = {}) =>
	({
		id: 21,
		lorebookId: BOOK,
		typeId: HISTORY_TYPE_ID,
		branchId: null,
		year: 4,
		month: 2,
		day: null,
		content: "The caravan set out.",
		isCompleted: false,
		...over
	}) as any

const activities = $state<any[]>([])
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
	sent.length = 0
	declared.clear()
	bare.clear()
	activities.length = 0
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function render(props: Record<string, unknown>) {
	const host = document.createElement("div")
	document.body.append(host)
	const app = mount(CompileHistoryEntryModal, {
		target: host,
		props: {
			open: true,
			onOpenChange: () => {},
			historyEntry: mainEntry(),
			activityId: "act-1",
			pendingResult: { content: "Dawn. The north road." },
			initialStep: "review",
			...props
		} as any
	})
	mounted.push(app)
	return app
}

const saveButton = () =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Save to Entry")
	) as HTMLButtonElement

describe("CompileHistoryEntryModal — where the review saves", () => {
	test("on a branch at now, main's entry is amended on the branch at its own date, not written", async () => {
		render({ branchId: NORTH, moment: null })
		await settle()

		saveButton().click()
		await settle()

		expect(sent.map((s) => s.event)).not.toContain("entries:update")
		const amend = sent.find((s) => s.event === "amendments:create")
		expect(amend?.data).toMatchObject({
			lorebookId: BOOK,
			entryId: 21,
			branchId: NORTH,
			year: 4,
			month: 2,
			day: null,
			fields: { content: "Dawn. The north road.", isCompleted: true }
		})
		// And the review says so before Save.
		expect(document.body.textContent).toContain("this line only")
	})

	test("an entry that is the line's own is written at now", async () => {
		render({
			historyEntry: mainEntry({ branchId: NORTH }),
			branchId: NORTH,
			moment: null
		})
		await settle()

		saveButton().click()
		await settle()

		expect(sent.map((s) => s.event)).not.toContain("amendments:create")
		expect(
			sent.find((s) => s.event === "entries:update")?.data
		).toMatchObject({ entry: { id: 21, content: "Dawn. The north road." } })
	})

	test("the review saves at the reading it was opened at, though the route moves under it", async () => {
		const props = $state<Record<string, unknown>>({
			open: true,
			onOpenChange: () => {},
			historyEntry: mainEntry(),
			activityId: "act-1",
			pendingResult: { content: "Dawn. The north road." },
			initialStep: "review",
			branchId: NORTH,
			moment: { year: 5, month: null, day: null }
		})
		const host = document.createElement("div")
		document.body.append(host)
		mounted.push(
			mount(CompileHistoryEntryModal, {
				target: host,
				props: props as any
			})
		)
		await settle()

		// Back/Forward on the #lore hash: the workspace now reads south, at now.
		props.branchId = SOUTH
		props.moment = null
		await settle()

		saveButton().click()
		await settle()

		expect(sent.map((s) => s.event)).not.toContain("entries:update")
		expect(
			sent.find((s) => s.event === "amendments:create")?.data
		).toMatchObject({
			branchId: NORTH,
			year: 5
		})
	})

	test("another line's compile of the same entry is not this modal's", async () => {
		render({
			activityId: null,
			pendingResult: null,
			initialStep: "running",
			branchId: NORTH,
			moment: null
		})
		await settle()

		const complete = (branchId: number | null) => {
			for (const h of declared.get(
				interestKey("scenes:compile:complete", 21)
			) ?? [])
				h({
					historyEntryId: 21,
					branchId,
					moment: null,
					content: `compiled on ${branchId}`,
					activityId: `act-${branchId}`
				})
		}
		complete(SOUTH)
		await settle()
		expect(document.body.textContent).not.toContain(`compiled on ${SOUTH}`)
		expect(saveButton()).toBeUndefined()

		complete(NORTH)
		await settle()
		expect(
			(document.querySelector("#compile-content") as HTMLTextAreaElement)
				?.value
		).toBe(`compiled on ${NORTH}`)
	})
})

describe("CompileHistoryEntryModal — compile by date", () => {
	const compileKeys = () =>
		[...declared.keys()]
			.filter((k) => k.startsWith("scenes:compile"))
			.sort()
	const dayEntry = (over: Record<string, unknown> = {}) =>
		mainEntry({ id: 40, year: 1, month: 1, day: 2, content: "", ...over })
	/**
	 * A compile activity as the server sends it, taken through the shell's one
	 * mapping — so a field the mapping drops fails these tests. By default a
	 * by-date compile of the window's asked day; `byDate: undefined` is an
	 * entry compile.
	 */
	const activity = (over: Record<string, unknown> = {}) => {
		const raw = {
			id: "a-new",
			kind: "compile_history_entry",
			userId: 1,
			historyEntryDate: "Year 1, Month 1, Day 2",
			lorebookLabel: "Book",
			startedAt: "2026-11-04T00:00:00.000Z",
			historyEntryId: 40,
			lorebookId: BOOK,
			branchId: null,
			moment: null,
			status: "running",
			byDate: { date: { year: 1, month: 1, day: 2 } },
			...over
		}
		return compileEntryStateOf(raw)
	}
	const DAY_2 = { year: 1, month: 1, day: 2 }
	const compileAsk = () => sent.find((e) => e.event === "scenes:compile")
	/** The `byDate` of an activity answering THIS window's ask: its day and the id it asked with. */
	const ownAsk = (date: StoryDate | null = DAY_2) => ({
		date,
		requestId: compileAsk()?.data.requestId as string
	})
	function renderByDate(props: Record<string, unknown> = {}) {
		const host = document.createElement("div")
		document.body.append(host)
		mounted.push(
			mount(CompileHistoryEntryModal, {
				target: host,
				context: new Map([["compileEntriesCtx", { activities }]]),
				props: {
					open: true,
					onOpenChange: () => {},
					historyEntry: undefined,
					byDate: {
						lorebookId: BOOK,
						date: { year: 1, month: 1, day: 2 }
					},
					entryOf: (id: number) =>
						id === 40 ? dayEntry() : undefined,
					activityId: null,
					pendingResult: null,
					initialStep: "running",
					branchId: NORTH,
					moment: null,
					...props
				} as any
			})
		)
	}

	test("mounting asks by date, on the line and moment", async () => {
		renderByDate()
		await settle()
		expect(sent.filter((e) => e.event === "scenes:compile")).toEqual([
			{
				event: "scenes:compile",
				data: {
					lorebookId: BOOK,
					date: { year: 1, month: 1, day: 2 },
					branchId: NORTH,
					moment: null,
					requestId: expect.any(String)
				}
			}
		])
		expect(compileKeys()).toEqual([])
	})

	test("each press is a fresh ask, with its own requestId", async () => {
		renderByDate()
		await settle()
		const first = compileAsk()?.data.requestId
		expect(typeof first).toBe("string")
		bare.get("scenes:compile:error")?.({ error: "Nope.", requestId: first })
		await settle()
		const retry = [...document.querySelectorAll("button")].find((b) =>
			/retry/i.test(b.textContent ?? "")
		) as HTMLButtonElement | undefined
		expect(retry).toBeDefined()
		retry!.click()
		await settle()
		const asks = sent.filter((e) => e.event === "scenes:compile")
		expect(asks).toHaveLength(2)
		expect(asks[1].data.requestId).not.toBe(first)
	})

	test("an activity already there is not adopted; a new matching one is", async () => {
		activities.push(activity({ id: "old", branchId: NORTH }))
		renderByDate()
		await settle()
		expect(compileKeys()).toEqual([])

		activities.push(
			activity({
				id: "a-new",
				branchId: NORTH,
				byDate: ownAsk(),
				status: "review",
				pendingResult: { content: "The gate fell." }
			})
		)
		await settle()
		expect(
			(document.querySelector("#compile-content") as HTMLTextAreaElement)
				?.value
		).toBe("The gate fell.")
		expect(compileKeys()).toEqual([
			interestKey("scenes:compile:complete", 40),
			interestKey("scenes:compile:progress", 40)
		])
	})

	test("another day's new activity is not adopted", async () => {
		renderByDate()
		await settle()
		activities.push(
			activity({
				historyEntryId: 41,
				byDate: ownAsk({ year: 1, month: 1, day: 3 }),
				branchId: NORTH,
				status: "review",
				pendingResult: { content: "x" }
			})
		)
		await settle()
		expect(compileKeys()).toEqual([])
		expect(document.querySelector("#compile-content")).toBe(null)
	})

	test("a refusal naming no entry shows before the entry is known", async () => {
		renderByDate()
		await settle()
		bare.get("scenes:compile:error")?.({
			error: "No scenes of that day are waiting to be compiled."
		})
		await settle()
		expect(document.body.textContent).toContain(
			"No scenes of that day are waiting to be compiled."
		)
	})

	test("Undated: no save while the adopted entry's row is not known", async () => {
		renderByDate({
			byDate: { lorebookId: BOOK, date: null },
			entryOf: () => undefined
		})
		await settle()
		activities.push(
			activity({
				historyEntryId: 77,
				byDate: ownAsk(null),
				branchId: NORTH,
				status: "review",
				pendingResult: { content: "The gate fell." }
			})
		)
		await settle()
		expect(
			(document.querySelector("#compile-content") as HTMLTextAreaElement)
				?.value
		).toBe("The gate fell.")

		expect(saveButton().disabled).toBe(true)
		saveButton().click()
		await settle()
		expect(
			sent.filter((s) =>
				["entries:update", "amendments:create"].includes(s.event)
			)
		).toEqual([])
	})

	test("Undated: saves where the real entry is, an amendment at its own date", async () => {
		renderByDate({
			byDate: { lorebookId: BOOK, date: null },
			entryOf: (id: number) =>
				id === 21 ? mainEntry({ content: "Old." }) : undefined
		})
		await settle()
		activities.push(
			activity({
				historyEntryId: 21,
				byDate: ownAsk(null),
				branchId: NORTH,
				status: "review",
				pendingResult: { content: "The gate fell." }
			})
		)
		await settle()

		expect(saveButton().disabled).toBe(false)
		saveButton().click()
		await settle()

		expect(sent.map((s) => s.event)).not.toContain("entries:update")
		const amend = sent.find((s) => s.event === "amendments:create")
		expect(amend?.data).toMatchObject({
			lorebookId: BOOK,
			entryId: 21,
			branchId: NORTH,
			year: 4,
			month: 2,
			day: null,
			fields: { content: "The gate fell.", isCompleted: true }
		})
		// The Year 1/1/1 stand-in is nowhere in what was sent.
		const wire = JSON.stringify(
			sent.filter((s) =>
				["entries:update", "amendments:create"].includes(s.event)
			)
		)
		expect(wire).not.toContain('"year":1,')
		expect(wire).not.toContain('"month":1,')
	})

	const undatedWindow = () =>
		renderByDate({
			byDate: { lorebookId: BOOK, date: null },
			entryOf: () => undefined
		})
	const reviewing = (over: Record<string, unknown>) =>
		activity({
			branchId: NORTH,
			status: "review",
			pendingResult: { content: "The gate fell." },
			...over
		})
	const adopted = () =>
		(document.querySelector("#compile-content") as HTMLTextAreaElement)
			?.value

	test("an Undated window adopts only an Undated compile", async () => {
		undatedWindow()
		await settle()

		activities.push(reviewing({ id: "dated", byDate: ownAsk(DAY_2) }))
		await settle()
		expect(compileKeys()).toEqual([])
		expect(adopted()).toBeUndefined()

		activities.push(reviewing({ id: "entry", byDate: undefined }))
		await settle()
		expect(compileKeys()).toEqual([])
		expect(adopted()).toBeUndefined()

		activities.push(reviewing({ id: "undated", byDate: ownAsk(null) }))
		await settle()
		expect(adopted()).toBe("The gate fell.")
	})

	test("a dated window adopts only its own day", async () => {
		renderByDate()
		await settle()

		// Another day, even on the entry the window's own day has.
		activities.push(
			reviewing({
				id: "other-day",
				historyEntryId: 40,
				byDate: ownAsk({ year: 1, month: 1, day: 3 })
			})
		)
		await settle()
		expect(compileKeys()).toEqual([])
		expect(adopted()).toBeUndefined()

		// An entry compile is never a by-date window's.
		activities.push(reviewing({ id: "entry", byDate: undefined }))
		await settle()
		expect(adopted()).toBeUndefined()

		// An Undated compile is not a dated day's.
		activities.push(reviewing({ id: "undated", byDate: ownAsk(null) }))
		await settle()
		expect(adopted()).toBeUndefined()

		// The same day with an hour is the same day.
		activities.push(
			reviewing({
				id: "same-day",
				byDate: ownAsk({ ...DAY_2, hour: 5 } as StoryDate)
			})
		)
		await settle()
		expect(adopted()).toBe("The gate fell.")
	})

	test("only the activity carrying this window's own requestId is adopted", async () => {
		renderByDate()
		await settle()

		// Its own day, line and book, but another ask's id, or none: not its answer.
		activities.push(
			reviewing({
				id: "other-ask",
				byDate: { date: DAY_2, requestId: "someone-else" }
			})
		)
		activities.push(reviewing({ id: "no-id", byDate: { date: DAY_2 } }))
		await settle()
		expect(compileKeys()).toEqual([])
		expect(adopted()).toBeUndefined()

		activities.push(reviewing({ id: "own", byDate: ownAsk() }))
		await settle()
		expect(adopted()).toBe("The gate fell.")
	})

	test("a refusal carrying this window's requestId shows though its entry is not held yet", async () => {
		// `entryOf` knows no row for entry 99, so the asked-day check alone would drop it.
		renderByDate()
		await settle()
		bare.get("scenes:compile:error")?.({
			error: "That day is already compiling.",
			historyEntryId: 99,
			requestId: compileAsk()?.data.requestId
		})
		await settle()
		expect(document.body.textContent).toContain(
			"That day is already compiling."
		)
		expect(document.body.textContent).not.toContain("Starting")
	})

	test("a refusal carrying another ask's requestId leaves the window as it was", async () => {
		renderByDate()
		await settle()
		bare.get("scenes:compile:error")?.({
			error: "Someone else's refusal.",
			requestId: "not-ours"
		})
		await settle()
		expect(document.body.textContent).not.toContain(
			"Someone else's refusal."
		)
		expect(document.body.textContent).toContain("Starting")

		bare.get("scenes:compile:error")?.({
			error: "Our refusal.",
			requestId: compileAsk()?.data.requestId
		})
		await settle()
		expect(document.body.textContent).toContain("Our refusal.")
	})

	test("an entry window ignores a refusal that carries a requestId", async () => {
		render({
			activityId: null,
			pendingResult: null,
			initialStep: "running"
		})
		await settle()
		expect(compileAsk()?.data.requestId).toBeUndefined()
		bare.get("scenes:compile:error")?.({
			error: "A by-date refusal.",
			requestId: "some-ask"
		})
		await settle()
		expect(document.body.textContent).not.toContain("A by-date refusal.")

		bare.get("scenes:compile:error")?.({ error: "Its own refusal." })
		await settle()
		expect(document.body.textContent).toContain("Its own refusal.")
	})
})
