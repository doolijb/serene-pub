/**
 * The two state widgets, as declarations rather than as components (R79
 * removed the third, Inventory — `retiredInventory.test.ts` holds that).
 *
 * A widget is only real when three things agree: core announces it, the
 * announcement carries the settings its panel offers, and it runs remote
 * (`/core-ui/<slug>`, R79). Any two of the three
 * ship a panel that renders the unknown-surface placeholder, or a settings card
 * with nothing on it.
 */
import { describe, expect, test } from "vitest"
import { resolveWidgetSurface } from "@serene-pub/sdk"
import { STORY_WORLD_LAYOUT } from "@serene-pub/core-catalog"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { widgetSettingsSchema } from "$lib/shared/widgets/settings"

const STATE_WIDGETS = ["stats", "world-state"] as const

const declOf = (id: string) => CORE_WIDGETS.find((w) => w.id === id)

describe.each(STATE_WIDGETS)("%s", (id) => {
	test("core announces it", () => {
		expect(declOf(id)).toBeDefined()
	})

	test("it runs remote, as core's own component (R79)", () => {
		// ⏳ World State's module is Stats' own (AUDIT B, 2026-10-17): the alias resolves to it everywhere.
		const component = id === "world-state" ? "stats" : id
		expect(resolveWidgetSurface(declOf(id)!, "core")).toEqual({ kind: "remote", owner: "core", component })
	})

	test("it declares settings, and every declared field has a default", () => {
		const decl = declOf(id)!
		const declared = Object.entries(decl.settings ?? {})
		expect(declared.length).toBeGreaterThan(0)
		for (const [key, field] of declared)
			expect(
				{ key, default: field.default },
				`${id}.${key} declares no default, so the widget would have to know its own`
			).not.toEqual({ key, default: undefined })
	})

	test("its schema carries core's own fields beside its declared ones", () => {
		const decl = declOf(id)!
		const schema = widgetSettingsSchema({
			id: decl.id,
			title: decl.title,
			channels: decl.channels,
			settings: decl.settings
		})
		expect(schema.title).toBeDefined()
		for (const key of Object.keys(decl.settings ?? {}))
			expect(schema[key]).toBeDefined()
	})
})

describe("scene portraits", () => {
	test("offers the mini bar row, off until somebody asks for it", () => {
		const decl = declOf("scene-portraits")!
		expect(decl.settings?.bars).toMatchObject({
			type: "boolean",
			default: false
		})
	})

	test("W6: who, which picture and how — the scene, its sprites, a grid unless asked; ⏳ source has no default", () => {
		const decl = declOf("scene-portraits")!
		expect(decl.settings?.who).toMatchObject({ type: "enum", of: ["scene", "recent", "pick"], default: "scene" })
		expect(decl.settings?.face).toMatchObject({ type: "enum", of: ["avatar", "sprite", "chosen"], default: "sprite" })
		expect(decl.settings?.arrangement).toMatchObject({
			type: "enum",
			of: ["row", "grid", "column", "stage"],
			default: "grid"
		})
		expect(decl.settings?.source).toMatchObject({ type: "enum", of: ["pinned", "scene"] })
		expect(decl.settings?.source?.default).toBeUndefined()
	})

	test("offers the persona beside the cast always — Scene and Recent read it (W6)", () => {
		const decl = declOf("scene-portraits")!
		expect(decl.settings?.persona).toMatchObject({ type: "boolean", default: false })
		expect(decl.settings?.persona?.showIf).toBeUndefined()
	})

	test("the Adventure layout docks it on the scene, as sprites, with bars", () => {
		// `who` is written though it is the default: an instance with nothing
		// stored about who it shows reads as a 0.6 pinned one to the page's
		// one-time pin seed (`scenePinsSeed.takesPins`).
		expect(
			(
				STORY_WORLD_LAYOUT.widgetSettings as Record<
					string,
					Record<string, unknown>
				>
			)["scene-portraits"]
		).toEqual({
			who: "scene",
			face: "sprite",
			arrangement: "grid",
			bars: true
		})
	})
})
