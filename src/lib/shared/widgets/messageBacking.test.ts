/**
 * The message backing (note 18, agreed 2026-10-02): the Card setting on the
 * messages widget is Auto / On / Off over the backing its style declares, and
 * Off means exactly that — even with an app background.
 */
import { describe, expect, it } from "vitest"
import {
	declaredBacking,
	resolveBacking,
	withLegacyBackingMode
} from "./messageBacking"
import {
	effectiveWidgetSettings,
	pruneWidgetSettings,
	settingsSections,
	widgetSettingsSchema
} from "./settings"
import { MESSAGE_STYLE_PRESETS } from "./corePresets"

const messages = { id: "messages", title: "Messages" }

describe("resolveBacking — the setting × the style × the background", () => {
	it("Off never backs, even over an app background (the bug)", () => {
		for (const declared of ["card", "glass", "none", undefined] as const)
			for (const background of [true, false])
				expect(resolveBacking({ mode: "off", declared, background })).toBe("none")
	})
	it("On backs with the style's card or glass, a card when it asks for none", () => {
		expect(resolveBacking({ mode: "on", declared: "glass", background: false })).toBe("glass")
		expect(resolveBacking({ mode: "on", declared: "card", background: false })).toBe("card")
		expect(resolveBacking({ mode: "on", declared: "none", background: true })).toBe("card")
		expect(resolveBacking({ mode: "on", declared: undefined, background: false })).toBe("card")
	})
	it("Auto follows the style's declaration", () => {
		expect(resolveBacking({ mode: "auto", declared: "glass", background: false })).toBe("glass")
		expect(resolveBacking({ mode: "auto", declared: "none", background: true })).toBe("none")
		expect(resolveBacking({ mode: "auto", declared: "card", background: false })).toBe("card")
	})
	it("Auto with a style that declares nothing: a card over a background, else none", () => {
		expect(resolveBacking({ mode: "auto", declared: undefined, background: true })).toBe("card")
		expect(resolveBacking({ mode: "auto", declared: undefined, background: false })).toBe("none")
	})
	it("an unknown stored mode reads as Auto", () => {
		expect(resolveBacking({ mode: "sideways", declared: undefined, background: true })).toBe("card")
		expect(resolveBacking({ mode: true, declared: "none", background: true })).toBe("none")
	})
})

describe("declaredBacking — what a style asks for", () => {
	it("reads --sp-backing from the stylesheet", () => {
		expect(declaredBacking({ css: '[data-widget-part~="messages.root"] { --sp-backing: glass; }' })).toBe("glass")
		expect(declaredBacking({ css: "x{--sp-backing:none}" })).toBe("none")
	})
	it("the last declaration wins, as the cascade would", () => {
		expect(declaredBacking({ css: "a{--sp-backing: card;} b{--sp-backing: glass;}" })).toBe("glass")
	})
	it("comments and unknown values declare nothing", () => {
		expect(declaredBacking({ css: "/* --sp-backing: glass; */ a{color:red}" })).toBeUndefined()
		expect(declaredBacking({ css: "a{--sp-backing: frosted;}" })).toBeUndefined()
		expect(declaredBacking({ css: "a{--sp-backing-x: glass;}" })).toBeUndefined()
		expect(declaredBacking(null)).toBeUndefined()
	})
	it("reads a var too", () => {
		expect(declaredBacking({ css: "", vars: { "--sp-backing": "card" } })).toBe("card")
		expect(declaredBacking({ css: "", vars: { "sp-backing": "glass" } })).toBe("glass")
	})
	it("the shipped styles: Cameo carries its own glass cards; the rest declare nothing", () => {
		const by = Object.fromEntries(MESSAGE_STYLE_PRESETS.map((p) => [p.slug, declaredBacking(p)]))
		expect(by).toEqual({
			default: undefined,
			bubbles: undefined,
			novel: undefined,
			compact: undefined,
			cameo: "none"
		})
	})
})

describe("the messages widget's Card setting is a backing mode", () => {
	it("is Auto / On / Off, Auto by default, in place of the host card", () => {
		const basic = settingsSections(messages).basic
		expect(basic.map((f) => f.key)).toEqual(["title", "backingMode"])
		expect(basic[1].decl).toMatchObject({ type: "enum", label: "Card", default: "auto" })
		expect(effectiveWidgetSettings(messages, {}).backingMode).toBe("auto")
	})
	it("other widgets keep the boolean host card", () => {
		expect(widgetSettingsSchema({ id: "stats", title: "Stats" }).backingMode).toBeUndefined()
	})
	it("a stored hostCard boolean reads as On / Off", () => {
		expect(effectiveWidgetSettings(messages, { hostCard: true }).backingMode).toBe("on")
		expect(effectiveWidgetSettings(messages, { hostCard: false }).backingMode).toBe("off")
		expect(effectiveWidgetSettings(messages, { hostCard: true }).hostCard).toBeUndefined()
	})
	it("the prune stores the mapped mode (so the reconcile migrates it) and drops nothing", () => {
		const out = pruneWidgetSettings(widgetSettingsSchema(messages), { hostCard: true })
		expect(out.values).toEqual({ backingMode: "on" })
		expect(out.dropped).toEqual([])
	})
	it("a stored mode wins over a leftover boolean", () => {
		expect(withLegacyBackingMode({ hostCard: true, backingMode: "off" })).toEqual({ backingMode: "off" })
	})
})
