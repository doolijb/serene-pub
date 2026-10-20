import { describe, expect, it } from "vitest"
import {
	CORE_SETTING_KEYS,
	effectiveWidgetSettings,
	pruneWidgetSettings,
	widgetSettingDeviations,
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
			group: "Behaviour",
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

describe("settingsSections — core's, the widget's own, then one section per group", () => {
	it("shows only the core fields for a widget that declares none", () => {
		const s = settingsSections(plain)
		expect(s.basic.map((f) => f.key)).toEqual(["title", "hostCard"])
		expect(s.declared).toEqual([])
		expect(s.groups).toEqual([])
	})

	it("puts ungrouped fields under no heading and a grouped one under its group", () => {
		const s = settingsSections(phone)
		expect(s.basic.map((f) => f.key)).toEqual(["title", "lane", "hostCard"])
		expect(CORE_SETTING_KEYS).toContain("backingMode")
		expect(s.declared.map((f) => f.key)).toEqual(["density"])
		expect(s.groups.map((g) => [g.heading, g.fields.map((f) => f.key)])).toEqual([
			["Behaviour", ["autoscroll"]]
		])
	})

	it("one section per distinct group, in order of first appearance; fields in declaration order", () => {
		const log: WidgetSettingsDecl = {
			id: "log",
			title: "Log",
			settings: {
				channel: { type: "string", label: "Channel", group: "Channel" },
				showAvatars: { type: "boolean", label: "Faces", group: "Reading" },
				compact: { type: "boolean", label: "Compact" },
				nextUp: { type: "boolean", label: "Next up", group: "Turns" },
				showTimestamps: { type: "boolean", label: "Times", group: "Reading" },
				untitled: { type: "boolean", label: "Untitled", group: "  " }
			}
		}
		const s = settingsSections(log)
		// A blank group is no group.
		expect(s.declared.map((f) => f.key)).toEqual(["compact", "untitled"])
		expect(s.groups.map((g) => [g.heading, g.fields.map((f) => f.key)])).toEqual([
			["Channel", ["channel"]],
			["Reading", ["showAvatars", "showTimestamps"]],
			["Turns", ["nextUp"]]
		])
	})

	it("the heading is the group string verbatim — a lowercase one is not folded or recased", () => {
		const s = settingsSections({
			id: "x",
			title: "X",
			settings: { a: { type: "boolean", label: "A", group: "behaviour" } }
		})
		expect(s.groups.map((g) => g.heading)).toEqual(["behaviour"])
		expect(s.declared).toEqual([])
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

describe("effectiveWidgetSettings — the one reader of every store", () => {
	const defaults = {
		title: "Cell Phone",
		lane: 1,
		hostCard: false,
		density: "cosy",
		autoscroll: true
	}

	it("is the declared defaults when nothing is stored", () => {
		expect(effectiveWidgetSettings({ decl: phone })).toEqual(defaults)
		expect(
			effectiveWidgetSettings({ decl: phone, preset: {}, stored: {} })
		).toEqual(defaults)
	})

	it("lays what a layout brings over the defaults", () => {
		expect(
			effectiveWidgetSettings({
				decl: phone,
				preset: { density: "compact", title: "Burner" }
			})
		).toEqual({ ...defaults, density: "compact", title: "Burner" })
	})

	it("lays the person's own row over what the layout brings", () => {
		expect(
			effectiveWidgetSettings({
				decl: phone,
				preset: { density: "compact", title: "Burner" },
				stored: { title: "Mine", lane: 2 }
			})
		).toEqual({ ...defaults, density: "compact", title: "Mine", lane: 2 })
	})

	it("drops a key the declaration does not admit, whichever layer held it", () => {
		expect(
			effectiveWidgetSettings({
				decl: phone,
				preset: { retired: "gone", density: "huge" },
				stored: { gone: 1, autoscroll: "yes" }
			})
		).toEqual(defaults)
		expect(
			effectiveWidgetSettings({ decl: plain, stored: { gone: 1 } })
		).toEqual({ title: "Notes", hostCard: false })
	})

	it("reads a non-object layer as nothing", () => {
		expect(
			effectiveWidgetSettings({ decl: phone, preset: "x", stored: [1] })
		).toEqual(defaults)
	})
})

describe("widgetSettingDeviations — the reader's two stored layers, unpruned", () => {
	it("lays the person's row over the layout's, key by key", () => {
		expect(
			widgetSettingDeviations({
				preset: { density: "compact", title: "Burner" },
				stored: { title: "Mine" }
			})
		).toEqual({ density: "compact", title: "Mine" })
	})

	it("keeps what it cannot judge without a declaration", () => {
		expect(
			widgetSettingDeviations({
				preset: { retired: 1 },
				stored: undefined
			})
		).toEqual({ retired: 1 })
	})
})

describe("widgetTitle — the header's override", () => {
	it("falls back to the declared title", () => {
		expect(widgetTitle(phone, {})).toBe("Cell Phone")
		expect(widgetTitle(phone, { title: "   " })).toBe("Cell Phone")
	})

	it("uses the settings' title when there is one", () => {
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
				hostCard: false,
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
		expect(r.settings).toEqual({ title: "Notes", hostCard: false })
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

// The Stats uplift (W7, 2026-10-11): `world-state` is an alias of `stats`,
// read with `{ owners: world, arrangement: strip }` under the instance's own
// settings; the keys both widgets stored before it read as today's.
describe("⏳ an aliased instance and the settings before the Stats uplift", async () => {
	const { CORE_WIDGETS } = await import("$lib/shared/widgets/types")
	const stats = CORE_WIDGETS.find((w) => w.id === "stats")!
	/** The decl a host hands the reader for one placed instance: Stats', under the placed id. */
	const as = (id: string): WidgetSettingsDecl => ({
		id,
		title: stats.title,
		settings: stats.settings
	})

	it("an aliased instance reads the implied settings as its defaults", () => {
		const out = effectiveWidgetSettings({ decl: as("world-state") })
		expect(out.owners).toBe("world")
		expect(out.arrangement).toBe("strip")
		expect(out.castScope).toBe("scene")
		// Core's own title is implied too: a placed World State keeps its name.
		expect(out.title).toBe("World State")
		expect(effectiveWidgetSettings({ decl: as("stats") }).title).toBe("Stats")
		expect(effectiveWidgetSettings({ decl: as("world-state#2") }).owners).toBe("world")
		// Plain Stats, and Stats placed as `stats#world` by name, imply nothing.
		expect(effectiveWidgetSettings({ decl: as("stats") }).owners).toBe("cast")
		expect(effectiveWidgetSettings({ decl: as("stats#world") }).arrangement).toBe("cards")
	})

	it("merges them UNDER the preset, and the preset under the person's row", () => {
		const out = effectiveWidgetSettings({
			decl: as("world-state"),
			preset: { arrangement: "list", density: "compact" },
			stored: { density: "full", slots: "bars" }
		})
		expect(out).toMatchObject({ owners: "world", arrangement: "list", density: "full", slots: "bars" })
		expect(effectiveWidgetSettings({ decl: as("world-state"), stored: { owners: "all" } }).owners).toBe("all")
	})

	it("storage holds deviations from the implied values: back to Cards sticks, Strip is not stored", () => {
		const schema = widgetSettingsSchema(as("world-state"))
		expect(pruneWidgetSettings(schema, { arrangement: "strip", owners: "world" }).values).toEqual({})
		expect(pruneWidgetSettings(schema, { arrangement: "cards" }).values).toEqual({ arrangement: "cards" })
		expect(effectiveWidgetSettings({ decl: as("world-state"), stored: { arrangement: "cards" } }).arrangement).toBe("cards")
	})

	it("World State's stored layout reads as the arrangement; a row written the new way wins", () => {
		expect(effectiveWidgetSettings({ decl: as("world-state"), stored: { layout: "list" } }).arrangement).toBe("list")
		const pruned = pruneWidgetSettings(widgetSettingsSchema(as("world-state")), { layout: "list", slots: "pick", pickSlots: ["omen"] })
		expect(pruned).toEqual({ values: { arrangement: "list", slots: "pick", pickSlots: ["omen"] }, dropped: [] })
		expect(
			pruneWidgetSettings(widgetSettingsSchema(as("world-state")), { layout: "list", arrangement: "cards" })
		).toEqual({ values: { arrangement: "cards" }, dropped: [{ key: "layout", reason: "undeclared" }] })
	})

	it("Stats' stored members reads as castScope (scene | all) or owners: pick, its pickMembers as pickOwners", () => {
		expect(effectiveWidgetSettings({ decl: as("stats"), stored: { members: "all" } }).castScope).toBe("all")
		expect(pruneWidgetSettings(widgetSettingsSchema(as("stats")), { members: "all" })).toEqual({
			values: { castScope: "all" },
			dropped: []
		})
		const picked = effectiveWidgetSettings({ decl: as("stats"), stored: { members: "pick", pickMembers: ["Bram"] } })
		expect(picked).toMatchObject({ owners: "pick", pickOwners: ["Bram"], castScope: "scene" })
		// A widget that still declares the old key keeps it as it is.
		const old: WidgetSettingsDecl = {
			id: "acme:roster",
			title: "Roster",
			settings: { members: { type: "enum", label: "Members", of: ["scene", "all"], default: "scene" } }
		}
		expect(pruneWidgetSettings(widgetSettingsSchema(old), { members: "all" }).values).toEqual({ members: "all" })
	})
})

describe("⏳ Scene Portraits' settings before its uplift (W6)", async () => {
	const { CORE_WIDGETS } = await import("$lib/shared/widgets/types")
	const portraits = CORE_WIDGETS.find((w) => w.id === "scene-portraits")!
	const decl: WidgetSettingsDecl = { id: "scene-portraits", title: portraits.title, settings: portraits.settings }
	const schema = widgetSettingsSchema(decl)

	it("a stored source: pinned reads as pick · chosen · stage, and the old key goes", () => {
		expect(effectiveWidgetSettings({ decl, stored: { source: "pinned", bars: true } })).toMatchObject({
			who: "pick",
			face: "chosen",
			arrangement: "stage",
			bars: true
		})
		expect(pruneWidgetSettings(schema, { source: "pinned" })).toEqual({
			values: { who: "pick", face: "chosen", arrangement: "stage" },
			dropped: []
		})
		// A key written the new way wins; the old one still goes.
		expect(pruneWidgetSettings(schema, { source: "pinned", who: "recent" }).values).toEqual({
			who: "recent",
			face: "chosen",
			arrangement: "stage"
		})
	})

	it("source: scene stays stored (the mark of an instance that never drew pins) and reads as the scene", () => {
		expect(pruneWidgetSettings(schema, { source: "scene", bars: true }).values).toEqual({ source: "scene", bars: true })
		expect(effectiveWidgetSettings({ decl, preset: { source: "scene", bars: true } })).toMatchObject({
			who: "scene",
			face: "sprite",
			arrangement: "grid",
			bars: true
		})
	})

	it("sprites: false reads as the avatar; sprites goes either way", () => {
		expect(pruneWidgetSettings(schema, { sprites: false }).values).toEqual({ face: "avatar" })
		expect(pruneWidgetSettings(schema, { sprites: true }).values).toEqual({})
		expect(pruneWidgetSettings(schema, { sprites: false, face: "chosen" }).values).toEqual({ face: "chosen" })
	})

	it("once moved, who put back to the scene sticks — no old key is left to read as pick again", () => {
		const moved = pruneWidgetSettings(schema, { source: "pinned" }).values
		const back = pruneWidgetSettings(schema, { ...moved, who: "scene" }).values
		expect(back).toEqual({ face: "chosen", arrangement: "stage" })
		expect(effectiveWidgetSettings({ decl, stored: back }).who).toBe("scene")
	})
})
