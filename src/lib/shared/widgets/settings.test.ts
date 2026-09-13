import { describe, expect, it } from "vitest"
import {
	BEHAVIOUR_GROUP,
	CORE_SETTING_KEYS,
	effectiveWidgetSettings,
	pruneWidgetSettings,
	coerceSettingValue,
	settingsSections,
	resolveWidgetInstance,
	widgetLaneChannels,
	widgetSettingsSchema,
	widgetTitle,
	type WidgetSettingsDecl
} from "./settings"

const plain: WidgetSettingsDecl = { id: "notes", title: "Notes" }

const phone: WidgetSettingsDecl = {
	id: "phone",
	title: "Cell Phone",
	channels: ["text-messages"],
	settings: {
		density: {
			type: "enum",
			label: "Density",
			of: ["cosy", "compact"],
			default: "cosy"
		},
		autoscroll: {
			type: "boolean",
			label: "Follow new messages",
			group: BEHAVIOUR_GROUP,
			default: true
		}
	}
}

describe("widgetSettingsSchema — core keys plus what the widget declares", () => {
	it("gives every widget a title whose default is its declared label", () => {
		const schema = widgetSettingsSchema(plain)
		expect(schema.title?.type).toBe("string")
		expect(schema.title?.default).toBe("Notes")
	})

	it("offers a lane only to a widget that declares channels", () => {
		expect(widgetSettingsSchema(plain).lane).toBeUndefined()
		expect(widgetSettingsSchema(phone).lane?.default).toBe(1)
	})

	it("keeps the core keys reserved against a widget that declares them", () => {
		const schema = widgetSettingsSchema({
			...plain,
			settings: {
				title: { type: "number", label: "Mine", default: 7 }
			}
		})
		expect(schema.title?.type).toBe("string")
		expect(schema.title?.default).toBe("Notes")
	})

	it("carries the widget's own fields through unchanged", () => {
		expect(widgetSettingsSchema(phone).density?.of).toEqual([
			"cosy",
			"compact"
		])
	})
})

describe("settingsSections — progressive exposure", () => {
	it("shows only the core fields for a widget that declares none", () => {
		const s = settingsSections(plain)
		expect(s.basic.map((f) => f.key)).toEqual(["title"])
		expect(s.declared).toEqual([])
		expect(s.behaviour).toEqual([])
	})

	it("splits declared fields from the behaviour group", () => {
		const s = settingsSections(phone)
		expect(s.basic.map((f) => f.key)).toEqual([...CORE_SETTING_KEYS])
		expect(s.declared.map((f) => f.key)).toEqual(["density"])
		expect(s.behaviour.map((f) => f.key)).toEqual(["autoscroll"])
	})
})

describe("pruneWidgetSettings — deviations only, and only what is declared", () => {
	it("drops a value for a field the descriptor does not declare", () => {
		const out = pruneWidgetSettings(widgetSettingsSchema(phone), {
			density: "compact",
			retired: "x"
		})
		expect(out.values).toEqual({ density: "compact" })
		expect(out.dropped).toEqual([{ key: "retired", reason: "undeclared" }])
	})

	it("never stores a value that equals the declared default", () => {
		const out = pruneWidgetSettings(widgetSettingsSchema(phone), {
			title: "Cell Phone",
			lane: 1,
			density: "cosy"
		})
		expect(out.values).toEqual({})
		expect(out.dropped).toEqual([])
	})

	it("refuses a value the field's own declaration rules out", () => {
		const schema = widgetSettingsSchema(phone)
		const out = pruneWidgetSettings(schema, {
			density: "enormous",
			lane: 0,
			autoscroll: "yes"
		})
		expect(out.values).toEqual({})
		expect(out.dropped.map((d) => d.key).sort()).toEqual([
			"autoscroll",
			"density",
			"lane"
		])
		expect(out.dropped.every((d) => d.reason === "invalid")).toBe(true)
	})

	it("keeps a real deviation", () => {
		const out = pruneWidgetSettings(widgetSettingsSchema(phone), {
			title: "Burner",
			lane: 3
		})
		expect(out.values).toEqual({ title: "Burner", lane: 3 })
	})

	it("treats a non-object as no settings at all", () => {
		expect(
			pruneWidgetSettings(widgetSettingsSchema(phone), null).values
		).toEqual({})
	})
})

describe("effectiveWidgetSettings — the complete object a widget reads", () => {
	it("fills every declared default under the stored deviations", () => {
		expect(effectiveWidgetSettings(phone, { lane: 2 })).toEqual({
			title: "Cell Phone",
			lane: 2,
			density: "cosy",
			autoscroll: true
		})
	})

	it("ignores a stored value the descriptor stopped declaring", () => {
		expect(effectiveWidgetSettings(plain, { gone: 1 })).toEqual({
			title: "Notes"
		})
	})
})

