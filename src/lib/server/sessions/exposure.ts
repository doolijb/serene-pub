/**
 * 🚧 **The exposure cascade of a session's genre settings** (A10, A3, R1,
 * R32; PLAN-layering D4) — who sees a genre setting, whether it may still
 * change, and what its value is, read as one cascade by the SDK's
 * `resolveExposure`:
 *
 * ```
 * declaration   the genre's FieldDecl (its `default`, `reach`, `fixedAtStart`)
 * genre         the genre's defaults' settings (GenreDecl.defaults.settings),
 *               over its older pins (GenreDecl.settings)
 * preset        the session's preset's settings (session_presets.settings)
 * session       the session's own value (sessions.genre_fields; for the
 *               rules it plays, its ruleset and rigour columns)
 * ```
 *
 * Each layer may set a value, **lock** it (no layer below may change it) or
 * leave it open, and place an owner-open setting on the start form
 * (`askAtStart`). A genre's field reaches the owner unless it says
 * `reach: 'admin'`; one a layer above locked shows its value, read-only, to an
 * administrator and nothing to the owner (R1).
 *
 * ## The rules a session plays (R32)
 *
 * A session's ruleset and how strictly it plays it (rigour) are columns, not
 * genre fields, but they cascade the same way: declared here
 * (`rulesFieldsOf`) as settings the owner may reach, asked on the start form
 * when open to the owner, else taken from the cascade (Rule Based locks
 * rigour at `scripts`). The **ruleset** is fixed at start — read-only for
 * everyone afterwards. **How strict** may still change mid-session unless a
 * layer locks it (PLAN-rulesets §21, kept by the main session's ruling of
 * 2026-10-20 over R32's gloss).
 *
 * Pure apart from the reads at the top; `cascadeFields` (sessionGenres.ts)
 * and the settings form (`settingsForm.ts`) both resolve through here.
 */
import { eq } from "drizzle-orm"
import {
	genreDefaultsOf,
	getGenre,
	resolveExposure,
	settingValueOf,
	type ExposureLayer,
	type FieldDecl,
	type ResolvedExposure,
	type SettingValue
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { RIGOUR_LABELS } from "$lib/shared/rulesets/rigourLabels"

/** The keys of the rules a session plays — its columns, cascaded as settings (R32). */
export const RULES_KEYS = ["ruleset", "rigour"] as const
export type RulesKey = (typeof RULES_KEYS)[number]
export const isRulesKey = (k: string): k is RulesKey => (RULES_KEYS as readonly string[]).includes(k)

/**
 * The rules a genre's sessions play, as settings fixed at start (R32): the
 * ruleset and how strictly it is played, for a genre that plays rules
 * (declares `rulesets` or `rigour`). None for a genre that plays none.
 */
export function rulesFieldsOf(genreId: string): Record<string, FieldDecl> {
	const g = getGenre(genreId) as
		| { rigour?: { options: readonly string[]; default: string }; rulesets?: { only?: readonly string[]; default?: string } }
		| undefined
	if (!g || (!g.rigour && !g.rulesets)) return {}
	const options = g.rigour?.options ?? ["prose"]
	const rulesetDefault =
		g.rulesets && "only" in g.rulesets && g.rulesets.only?.length
			? g.rulesets.only[0]
			: (g.rulesets as { default?: string } | undefined)?.default
	return {
		ruleset: {
			type: "string",
			label: { en: "Rules" },
			description: { en: "The ruleset this session plays. Chosen when the session starts." },
			...(rulesetDefault ? { default: rulesetDefault } : {}),
			reach: "owner",
			fixedAtStart: true
		} as FieldDecl,
		rigour: {
			type: "enum",
			of: [...options],
			members: options.map((k) => ({ key: k, label: { en: RIGOUR_LABELS[k] ?? k } })),
			label: { en: "How strict" },
			description: { en: "How much of the rules the session plays by." },
			default: g.rigour?.default ?? "prose",
			// Not fixed at start: it may change mid-session unless a layer
			// locks it (PLAN-rulesets §21; main-session ruling 2026-10-20).
			reach: "owner"
		} as unknown as FieldDecl
	}
}

/**
 * The genre layer's values: the genre's defaults' settings (R22) over its
 * older pins (`GenreDecl.settings`, as the stored carry holds them).
 * Each a plain value or `{ value, lock?, askAtStart? }`.
 */
export async function genreLayerValues(
	genreId: string,
	pins: Readonly<Record<string, unknown>> | null | undefined
): Promise<Record<string, SettingValue>> {
	const { ensureCoreGenres } = await import("$lib/server/pipelines/registrations/genreDefaults")
	await ensureCoreGenres()
	const declared = genreDefaultsOf(getGenre(genreId))?.settings ?? {}
	return { ...(pins ?? {}), ...declared }
}

/** A preset's settings as stored — each a plain value or `{ value, lock?, askAtStart? }`. Null for no preset. */
export async function presetLayerValues(
	db: Db,
	presetId: number | null | undefined
): Promise<Record<string, SettingValue> | null> {
	if (presetId == null) return null
	try {
		const [row] = await db
			.select({ settings: schema.sessionPresets.settings })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, presetId))
			.limit(1)
		const s = row?.settings
		return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, SettingValue>) : null
	} catch {
		return null
	}
}

