/**
 * 🚧 *Not yet compiled* (S-B2): the History list's group of scenes no entry
 * holds yet. ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

const { st } = vi.hoisted(() => ({
	st: {
		scenes: [] as any[],
		readOnly: false,
		branch: null as number | null,
		nav: [] as any[],
		sent: [] as { event: string; data: any }[]
	}
}))
vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("../bookData.svelte", () => ({
	getBookData: () => ({
		get lorebookId() {
			return 3
		},
		get scenes() {
			return st.scenes
		},
		get readOnly() {
			return st.readOnly
		}
	})
}))
vi.mock("../loreRoute.svelte", () => ({
	loreRoute: {
		get route() {
			return { branch: st.branch ?? undefined, moment: null }
		},
		navigate: async (a: any) => void st.nav.push(a)
	}
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, data: any) => st.sent.push({ event, data }),
		on: () => {},
		off: () => {}
	})
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: () => () => {},
	useInterest: () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success() {}, error() {}, info() {}, warning() {} }
}))

import HistoryUnfiledGroup from "./HistoryUnfiledGroup.svelte"
import { openUnfiledScene, takeUnfiledFocus } from "./unfiledFocus.svelte"

const scene = (id: number, name: string | null, over: any = {}) => ({
	id,
	name,
	lorebookId: 3,
	historyEntryId: null,
	branchId: null,
	...over
})
const at = (year: number, month: number, day: number, hour = 9) => ({
	openedStoryClockYear: year,
	openedStoryClockMonth: month,
	openedStoryClockDay: day,
	openedStoryClockHour: hour
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	st.scenes = []
	st.readOnly = false
	st.branch = null
	st.nav.length = 0
	st.sent.length = 0
	takeUnfiledFocus(3)
})
async function show() {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(HistoryUnfiledGroup, { target: host, props: { sources: [] } })
	flushSync()
	await tick()
	flushSync()
}
const norm = (s: string | null | undefined) =>
	(s ?? "").replace(/\s+/g, " ").trim()
const compileButtons = () =>
	[...document.querySelectorAll("button")].filter(
		(b) => norm(b.textContent) === "Compile"
	) as HTMLButtonElement[]

describe("the Not yet compiled group", () => {
	test("draws nothing with no unfiled scenes", async () => {
		st.scenes = [scene(1, "Filed", { historyEntryId: 5, ...at(1, 1, 1) })]
		await show()
		expect(norm(document.body.textContent)).toBe("")
	})

	test("lists the line's unfiled scenes by date, with counts and one Compile each", async () => {
		st.scenes = [
			scene(1, "The gate", at(1, 1, 2)),
			scene(2, "  ", at(1, 1, 2, 20)),
			scene(3, "Night watch"),
			scene(4, "Other line", { ...at(1, 1, 2), branchId: 7 }),
			scene(5, "Filed", { ...at(1, 1, 2), historyEntryId: 8 })
		]
		await show()
		const text = norm(document.body.textContent)
		expect(text).toContain("Not yet compiled")
		expect(text).toContain("2 scenes")
		expect(text).toContain("1 scene")
		expect(text).toContain("Undated")
		expect(text).toContain("Unnamed Scene")
		expect(text).not.toContain("Other line")
		expect(text).not.toContain("Filed")
		expect(compileButtons().length).toBe(2)
	})

	test("Compile asks by date for that day and line; Undated asks with date null", async () => {
		st.branch = 7
		st.scenes = [
			scene(1, "Fork day", { ...at(1, 1, 2), branchId: 7 }),
			scene(2, "Fork loose", { branchId: 7 })
		]
		await show()
		compileButtons()[0].click()
		flushSync()
		await tick()
		expect(st.sent.at(-1)).toEqual({
			event: "scenes:compile",
			data: {
				lorebookId: 3,
				date: { year: 1, month: 1, day: 2 },
				branchId: 7,
				moment: null,
				// Each press is its own ask (★S7-2 / build 4): the refusal and the run echo it.
				requestId: expect.any(String)
			}
		})
	})

	test("Undated asks with date null", async () => {
		st.scenes = [scene(1, "Loose")]
		await show()
		compileButtons()[0].click()
		flushSync()
		await tick()
		expect(st.sent.at(-1)?.data).toMatchObject({
			lorebookId: 3,
			date: null,
			branchId: null
		})
	})

	test("read-only: no Compile", async () => {
		st.readOnly = true
		st.scenes = [scene(1, "Loose")]
		await show()
		expect(compileButtons().length).toBe(0)
		expect(norm(document.body.textContent)).toContain("Loose")
	})

	test("a scene's name opens it in the Scenes door", async () => {
		st.scenes = [scene(9, "Loose")]
		await show()
		;(document.querySelector("[data-scene-id='9']") as HTMLElement).click()
		expect(st.nav).toEqual([
			{ type: "openEntry", scope: "scenes", entryId: 9, sceneId: 9 }
		])
	})

	test("a focus handoff marks its scene and is cleared", async () => {
		st.scenes = [scene(9, "Loose"), scene(10, "Other")]
		await openUnfiledScene({ id: 9, lorebookId: 3 })
		st.nav.length = 0
		await show()
		const mark = (id: number) =>
			document
				.querySelector(`[data-scene-id='${id}']`)
				?.getAttribute("aria-current") ?? "no"
		expect(mark(9)).toBe("true")
		expect(mark(10)).toBe("no")
		expect(takeUnfiledFocus(3)).toBe(null)
	})
})
