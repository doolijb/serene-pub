/**
 * Widget settings (PLAN 25; ruled 2026-09-10) — what a widget instance can be
 * configured with, in the SDK's one field language.
 *
 * A widget declares its settings as a `SettingsSchema`, the same `FieldDecl`
 * vocabulary a node's `params` use, so `SchemaForm` renders both. Core owns three
 * keys on top of whatever the widget declares:
 *
 *   • `title` — an override of the descriptor's label, defaulting to it.
 *   • `lane`  — which lane of the widget's declared channels it views. Offered
 *     only to a widget that declares channels, because a widget without them
 *     views the whole log and has no lane to narrow.
 *
 *   • `hostCard` — whether the host draws its card (surface, border, title
 *     bar) around the widget. Off by default: a placed widget sits flush in
 *     its cell (ruled 2026-09-27; `sessionLayout/hostCard`). Offered to every
 *     widget. Not `card`, which is a character file.
 *
 * All three are reserved: a widget declaring one is ignored for that key.
 *
 * ## Three uses, one function
 *
 * `pruneWidgetSettings` is the single decision behind persistence, validation
 * and reconciliation. It keeps only fields the schema declares, only values the
 * field's own declaration admits, and only where the value DEVIATES from the
 * declared default — so storage holds deviations and never the defaults. The
 * reconciler runs the same function to drop values for fields a descriptor has
 * stopped declaring, and reports them through `dropped`.
 *
 * `effectiveWidgetSettings` is the other direction: defaults with the stored
 * deviations over them, which is the complete object the widget reads off its
 * ctx. A widget therefore never has to know its own defaults at runtime.
 */
import {
	DEFAULT_LANE,
	formatChannel,
	parseChannel,
	type FieldDecl,
	type SettingsSchema
} from "@serene-pub/sdk"

/** Keys core owns on every widget. A widget declaring one is ignored for it. */
export const CORE_SETTING_KEYS = ["title", "lane", "hostCard"] as const

/** `FieldDecl.group` that puts a declared field behind the advanced disclosure. */
export const BEHAVIOUR_GROUP = "behaviour"

/** The half of a widget declaration this module reads. */
export interface WidgetSettingsDecl {
	id: string
	title: string
	channels?: string[]
	settings?: SettingsSchema
}

/** A schema entry, paired with the key it is stored under. */
export interface SettingsField {
	key: string
	decl: FieldDecl
}

/** How a widget's fields are exposed: basics first, behaviour behind a fold. */
export interface SettingsSections {
	/** Core-owned, shown by default. */
	basic: SettingsField[]
	/** The widget's own fields, shown by default. */
	declared: SettingsField[]
	/** The widget's `behaviour`-group fields, shown behind the disclosure. */
	behaviour: SettingsField[]
}

/** Why a stored value did not survive a prune. */
export type SettingDropReason = "undeclared" | "invalid"

export interface DroppedSetting {
	key: string
	reason: SettingDropReason
}

export interface PruneResult {
	/** Deviations from the declared defaults, and nothing else. */
	values: Record<string, unknown>
	dropped: DroppedSetting[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v)
}

/** The core-owned fields for one widget. */
export function coreSettingsSchema(decl: WidgetSettingsDecl): SettingsSchema {
	const schema: SettingsSchema = {
		title: {
			type: "string",
			label: "Title",
			description: "What this widget is called on screen.",
			default: decl.title
		}
	}
	if (decl.channels?.length)
		schema.lane = {
			type: "integer",
			label: "Lane",
			description:
				"Which conversation under this widget's channels it shows. " +
				"Lane 1 is the channel's default.",
			min: 1,
			default: DEFAULT_LANE
		}
	schema.hostCard = {
		type: "boolean",
		label: "Card",
		description:
			"Draw this widget in a card, with a border and a title bar. " +
			"A widget opened over the session always has one.",
		default: false
	}
	return schema
}

/** The full schema for a widget: the core fields, then its declared ones. */
export function widgetSettingsSchema(decl: WidgetSettingsDecl): SettingsSchema {
	const schema = coreSettingsSchema(decl)
	for (const [key, field] of Object.entries(decl.settings ?? {})) {
		if ((CORE_SETTING_KEYS as readonly string[]).includes(key)) continue
		if (!field || typeof field !== "object") continue
		schema[key] = field
	}
	return schema
}