/** One genre setting as the cascade resolved it, with the declaration it resolved. */
export interface GenreSetting extends ResolvedExposure {
	key: string
	decl: FieldDecl
	/** `'owner'` or `'admin'` — the declaration's, a genre field defaulting to the owner. */
	reach: "owner" | "admin"
	/** The value the layers above the session give it — what a reset returns to. */
	inherited: unknown
	/** One of the rules the session plays (a column), not a genre field. */
	rules?: true
}

export interface GenreCascadeInput {
	genreId: string
	/** The genre's declared fields (`shape.fields`). */
	declared: Readonly<Record<string, FieldDecl>>
	/** The genre's older pins (`SessionGenre.settings`). */
	pins?: Readonly<Record<string, unknown>> | null
	presetId?: number | null
	/** The session's own values (genre fields, plus `ruleset` / `rigour` when it has them). */
	stored?: Readonly<Record<string, unknown>> | null
	/** `start` resolves for the start form; `session` (default) for a running session. */
	stage?: "start" | "session"
	/** The genre and preset layers already read, when the caller has them. */
	layers?: { genre: Record<string, SettingValue>; preset: Record<string, SettingValue> | null }
}

/**
 * Every genre setting of a session (or of a start form), resolved — the
 * genre's declared fields and the rules it plays, in that order. Pure over
 * the layers it is handed; reads the genre and preset layers when it is not.
 */
export async function genreSettingsCascade(db: Db, input: GenreCascadeInput): Promise<GenreSetting[]> {
	const genreLayer = input.layers?.genre ?? (await genreLayerValues(input.genreId, input.pins))
	const presetLayer = input.layers ? input.layers.preset : await presetLayerValues(db, input.presetId)
	const rules = rulesFieldsOf(input.genreId)
	const fields: Record<string, FieldDecl> = { ...input.declared, ...rules }
	return resolveGenreSettings(fields, genreLayer, presetLayer, input.stored ?? {}, input.stage ?? "session", rules)
}

/** The pure half of `genreSettingsCascade`. */
export function resolveGenreSettings(
	fields: Readonly<Record<string, FieldDecl>>,
	genreLayer: Readonly<Record<string, SettingValue>>,
	presetLayer: Readonly<Record<string, SettingValue>> | null,
	stored: Readonly<Record<string, unknown>>,
	stage: "start" | "session",
	rules: Readonly<Record<string, FieldDecl>> = {}
): GenreSetting[] {
	const above: ExposureLayer[] = [
		{ layer: "genre", values: genreLayer },
		...(presetLayer ? [{ layer: "preset", values: presetLayer }] : [])
	]
	const session: Record<string, SettingValue> = {}
	for (const [k, v] of Object.entries(stored)) if (k in fields && v !== undefined) session[k] = v
	const resolved = resolveExposure(fields, [...above, { layer: "session", values: session }], {
		stage,
		defaultReach: "owner"
	})
	const inheritedOf = resolveExposure(fields, above, { stage, defaultReach: "owner" })
	return Object.entries(fields).map(([key, decl]) => ({
		key,
		decl,
		reach: (decl.reach ?? "owner") as "owner" | "admin",
		...resolved[key]!,
		inherited: inheritedOf[key]!.value,
		...(key in rules ? { rules: true as const } : {})
	}))
}

