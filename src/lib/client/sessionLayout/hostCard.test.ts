import { describe, expect, test } from "vitest"
import { hostCardShown } from "./hostCard"
import { withHostCard, UNPLACED, projectLayout } from "$lib/shared/widgets/context"
import { effectiveWidgetSettings, settingsSections } from "$lib/shared/widgets/settings"

describe("hostCardShown — the setting × the popover (ruled 2026-09-27)", () => {
	test("pinned, setting unset: flush", () => {
		expect(hostCardShown({ setting: undefined, popover: false })).toBe(false)
	})
	test("pinned, setting off: flush", () => {
		expect(hostCardShown({ setting: false, popover: false })).toBe(false)
	})
	test("pinned, setting on: carded", () => {
		expect(hostCardShown({ setting: true, popover: false })).toBe(true)
	})
	test("a popover is carded whatever the setting says", () => {
		expect(hostCardShown({ setting: undefined, popover: true })).toBe(true)
		expect(hostCardShown({ setting: false, popover: true })).toBe(true)
		expect(hostCardShown({ setting: true, popover: true })).toBe(true)
	})
	test("anything but a real true is off (a stored value is untrusted)", () => {
		expect(hostCardShown({ setting: "on", popover: false })).toBe(false)
		expect(hostCardShown({ setting: 1, popover: false })).toBe(false)
	})
})

describe("the Card setting is universal and off by default", () => {
	const decl = { id: "stats", title: "Stats" }
	test("every widget offers it among the core fields", () => {
		const basic = settingsSections(decl).basic.map((f) => f.key)
		expect(basic).toContain("hostCard")
		expect(settingsSections(decl).basic.find((f) => f.key === "hostCard")?.decl)
			.toMatchObject({ type: "boolean", label: "Card", default: false })
	})
	test("the effective settings say off until someone turns it on", () => {
		expect(effectiveWidgetSettings(decl, {}).hostCard).toBe(false)
		expect(effectiveWidgetSettings(decl, { hostCard: true }).hostCard).toBe(true)
	})
	test("a widget cannot redeclare it", () => {
		const own = {
			...decl,
			settings: { hostCard: { type: "string" as const, label: "Mine", default: "x" } }
		}
		expect(effectiveWidgetSettings(own, {}).hostCard).toBe(false)
	})
})

describe("withHostCard — what the widget is told", () => {
	test("carded: card, background and wrapper on, title bar unless withheld", () => {
		const c = projectLayout(withHostCard(UNPLACED, true)).chrome
		expect(c).toMatchObject({ card: true, background: true, wrapper: true, titleBar: true })
		expect(projectLayout(withHostCard(UNPLACED, true, false)).chrome.titleBar).toBe(false)
	})
	test("flush: the host paints nothing", () => {
		const pinned = { ...UNPLACED, pinned: true }
		const c = projectLayout(withHostCard(pinned, false)).chrome
		expect(c).toMatchObject({ card: false, background: false, wrapper: false, titleBar: false })
	})
	test("no placement is the unplaced one, told its card", () => {
		const p = withHostCard(undefined, true)
		expect(p.zone).toEqual(UNPLACED.zone)
		expect(p.chrome?.card).toBe(true)
	})
	test("an untold placement is flush", () => {
		expect(projectLayout(UNPLACED).chrome.card).toBe(false)
	})
})
