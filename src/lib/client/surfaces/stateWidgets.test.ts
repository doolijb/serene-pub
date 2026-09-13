/**
 * The three state widgets, as declarations rather than as components.
 *
 * A widget is only real when three things agree: core announces it, the
 * announcement carries the settings its panel offers, and the native registry
 * has a component under the key the announcement names. Any two of the three
 * ship a panel that renders the unknown-surface placeholder, or a settings card
 * with nothing on it.
 */
import { describe, expect, test } from "vitest"
import { ADVENTURE_LAYOUT } from "@serene-pub/core-catalog"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { widgetSettingsSchema } from "$lib/shared/widgets/settings"
import { NATIVE_SURFACES } from "./registry"

const STATE_WIDGETS = ["stats", "inventory", "world-state"] as const

const declOf = (id: string) => CORE_WIDGETS.find((w) => w.id === id)

describe.each(STATE_WIDGETS)("%s", (id) => {
	test("core announces it", () => {
		expect(declOf(id)).toBeDefined()
	})

	test("its native component is in the registry", () => {
		const decl = declOf(id)!
		expect(decl.surface.kind).toBe("native")
		expect(
			NATIVE_SURFACES[(decl.surface as { component: string }).component]
		).toBeDefined()
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

	test("draws the pins or the scene, and the pins unless asked", () => {
		const decl = declOf("scene-portraits")!
		expect(decl.settings?.source).toMatchObject({
			type: "enum",
			of: ["pinned", "scene"],
			default: "pinned"
		})
	})

	test("offers the persona only once the scene is the source", () => {
		const decl = declOf("scene-portraits")!
		expect(decl.settings?.persona).toMatchObject({
			type: "boolean",
			default: false,
			showIf: { field: "source", equals: "scene" }
		})
	})

	test("the Adventure layout docks it on the scene, with bars", () => {
		expect(
			(
				ADVENTURE_LAYOUT.widgetSettings as Record<
					string,
					Record<string, unknown>
				>
			)["scene-portraits"]
		).toMatchObject({ source: "scene", bars: true })
	})
})