/**
 * The value a layer's setting holds, read through `SettingValue` — what
 * every reader of a pin's value reads (a plain value, or `{ value, lock }`).
 */
export const layerValue = (v: unknown): unknown => settingValueOf(v as SettingValue).value

/** Does any of the layers above the session lock this key? Which one? */
export function lockedAbove(
	key: string,
	genreLayer: Readonly<Record<string, SettingValue>>,
	presetLayer: Readonly<Record<string, SettingValue>> | null
): string | undefined {
	if (key in genreLayer && settingValueOf(genreLayer[key]).lock) return "genre"
	if (presetLayer && key in presetLayer && settingValueOf(presetLayer[key]).lock) return "preset"
	return undefined
}

/** One setting the start form asks under a preset (R32, A10) — as `PresetRow.asks` carries it. */
export interface StartAsk {
	key: string
	label: string
	description?: string
	control: "integer" | "number" | "boolean" | "enum" | "string" | "text" | "list" | "json"
	min?: number
	max?: number
	members?: { key: string; label: string; description?: string }[]
	/** What it is if the person leaves it: the cascade's value. */
	value: unknown
	/** Fixed at start (R32): read-only once the session exists. */
	fixed?: true
	/** One of the rules the session plays — a column (`ruleset`, `rigour`), not a genre field. */
	rules?: true
}

const askText = (v: unknown, fallback: string): string => {
	if (typeof v === "string") return v
	const en = (v as { en?: unknown } | null)?.en
	return typeof en === "string" ? en : fallback
}

/** A setting's control as the start form draws it. */
function askControl(decl: FieldDecl): Pick<StartAsk, "control" | "members" | "min" | "max"> {
	const d = decl as FieldDecl & {
		of?: readonly string[]
		members?: ReadonlyArray<{ key: string; label?: unknown; description?: unknown }>
		list?: boolean
	}
	const members = d.members?.length
		? d.members.map((m) => ({
				key: m.key,
				label: askText(m.label, m.key),
				...(m.description ? { description: askText(m.description, "") } : {})
			}))
		: d.of?.map((k) => ({ key: k, label: k }))
	const bounds = { ...(typeof d.min === "number" ? { min: d.min } : {}), ...(typeof d.max === "number" ? { max: d.max } : {}) }
	// A list that names its choices carries them: the start form ticks them (lane 7).
	if (d.list || d.type === "string[]") return { control: "list", ...(members ? { members } : {}) }
	switch (d.type) {
		case "boolean":
		case "string":
		case "text":
			return { control: d.type }
		case "integer":
		case "number":
			return { control: d.type, ...bounds }
		case "enum":
			return { control: "enum", ...(members ? { members } : {}) }
		default:
			return { control: "json" }
	}
}

/**
 * **What the start form asks under each preset** (R32, A10): every setting
 * open to the owner that the preset (or the genre's defaults) places on the
 * start screen (`askAtStart`), and every setting fixed at start that is open
 * to the owner — always asked, since it cannot change after. Locked ones are
 * taken, never asked. One genre read per genre.
 */
export async function startAsks(
	db: Db,
	presets: ReadonlyArray<{ id: number; genreId: string; settings: unknown }>
): Promise<Map<number, StartAsk[]>> {
	const out = new Map<number, StartAsk[]>()
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const genres = new Map<string, { declared: Record<string, FieldDecl>; genre: Record<string, SettingValue> } | null>()
	for (const p of presets) {
		try {
			if (!genres.has(p.genreId)) {
				const g = await getSessionGenre(db, p.genreId)
				genres.set(
					p.genreId,
					g
						? {
								declared: ((g.shape as { fields?: Record<string, FieldDecl> } | undefined)?.fields ?? {}) as Record<string, FieldDecl>,
								genre: await genreLayerValues(p.genreId, g.settings)
							}
						: null
				)
			}
			const g = genres.get(p.genreId)
			if (!g) continue
			const settings = await genreSettingsCascade(db, {
				genreId: p.genreId,
				declared: g.declared,
				stage: "start",
				layers: {
					genre: g.genre,
					preset:
						p.settings && typeof p.settings === "object" && !Array.isArray(p.settings)
							? (p.settings as Record<string, SettingValue>)
							: null
				}
			})
			// The rules the session plays are always asked when open to the
			// owner — a ruleset because it is fixed at start, How strict
			// because the start form has always asked it.
			const asks = settings
				.filter((s) => s.askAtStart || (s.rules && s.ownerSees))
				.map(
					(s): StartAsk => ({
						key: s.key,
						label: askText((s.decl as { label?: unknown }).label, s.key),
						...((s.decl as { description?: unknown }).description
							? { description: askText((s.decl as { description?: unknown }).description, "") }
							: {}),
						...askControl(s.decl),
						value: s.value,
						...(s.decl.fixedAtStart ? { fixed: true as const } : {}),
						...(s.rules ? { rules: true as const } : {})
					})
				)
			if (asks.length) out.set(p.id, asks)
		} catch (err) {
			console.warn(`[exposure] the start form's asks for preset #${p.id} could not be read:`, err)
		}
	}
	return out
}

