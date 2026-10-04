import { describe, expect, it } from "vitest"
import { objectHistoryHref, objectHref, objectName, whenSince } from "./logbookView"
import type { LogbookRecordView } from "$lib/shared/adminLogbook"

const rec = (over: Partial<LogbookRecordView>): LogbookRecordView => ({
	id: 1,
	at: "2026-10-02T10:00:00.000Z",
	actorUserId: 1,
	actorName: "Ada",
	event: "connections:update",
	objectType: "connection",
	objectId: "12",
	objectLabel: "Local",
	action: "change",
	summary: "Changed connection “Local”",
	changes: [],
	...over
})

describe("whenSince (the When facet)", () => {
	const now = new Date(2026, 9, 15, 14, 30) // 15 Oct 2026, local
	it("starts each range at local midnight", () => {
		expect(whenSince("today", now)).toBe(new Date(2026, 9, 15).toISOString())
		expect(whenSince("past-7-days", now)).toBe(new Date(2026, 9, 8).toISOString())
		expect(whenSince("this-month", now)).toBe(new Date(2026, 9, 1).toISOString())
		expect(whenSince("this-year", now)).toBe(new Date(2026, 0, 1).toISOString())
	})
	it("is no bound for Any date or an unknown value", () => {
		expect(whenSince("", now)).toBeNull()
		expect(whenSince("last-decade", now)).toBeNull()
	})
})

describe("a record's object", () => {
	it("names a singleton once and an object by kind and label", () => {
		expect(objectName("pub", "pub settings")).toBe("Pub settings")
		expect(objectName("connection", "Local")).toBe("connection “Local”")
	})
	it("links to the object's page unless it was deleted", () => {
		expect(objectHref(rec({}))).toBe("/admin/connections/12")
		expect(objectHref(rec({ action: "delete" }))).toBeNull()
		expect(objectHref(rec({ objectType: "theme" }))).toBeNull()
	})
	it("links to the object's history with the change form's address", () => {
		expect(objectHistoryHref(rec({}))).toBe("/admin/history?type=connection&id=12")
		expect(objectHistoryHref(rec({ objectType: "pub", objectId: null }))).toBe(
			"/admin/history?type=pub&id="
		)
	})
})
