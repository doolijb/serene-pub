/**
 * The frame half of placement + events (PLAN 25). The claim under test is the
 * data contract's central one: a frame widget is a native widget minus the
 * iframe, so what crosses the port is the SAME projection the native ctx
 * carries — not a second, drifting copy of it.
 */
import { describe, expect, it } from "vitest"
import {
	projectLayout,
	type PlacementInput,
	type WidgetEvent
} from "$lib/shared/widgets/context"
import { buildEventMessage, buildLayoutMessage } from "./framePlacement"

const placement = (over: Partial<PlacementInput> = {}): PlacementInput => ({
	zone: { columns: 4, column: 1, rows: 20, row: 15 },
	box: {
		cols: 4,
		rows: 5,
		edges: { top: false, right: true, bottom: false, left: true }
	},
	tier: "compact",
	pinned: true,
	collapsed: false,
	drawered: false,
	...over
})

describe("buildLayoutMessage", () => {
	it("is `{ t: 'layout' }` carrying the projected layout.v1", () => {
		const m = buildLayoutMessage(placement())
		expect(m.t).toBe("layout")
		expect(m.layout).toEqual(projectLayout(placement()))
	})

	it("is field-for-field the native ctx's layout.v1 — one projection, two deliveries", () => {
		const p = placement({ tier: "roomy", drawered: true })
		expect(buildLayoutMessage(p).layout).toEqual(projectLayout(p))
	})

	it("is a detached copy — mutating the input afterwards can't reach the frame", () => {
		const p = placement()
		const m = buildLayoutMessage(p)
		p.zone.row = 99
		p.box.edges.top = true
		expect(m.layout.zone.row).toBe(15)
		expect(m.layout.box.edges.top).toBe(false)
	})

	it("survives structured clone — the port's only real requirement", () => {
		expect(() =>
			structuredClone(buildLayoutMessage(placement()))
		).not.toThrow()
	})
})

describe("buildEventMessage", () => {
	const created: WidgetEvent = {
		kind: "message:created",
		channel: "main",
		slug: "main",
		lane: 1,
		messageId: 12
	}

	it("wraps the event verbatim as `{ t: 'event' }`", () => {
		expect(buildEventMessage(created)).toEqual({ t: "event", event: created })
	})

	it("is a copy — the host's event object never crosses by reference", () => {
		const e = { ...created }
		const m = buildEventMessage(e)
		e.messageId = 99
		expect(m.event).toMatchObject({ messageId: 12 })
	})

	it("survives structured clone", () => {
		expect(() => structuredClone(buildEventMessage(created))).not.toThrow()
		expect(() =>
			structuredClone(
				buildEventMessage({
					kind: "layout:changed",
					layout: projectLayout(placement())
				})
			)
		).not.toThrow()
	})
})