/** Split a widget's schema into the sections the settings panel draws. */
export function settingsSections(decl: WidgetSettingsDecl): SettingsSections {
	const schema = widgetSettingsSchema(decl)
	const out: SettingsSections = { basic: [], declared: [], behaviour: [] }
	for (const key of CORE_SETTING_KEYS) {
		const field = schema[key]
		if (field) out.basic.push({ key, decl: field })
	}
	for (const [key, field] of Object.entries(schema)) {
		if ((CORE_SETTING_KEYS as readonly string[]).includes(key)) continue
		if (field.group === BEHAVIOUR_GROUP)
			out.behaviour.push({ key, decl: field })
		else out.declared.push({ key, decl: field })
	}
	return out
}

/** The choices an `enum` admits: its `of`, else its members' keys. */
function enumChoices(decl: FieldDecl): string[] {
	if (decl.of?.length) return [...decl.of]
	return (decl.members ?? []).map((m) => m.key)
}

/** Does a `share`/`perMember`/`strengths` value match its declared bands? */
function bandsOk(decl: FieldDecl, value: unknown): boolean {
	if (!isPlainObject(value)) return false
	const keys = new Set((decl.members ?? []).map((m) => m.key))
	for (const [k, v] of Object.entries(value))
		if (!keys.has(k) || typeof v !== "number" || !Number.isFinite(v))
			return false
	return true
}

/**
 * Is this value one the field's own declaration admits?
 *
 * `secret` is refused outright: a widget's settings ride the session's layout
 * payload, which core has no custody story for, so a secret declared here has
 * nowhere safe to land. Every other type is refused unless it is named here, so
 * a field type this does not yet read stores nothing rather than storing junk.
 */
function admits(decl: FieldDecl, value: unknown): boolean {
	const inRange = (n: number) =>
		(decl.min === undefined || n >= decl.min) &&
		(decl.max === undefined || n <= decl.max)
	switch (decl.type) {
		case "string":
		case "text":
			return typeof value === "string"
		case "media":
			return typeof value === "string" && value.length > 0
		case "boolean":
			return typeof value === "boolean"
		case "number":
			return (
				typeof value === "number" &&
				Number.isFinite(value) &&
				inRange(value)
			)
		case "integer":
			return (
				typeof value === "number" &&
				Number.isSafeInteger(value) &&
				inRange(value)
			)
		case "enum":
			return (
				typeof value === "string" && enumChoices(decl).includes(value)
			)
		case "string[]":
			return (
				Array.isArray(value) &&
				value.every((v) => typeof v === "string")
			)
		case "share":
		case "perMember":
		case "strengths":
			return bandsOk(decl, value)
		case "list": {
			// `min`/`max` are the element COUNT on a list, not a numeric range.
			if (!Array.isArray(value)) return false
			if (decl.min !== undefined && value.length < decl.min) return false
			if (decl.max !== undefined && value.length > decl.max) return false
			return decl.item ? value.every((v) => admits(decl.item!, v)) : false
		}
		case "object": {
			if (!isPlainObject(value)) return false
			const members = Object.entries(decl.fields ?? {})
			if (!members.length) return false
			// A member that is absent is absent, not wrong; one that is present
			// answers to its own declaration.
			return members.every(
				([k, member]) =>
					value[k] === undefined ||
					value[k] === null ||
					admits(member, value[k])
			)
		}
		case "secret":
			return false
		default:
			return false
	}
}

/**
 * Read one value back from a form control into the type its field declares.
 *
 * A number input hands back a string and a cleared text box hands back an empty
 * one, and neither is what the field means: the first is the number the person
 * typed, and the second is "no override" — clearing a title restores the
 * widget's own. Anything that cannot be read as the declared type is passed
 * through unchanged, so the prune refuses it rather than this inventing a value.
 */
