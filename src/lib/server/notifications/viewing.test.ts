import { describe, expect, it } from "vitest"
import type { ViewingSnapshot } from "$lib/shared/notifications/covers"
import type { InterestIo } from "$lib/server/sockets/interest"
import {
	VIEWING_PROP,
	VIEWING_STRING_CAP,
	parseViewing,
	userIsViewing
} from "./viewing"

const snap = (over: Partial<ViewingSnapshot> = {}): ViewingSnapshot => ({
	pathname: "/sessions/42",
	search: "",
	pageVisible: true,
	activeView: null,
	adminHref: null,
	helpSlug: null,
	loreHash: null,
	...over
})

describe("parseViewing", () => {
	it("keeps a well-formed snapshot, field for field, and drops extras", () => {
		const raw = { ...snap({ activeView: "admin", adminHref: "/admin/data" }), extra: 1 }
		expect(parseViewing(raw)).toEqual(
			snap({ activeView: "admin", adminHref: "/admin/data" })
		)
	})

	it("null and non-objects are viewing nothing", () => {
		for (const raw of [null, undefined, 3, "x", true, [snap()]])
			expect(parseViewing(raw)).toBeNull()
	})

	it("a wrong type in any field refuses the whole snapshot", () => {
		expect(parseViewing({ ...snap(), pathname: 42 })).toBeNull()
		expect(parseViewing({ ...snap(), search: null })).toBeNull()
		expect(parseViewing({ ...snap(), pageVisible: "yes" })).toBeNull()
		expect(parseViewing({ ...snap(), activeView: 1 })).toBeNull()
		expect(parseViewing({ ...snap(), adminHref: {} })).toBeNull()
		expect(parseViewing({ ...snap(), helpSlug: [] })).toBeNull()
		const { loreHash: _, ...missing } = snap()
		expect(parseViewing(missing)).toBeNull()
	})

	it("an over-long string refuses the whole snapshot", () => {
		const long = "/" + "a".repeat(VIEWING_STRING_CAP)
		expect(parseViewing({ ...snap(), pathname: long })).toBeNull()
		expect(parseViewing({ ...snap(), loreHash: long })).toBeNull()
		const atCap = "/" + "a".repeat(VIEWING_STRING_CAP - 1)
		expect(parseViewing({ ...snap(), pathname: atCap })?.pathname).toBe(atCap)
	})
})

describe("userIsViewing", () => {
	function fakeIo(rooms: Record<number, Record<string, unknown>[]>): InterestIo {
		const sockets = new Map<string, any>()
		const roomMap = new Map<string, Set<string>>()
		let n = 0
		for (const [userId, list] of Object.entries(rooms)) {
			const ids = new Set<string>()
			for (const extra of list) {
				const id = `s${n++}`
				sockets.set(id, { id, ...extra })
				ids.add(id)
			}
			roomMap.set(`user_${userId}`, ids)
		}
		return {
			sockets: { adapter: { rooms: roomMap }, sockets }
		} as unknown as InterestIo
	}

	it("true when any tab of the user covers the href", () => {
		const io = fakeIo({
			1: [
				{ [VIEWING_PROP]: null },
				{ [VIEWING_PROP]: snap({ pathname: "/sessions/42" }) }
			]
		})
		expect(userIsViewing(1, "/sessions/42", io)).toBe(true)
		expect(userIsViewing(1, "/sessions/43", io)).toBe(false)
	})

	it("another user's tab never counts", () => {
		const io = fakeIo({ 2: [{ [VIEWING_PROP]: snap() }], 1: [] })
		expect(userIsViewing(1, "/sessions/42", io)).toBe(false)
	})

	it("a tab that never reported, or reported null, views nothing", () => {
		const io = fakeIo({ 1: [{}, { [VIEWING_PROP]: null }] })
		expect(userIsViewing(1, "/sessions/42", io)).toBe(false)
	})

	it("no io installed means nobody is viewing", () => {
		expect(userIsViewing(1, "/sessions/42", undefined)).toBe(false)
	})
})
