/**
 * Advanced controls off leaves core's *Branch from here* out of every venue,
 * and turning it on brings it back with no new push (2026-11-10).
 */
import { describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { createActionList } from "./actionList.svelte"

const action = (key: string, over: Record<string, unknown> = {}) => ({
	key,
	specSlug: "core",
	name: key,
	slash: key,
	quick: false,
	audience: { see: ["participant"], act: ["participant"] },
	origin: "core",
	floor: false,
	canAct: true,
	itemGated: false,
	isNew: false,
	enabled: true,
	venue: "message",
	...over
})
const EDIT = action("edit", { canAct: false, itemGated: true })
const BRANCH = action("branch")
const GENRE_BRANCH = action("branch", {
	specSlug: "dungeon-crawler",
	origin: "genre"
})

let advanced = $state(false)

function setup() {
	const handlers: Record<string, (m: any) => void> = {}
	const list = createActionList({
		socket: { emit() {} } as any,
		inbox: {
			on: (event: string, fn: (m: any) => void) => (handlers[event] = fn)
		} as any,
		sessionId: () => 5,
		advancedControls: () => advanced,
		data: {
			session: { id: 5, sessionMessages: [] },
			lastMessage: undefined,
			narratorName: "Narrator",
			needsPersona: false,
			sessionChannels: ["main", "sanctum"],
			messageVerbs: {},
			canControlMessage: () => false
		} as any
	})
	const push = (m: Record<string, unknown>) => {
		handlers["sessions:actions"]!({ sessionId: 5, ...m })
		flushSync()
	}
	const keys = (v: { primary: any[]; overflow: any[] }) =>
		[...v.primary, ...v.overflow].map((a) => a.key)
	return { list, push, keys }
}

describe("Branch from here follows the advanced controls switch", () => {
	test("off leaves it out, on brings it back with no new push", () => {
		advanced = false
		const { list, push, keys } = setup()
		push({ venues: { message: { primary: [EDIT], overflow: [BRANCH] } } })
		expect(keys(list.actionVenues.message!)).toEqual(["edit"])
		advanced = true
		flushSync()
		expect(keys(list.actionVenues.message!)).toEqual(["edit", "branch"])
		advanced = false
		flushSync()
		expect(keys(list.actionVenues.message!)).toEqual(["edit"])
	})

	test("an emptied venue stays present", () => {
		advanced = false
		const { list, push } = setup()
		push({ venues: { message: { primary: [BRANCH], overflow: [] } } })
		expect(list.actionVenues.message).toEqual({ primary: [], overflow: [] })
	})

	test("another channel's listing follows the switch too", () => {
		advanced = false
		const { list, push, keys } = setup()
		push({
			channel: "sanctum",
			venues: { message: { primary: [BRANCH], overflow: [] } }
		})
		expect(keys(list.venueOn("message", "sanctum"))).toEqual([])
		advanced = true
		flushSync()
		expect(keys(list.venueOn("message", "sanctum"))).toEqual(["branch"])
		advanced = false
	})

	test("a genre action keyed branch is never filtered", () => {
		advanced = false
		const { list, push, keys } = setup()
		push({ venues: { message: { primary: [GENRE_BRANCH], overflow: [] } } })
		expect(keys(list.actionVenues.message!)).toEqual(["branch"])
	})
})