export function coerceSettingValue(decl: FieldDecl, raw: unknown): unknown {
	if (decl.type === "number" || decl.type === "integer") {
		if (typeof raw !== "string") return raw
		const text = raw.trim()
		if (!text) return undefined
		const n = Number(text)
		return Number.isFinite(n) ? n : raw
	}
	if (decl.type === "string" || decl.type === "text") {
		if (typeof raw !== "string") return raw
		return raw.trim() ? raw : undefined
	}
	return raw
}

/** Structural equality against a declared default, for values this small. */
function isDefault(decl: FieldDecl, value: unknown): boolean {
	return JSON.stringify(value) === JSON.stringify(decl.default)
}

/**
 * Reduce stored settings to the deviations a schema still admits.
 *
 * Everything the schema does not declare is dropped as `undeclared`; everything
 * it declares but the field refuses is dropped as `invalid`; everything equal to
 * the declared default falls out silently, which is what makes storage
 * deviations-only.
 */
export function pruneWidgetSettings(
	schema: SettingsSchema,
	raw: unknown
): PruneResult {
	const out: PruneResult = { values: {}, dropped: [] }
	if (!isPlainObject(raw)) return out
	for (const [key, value] of Object.entries(raw)) {
		const decl = schema[key]
		if (!decl) {
			out.dropped.push({ key, reason: "undeclared" })
			continue
		}
		if (value === undefined || value === null) continue
		if (!admits(decl, value)) {
			out.dropped.push({ key, reason: "invalid" })
			continue
		}
		if (isDefault(decl, value)) continue
		out.values[key] = value
	}
	return out
}

/**
 * The complete settings object a widget reads: every declared default, with the
 * stored deviations over it. A field with no declared default is absent rather
 * than `undefined`, so `in` still answers honestly.
 */
export function effectiveWidgetSettings(
	decl: WidgetSettingsDecl,
	stored: unknown
): Record<string, unknown> {
	const schema = widgetSettingsSchema(decl)
	const out: Record<string, unknown> = {}
	for (const [key, field] of Object.entries(schema))
		if (field.default !== undefined) out[key] = field.default
	return { ...out, ...pruneWidgetSettings(schema, stored).values }
}

/** What this widget is called on screen: the stored override, else its label. */
export function widgetTitle(decl: WidgetSettingsDecl, stored: unknown): string {
	const value = effectiveWidgetSettings(decl, stored).title
	const text = typeof value === "string" ? value.trim() : ""
	return text || decl.title
}

/**
 * The channels a widget subscribes to once its lane setting is applied.
 *
 * At the default lane the declaration is untouched, so a widget that declared
 * `map:2` keeps it. Above it, every declared channel is narrowed to the chosen
 * lane — the user's pick is the more specific instruction. A widget that
 * declared no channels has none to narrow and stays a view onto the whole log.
 */
export function widgetLaneChannels(
	channels: string[] | undefined,
	lane: unknown
): string[] {
	const list = Array.isArray(channels) ? channels : []
	if (!list.length) return []
	const n =
		typeof lane === "number" && Number.isSafeInteger(lane) && lane >= 1
			? lane
			: DEFAULT_LANE
	if (n === DEFAULT_LANE) return [...list]
	return list.map((c) =>
		formatChannel({ slug: parseChannel(c).slug, lane: n })
	)
}

/** What a host threads into a widget once its settings are applied. */
export interface ResolvedWidgetInstance {
	/** The header's label: the stored override, else the declared title. */
	title: string
	/** The channels the widget subscribes to, at its chosen lane. */
	channels: string[]
	/** The complete settings object the widget reads off its ctx. */
	settings: Record<string, unknown>
}

/**
 * The one place a declaration and a stored deviation set become a live widget.
 *
 * Both hosts call this — the panel chrome and the middle grid, native and frame
 * — so the title on the header, the lane on the subscription and the settings
 * in the data contract are one computation rather than three that agree until
 * they don't.
 */
export function resolveWidgetInstance(
	decl: WidgetSettingsDecl,
	stored: unknown
): ResolvedWidgetInstance {
	const settings = effectiveWidgetSettings(decl, stored)
	return {
		title: widgetTitle(decl, stored),
		channels: widgetLaneChannels(decl.channels, settings.lane),
		settings
	}
}
