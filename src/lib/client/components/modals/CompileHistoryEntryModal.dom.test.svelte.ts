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
	useInterest: () => {}
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

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
	sent.length = 0
	declared.clear()
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
		expect(sent.find((s) => s.event === "entries:update")?.data).toMatchObject(
			{ entry: { id: 21, content: "Dawn. The north road." } }
		)
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
		mounted.push(mount(CompileHistoryEntryModal, { target: host, props: props as any }))
		await settle()

		// Back/Forward on the #lore hash: the workspace now reads south, at now.
		props.branchId = SOUTH
		props.moment = null
		await settle()

		saveButton().click()
		await settle()

		expect(sent.map((s) => s.event)).not.toContain("entries:update")
		expect(sent.find((s) => s.event === "amendments:create")?.data).toMatchObject({
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
