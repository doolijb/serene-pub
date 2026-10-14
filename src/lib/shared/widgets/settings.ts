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
 *   • `backingMode` — on a widget message styles skin (`messages`), in place
 *     of `hostCard`: the Card setting is Auto / On / Off over the message
 *     backing its style declares (note 18; `./messageBacking`). A stored
 *     `hostCard` boolean on such a widget is read as `on` / `off`.
 *
 * All four are reserved: a widget declaring one is ignored for that key.
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
 * `effectiveWidgetSettings` is the other direction: the complete object the
 * widget reads off its ctx, and the one reader of every store a widget's
 * settings live in (its comment has the order). A widget therefore never has
 * to know its own defaults at runtime.
 */
import {
	DEFAULT_LANE,
	formatChannel,
	parseChannel,
	resolveWidgetAlias,
	type FieldDecl,
	type SettingsSchema
} from "@serene-pub/sdk"
import {
	BACKING_MODE_KEY,
	isBackedWidget,
	withLegacyBackingMode
} from "./messageBacking"

/** Keys core owns on every widget. A widget declaring one is ignored for it. */
export const CORE_SETTING_KEYS = [
	"title",
	"lane",
	"hostCard",
	BACKING_MODE_KEY
] as const

/** `FieldDecl.group` that puts a declared field behind the advanced disclosure. */
export const BEHAVIOUR_GROUP = "behaviour"

/** The half of a widget declaration this module reads. */
export interface WidgetSettingsDecl {
	/**
	 * The widget's id, or the placed instance's this schema is for (a copy,
	 * `messages#sanctum`; an alias, `world-state`). An aliased id's implied
	 * settings are its defaults (`widgetSettingsSchema`).
	 */
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
	if (isBackedWidget(decl.id))
		schema[BACKING_MODE_KEY] = {
			type: "enum",
			label: "Card",
			description:
				"Auto follows the message style (a card behind it when you " +
				"have an app background and the style asks for nothing); On " +
				"always backs the messages; Off never does.",
			of: ["auto", "on", "off"],
			members: [
				{ key: "auto", label: "Auto" },
				{ key: "on", label: "On" },
				{ key: "off", label: "Off" }
			],
			default: "auto"
		}
	else
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

/**
 * The full schema for a widget: the core fields, then its declared ones.
 *
 * ⏳ When `decl.id` is an aliased instance id (`world-state`, the SDK's
 * `WIDGET_ID_ALIASES`), the settings the alias implies are its DEFAULTS
 * (`owners: world`, `arrangement: strip` over Stats' schema, and core's own
 * `title: World State`): so they sit
 * under a preset's and a person's values in `effectiveWidgetSettings`, a
 * stored value equal to one is a non-deviation like any default, and
 * putting a field back to the widget's own default (Stats' `cards`) is a
 * deviation that sticks. REMOVE with the alias in 0.7.0.
 */
export function widgetSettingsSchema(decl: WidgetSettingsDecl): SettingsSchema {
	const schema = coreSettingsSchema(decl)
	for (const [key, field] of Object.entries(decl.settings ?? {})) {
		if ((CORE_SETTING_KEYS as readonly string[]).includes(key)) continue
		if (!field || typeof field !== "object") continue
		schema[key] = field
	}
	for (const [key, value] of Object.entries(
		resolveWidgetAlias(decl.id).impliedSettings
	))
		if (schema[key]) schema[key] = { ...schema[key], default: value }
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
 * ⏳ Stats' and World State's stored keys from before the Stats uplift (W7,
 * 2026-10-11), read as today's, so the boot reconcile rewrites a row rather
 * than dropping it: Stats' `members: scene | all` is `castScope`, its
 * `members: pick` is `owners: pick` and its `pickMembers` is `pickOwners`;
 * World State's `layout: strip | list` (its row is read against Stats'
 * schema through the alias) is `arrangement`. A key already written the new
 * way wins (the old one then drops as undeclared, and is reported). Gated
 * on the schema's shape, as `withLegacyBackingMode` is: only a schema that
 * declares the new key and not the old one reads it. The
 * remote's own fallback for a raw settings object is core-catalog's
 * `statsSettingsOf`. REMOVE in 0.7.0.
 */
function withLegacyStatsSettings(
	schema: SettingsSchema,
	raw: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...raw }
	/** Move `from` to `to` (with `value`), unless `to` is already written. */
	const move = (from: string, to: string, value: unknown) => {
		if (to in raw) return
		out[to] = value
		delete out[from]
	}
	if (schema.castScope && !schema.members) {
		if (raw.members === "scene" || raw.members === "all")
			move("members", "castScope", raw.members)
		else if (raw.members === "pick") move("members", "owners", "pick")
	}
	if (
		schema.pickOwners &&
		!schema.pickMembers &&
		raw.pickMembers !== undefined
	)
		move("pickMembers", "pickOwners", raw.pickMembers)
	if (
		schema.arrangement &&
		!schema.layout &&
		(raw.layout === "strip" || raw.layout === "list")
	)
		move("layout", "arrangement", raw.layout)
	return out
}