describe("widgetTitle — the header's override", () => {
	it("falls back to the declared title", () => {
		expect(widgetTitle(phone, {})).toBe("Cell Phone")
		expect(widgetTitle(phone, { title: "   " })).toBe("Cell Phone")
	})

	it("uses the stored override when there is one", () => {
		expect(widgetTitle(phone, { title: "Burner" })).toBe("Burner")
	})
})

describe("widgetLaneChannels — the lane reaching the subscription", () => {
	it("leaves the declaration alone at the default lane", () => {
		expect(widgetLaneChannels(["text-messages", "map:2"], 1)).toEqual([
			"text-messages",
			"map:2"
		])
	})

	it("narrows every declared channel to the chosen lane", () => {
		expect(widgetLaneChannels(["text-messages", "map:2"], 3)).toEqual([
			"text-messages:3",
			"map:3"
		])
	})

	it("leaves a widget that declared no channels subscribed to the log", () => {
		expect(widgetLaneChannels([], 3)).toEqual([])
	})
})

describe("resolveWidgetInstance — the one triple a host threads", () => {
	it("hands back the declaration untouched when nothing is stored", () => {
		expect(resolveWidgetInstance(phone, undefined)).toEqual({
			title: "Cell Phone",
			channels: ["text-messages"],
			settings: {
				title: "Cell Phone",
				lane: 1,
				density: "cosy",
				autoscroll: true
			}
		})
	})

	it("threads the lane into the channels the widget subscribes to", () => {
		const r = resolveWidgetInstance(phone, { lane: 4 })
		expect(r.channels).toEqual(["text-messages:4"])
		expect(r.settings.lane).toBe(4)
	})

	it("threads the title override into the header", () => {
		expect(resolveWidgetInstance(phone, { title: "Burner" }).title).toBe(
			"Burner"
		)
	})

	it("ignores a lane stored against a widget that declares no channels", () => {
		const r = resolveWidgetInstance(plain, { lane: 4 })
		expect(r.channels).toEqual([])
		expect(r.settings).toEqual({ title: "Notes" })
	})
})

describe("coerceSettingValue — what a form control hands back", () => {
	const schema = widgetSettingsSchema(phone)

	it("reads a numeric field's string back as a number", () => {
		expect(coerceSettingValue(schema.lane!, "4")).toBe(4)
		expect(coerceSettingValue({ type: "number" }, "1.5")).toBe(1.5)
	})

	it("leaves a number that is not one alone, so the prune can refuse it", () => {
		expect(coerceSettingValue(schema.lane!, "later")).toBe("later")
	})

	it("reads a blank string field as no override at all", () => {
		expect(coerceSettingValue(schema.title!, "   ")).toBeUndefined()
		expect(coerceSettingValue({ type: "text" }, "")).toBeUndefined()
	})

	it("passes every other value through untouched", () => {
		expect(coerceSettingValue({ type: "boolean" }, false)).toBe(false)
		expect(coerceSettingValue(schema.density!, "compact")).toBe("compact")
	})
})

describe("pruneWidgetSettings — the nesting field types", () => {
	const listed = widgetSettingsSchema({
		id: "board",
		title: "Board",
		settings: {
			columns: {
				type: "list",
				item: { type: "string" },
				min: 1,
				max: 3
			},
			frame: {
				type: "object",
				fields: {
					pad: { type: "integer", min: 0 },
					note: { type: "string" }
				}
			}
		}
	})

	it("keeps a list whose elements match its item declaration", () => {
		const out = pruneWidgetSettings(listed, { columns: ["a", "b"] })
		expect(out.values).toEqual({ columns: ["a", "b"] })
	})

	it("refuses a list whose elements do not, and one of the wrong length", () => {
		expect(pruneWidgetSettings(listed, { columns: [1] }).dropped).toEqual([
			{ key: "columns", reason: "invalid" }
		])
		expect(
			pruneWidgetSettings(listed, { columns: ["a", "b", "c", "d"] })
				.dropped
		).toEqual([{ key: "columns", reason: "invalid" }])
	})

	it("checks an object's declared members and ignores the rest", () => {
		expect(
			pruneWidgetSettings(listed, { frame: { pad: 2 } }).values
		).toEqual({ frame: { pad: 2 } })
		expect(
			pruneWidgetSettings(listed, { frame: { pad: -1 } }).dropped
		).toEqual([{ key: "frame", reason: "invalid" }])
	})
})