/**
 * **The settings fixed at start, resolved at creation** (R32): for each
 * setting of the genre (its fields and the rules it plays), what the session
 * is born with — the person's answer where the setting is open to them (asked
 * on the start form), else the cascade's value (a locked one is taken,
 * whatever was sent). Only the keys a layer or the person states are
 * returned for genre fields (defaults apply at read, B16x); every rules key
 * the genre plays is returned.
 */
export async function resolveAtStart(
	db: Db,
	input: {
		genreId: string
		declared: Readonly<Record<string, FieldDecl>>
		pins?: Readonly<Record<string, unknown>> | null
		presetId?: number | null
		asked: Readonly<Record<string, unknown>>
		/** An administrator starting their own session may also set what reaches administrators only (never a locked one). */
		isAdmin?: boolean
	}
): Promise<{ fields: Record<string, unknown>; rules: Partial<Record<RulesKey, unknown>>; locked: string[] }> {
	const settings = await genreSettingsCascade(db, {
		genreId: input.genreId,
		declared: input.declared,
		pins: input.pins,
		presetId: input.presetId ?? null,
		stored: {},
		stage: "start"
	})
	const fields: Record<string, unknown> = {}
	const rules: Partial<Record<RulesKey, unknown>> = {}
	const locked: string[] = []
	for (const s of settings) {
		const open = s.ownerSees || (input.isAdmin === true && !s.lockedAt)
		const asked = Object.prototype.hasOwnProperty.call(input.asked, s.key) && input.asked[s.key] !== undefined
		if (s.lockedAt) locked.push(s.key)
		const value = open && asked ? input.asked[s.key] : s.value
		if (s.rules) rules[s.key as RulesKey] = value
		else if (open && asked) fields[s.key] = value
	}
	return { fields, rules, locked }
}

/**
 * Which of a session's genre settings the asker may change (A10, R1, R32):
 * an owner what reaches the owner and nothing locked; an administrator
 * anything not locked; nobody a setting fixed at start. With each setting,
 * resolved — the write doors (`sessions:update`, the settings form) read it.
 */
export async function genreSettingsOf(
	db: Db,
	sessionId: number,
	isAdmin: boolean
): Promise<{ settings: GenreSetting[]; editable: Set<string> }> {
	const [session] = await db
		.select({
			genreId: schema.sessions.genreId,
			presetId: schema.sessions.presetId,
			genreFields: schema.sessions.genreFields,
			primaryRuleset: schema.sessions.primaryRuleset,
			rigour: schema.sessions.rigour
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { settings: [], editable: new Set() }
	const { getSessionGenre, STANDARD_GENRE_ID } = await import("$lib/server/pipelines/entities/sessionGenres")
	const genreId = session.genreId ?? STANDARD_GENRE_ID
	const genre = await getSessionGenre(db, genreId)
	const settings = await genreSettingsCascade(db, {
		genreId,
		declared: ((genre?.shape as { fields?: Record<string, FieldDecl> } | undefined)?.fields ?? {}) as Record<string, FieldDecl>,
		pins: genre?.settings,
		presetId: session.presetId ?? null,
		stored: {
			...((session.genreFields ?? {}) as Record<string, unknown>),
			...(session.primaryRuleset ? { ruleset: session.primaryRuleset } : {}),
			...(session.rigour ? { rigour: session.rigour } : {})
		},
		stage: "session"
	})
	const editable = new Set(
		settings.filter((s) => (isAdmin ? !s.lockedAt && !s.fixed : s.ownerSees)).map((s) => s.key)
	)
	return { settings, editable }
}