/**
 * ⏳ Scene Portraits' stored keys from before its uplift (W6, 2026-10-11),
 * read as the three axes they meant, so the boot reconcile rewrites a row:
 * `source: 'pinned'` is `who: 'pick'` · `face: 'chosen'` · `arrangement:
 * 'stage'`, and `sprites: false` is `face: 'avatar'` — each only where the
 * new key is not written, and both old keys go (they must: a `pinned` left
 * beside a `who` put back to its default would read as `pick` again).
 * `source: 'scene'` stays as it is stored: it says the instance never drew
 * pins, which keeps the page's one-time seed of chosen images off it
 * (`scenePins.svelte.ts`). Gated on the schema's shape, as
 * `withLegacyStatsSettings` is. The remote's own fallback for a raw
 * settings object is core-catalog's `readScenePortraitsSettings`. REMOVE in
 * 0.7.0.
 */
function withLegacyScenePortraitsSettings(
	schema: SettingsSchema,
	raw: Record<string, unknown>
): Record<string, unknown> {
	if (!schema.who || !schema.face || !schema.arrangement) return raw
	if (raw.source !== "pinned" && !("sprites" in raw)) return raw
	const out: Record<string, unknown> = { ...raw }
	const unless = (key: string, value: unknown) => {
		if (!(key in raw)) out[key] = value
	}
	if (raw.source === "pinned") {
		delete out.source
		unless("who", "pick")
		unless("face", "chosen")
		unless("arrangement", "stage")
	}
	if ("sprites" in raw) {
		delete out.sprites
		if (raw.sprites === false && raw.source !== "pinned") unless("face", "avatar")
	}
	return out
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
	// A backed widget's Card was a boolean before it was a mode: read it as
	// one, so the next write (or the boot reconcile) stores the mode.
	const read = withLegacyScenePortraitsSettings(
		schema,
		withLegacyStatsSettings(
			schema,
			schema[BACKING_MODE_KEY] && !schema.hostCard
				? (withLegacyBackingMode(raw) as Record<string, unknown>)
				: raw
		)
	)
	for (const [key, value] of Object.entries(read)) {
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
 * What one widget instance's settings are read from — each input that
 * instance's own entry, never a map of every instance.
 */
export interface WidgetSettingsInputs {
	/** The widget's declaration (read through `widgetOfInstance`). */
	decl: WidgetSettingsDecl
	/**
	 * A session layout preset's `widgetSettings[instanceId]`. A session's own
	 * read leaves it out: copying a layout in already wrote these values into
	 * the person's row (`copyLayoutIntoSession`). Only a row from before the
	 * copy model is read with its preset as well (the backfill).
	 */
	preset?: unknown
	/** This person's `widget_settings` row for the instance: its `values`. */
	stored?: unknown
}

/**
 * The complete settings object a widget instance reads, and the ONE place the
 * order its stores meet in is decided. Lowest first, each merged under the
 * next:
 *
 *   1. `decl` — the declared defaults. Never stored, so a changed default
 *      reaches every instance that has not overridden it. An aliased
 *      instance (`world-state`) reads the settings its alias implies as its
 *      defaults (`widgetSettingsSchema`), so they too sit under 2 and 3.
 *   2. `preset` — what a session layout preset brings for this instance.
 *   3. `stored` — this person's row (`widget_settings.widget_instance_id`).
 *      Last because it is the only one of the three that is theirs: a layout
 *      is shared and a declaration is the author's.
 *
 * The two stored layers are laid raw and pruned ONCE against the schema, so
 * a key outside the declaration drops out whichever layer held it.
 *
 * A style pin (`session_panel_layouts.layout_settings.widgetStyles`) is not an
 * input: it names a style row, which `resolveStyle` reads, and it stays in
 * the layout's settings by ruling (2026-09-28). A field with no declared
 * default is absent rather than `undefined`, so `in` still answers honestly.
 */
export function effectiveWidgetSettings(
	inputs: WidgetSettingsInputs
): Record<string, unknown> {
	const schema = widgetSettingsSchema(inputs.decl)
	const out: Record<string, unknown> = {}
	for (const [key, field] of Object.entries(schema))
		if (field.default !== undefined) out[key] = field.default
	const deviations = widgetSettingDeviations(inputs)
	return { ...out, ...pruneWidgetSettings(schema, deviations).values }
}

/**
 * `effectiveWidgetSettings` below its declared floor: the two stored layers
 * laid in its order, unpruned. For a writer that stores deviations and has no
 * declaration to prune against (the pre-copy backfill); the boot reconcile
 * prunes what it writes.
 */
export function widgetSettingDeviations(
	inputs: Pick<WidgetSettingsInputs, "preset" | "stored">
): Record<string, unknown> {
	return {
		...(isPlainObject(inputs.preset) ? inputs.preset : {}),
		...(isPlainObject(inputs.stored) ? inputs.stored : {})
	}
}

/**
 * What this widget is called on screen: the title its effective settings
 * carry (`effectiveWidgetSettings`), else its label.
 */
export function widgetTitle(
	decl: WidgetSettingsDecl,
	settings: Record<string, unknown>
): string {
	const value = settings.title
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
	const settings = effectiveWidgetSettings({ decl, stored })
	return {
		title: widgetTitle(decl, settings),
		channels: widgetLaneChannels(decl.channels, settings.lane),
		settings
	}
}
