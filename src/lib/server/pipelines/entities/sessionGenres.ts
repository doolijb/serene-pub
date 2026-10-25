/**
 * Session genres, read from rows (19 §0–§2, re-anchored by 24 §3).
 *
 * **The genre owns its id** (ruled 2026-08-28, revising 23 §7): sessions hold
 * `core:genre/chat`, and the create pipeline is the genre's required member —
 * the published spec whose input lock declares `event: session-created` for
 * that genre. Its version row carries the genre declaration (`genre` column:
 * name, family, shape) and the lock (`input_genre`/`input_event` columns), so
 * every "what is this session" check stays a SELECT, and dispatch keys on
 * (genre, event) rather than tunneling through input types.
 *
 * Transitional union: a plugin that ships a shape-bearing *input type* and no
 * create spec still gets a genre, read from the registry as before — minus
 * the standard input, whose identity moved (listing both would show Chat
 * twice). The picker stays one-or-two SELECTs; this module stays the one
 * place the shape's meaning is interpreted.
 */

import {
	actionsOf,
	DEFAULT_ACTION_AUDIENCE,
	effectsOf,
	isEventId,
	normalizeEnabledWhen,
	minAgeOf,
	sessionEvents,
	slashNameOf,
	type ActionEffects,
	type Audience,
	type EnabledWhen,
	type Venue
} from "@serene-pub/sdk"
import {
	actionIdentity,
	parseActionIdentity
} from "$lib/shared/actions/identity"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	lockedEventSpec,
	type PresetFallback
} from "$lib/server/pipelines/entities/presetBindings"
import {
	effectiveRegistrations,
	genreRegistrations,
	onAction,
	onEvent,
	whenHolds
} from "$lib/server/pipelines/registrations/resolve"
import { actionRegistration, actionRegistrationKey } from "$lib/server/pipelines/registrations/rows"
import {
	getGenre,
	i18nText,
	resolveExposure,
	settingValueOf,
	type EnvoyDecl,
	type FieldDecl,
	type I18n,
	type SessionShape,
	type SettingValue
} from "@serene-pub/sdk"
import { listedCollects, type ListedCollects } from "$lib/shared/actions/collects"
import {
	resolvePlayerLabel,
	storedPlayerLabel
} from "$lib/shared/sessions/playerLabel"

/** The F29 floor: always present, the default and the backfill (24 §3). */
/** The genre a session with none is read as — **Story** since 2026-10-19 (was Chat, which is the assistant now). */
export const STANDARD_GENRE_ID = "core:genre/story"

/** The spellings the floor wore before 24 §3; read-compat only. */
export const LEGACY_STANDARD_GENRE_IDS = [
	"core:spec/create-chat",
	"core:inlet/user-message@1"
] as const
export const LEGACY_STANDARD_GENRE_ID = "core:inlet/user-message@1"

/**
 * The primary write a session mode's pipeline must perform (19 §0).
 *
 * A pipeline is in a mode's `respond` bucket only if it both reads the mode's
 * input *and* writes a session message. Reading alone is not membership: the
 * narrative graph builder reads a session exactly as a reply does and produces a
 * proposal, which is a different lifecycle entirely.
 *
 * Bare, without the `@N`, because a bucket is about *what a pipeline does*
 * rather than which version of the consumer it pinned — a `create-message@2`
 * would still be writing the message.
 */
const CHAT_WRITE_TYPE = "core:outlet/create-message"

export interface SessionGenre {
	/** The genre id (24 §3) — or transitionally an input-type id. */
	genreId: string
	name: string
	/**
	 * The picker card's subtitle, from the row's display text. Never required
	 * to be present here — the SDK refuses an *untitled* mode at declaration
	 * and the packager warns about a missing description — but by the time a
	 * row exists, absence just renders a plainer card.
	 */
	description: string
	family?: string
	/** 🚧 2026-10-19: the card's long copy, who may sit, ruleset uses, background tasks. */
	about?: string
	members?: "solo" | "group"
	uses?: Record<string, unknown>
	tasks?: Array<Record<string, unknown>>
	shape: SessionShape
	/** The event surface (24 §5), off the genre declaration row. */
	events?: Record<string, { required?: boolean; open?: boolean }>
	/**
	 * The envoys the genre brings (plans/29 R-18; U5g), off the same row —
	 * `meta.genre.envoys` on the create spec's version. Absent for a genre
	 * that declares none, and for the transitional inlet-declared genres.
	 */
	envoys?: EnvoyDecl[]
	/**
	 * What a person's persona-less line is called (lair re-plan R4) — the
	 * genre's `playerLabel`, off the same row, as `en` display text like
	 * `name`. Absent for a genre that declares none. A session's override is
	 * layered on by `resolvePlayerLabel`, never here.
	 */
	playerLabel?: string
	/**
	 * The genre's pinned setting values (PLAN-turn-order §4.13, R14) — the
	 * genre layer of the settings cascade, off the same row. Absent for a
	 * genre that pins nothing, which is every core genre today.
	 */
	settings?: Record<string, unknown>
	/**
	 * The plugin row that provides this genre — its create spec's
	 * `source_plugin_id`, or a transitional input's `owner_plugin_id` — or
	 * absent for core's. Whose the genre is: never read off its id, which a
	 * package may spell `core:…`.
	 */
	sourcePluginId?: number
}

/** Display text in `en` through the SDK's one resolver (R-20); blank for a value publish never let in. */
const en = (v: unknown): string => i18nText(v as I18n | undefined) ?? ""

/** Every genre this build registers — create specs, then unclaimed inputs. */
export async function listSessionGenres(db: Db): Promise<SessionGenre[]> {
	// The genres themselves (24 §3): published create pipelines, the genre id
	// from the input lock, the declaration on the version row.
	const specRows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			sourcePluginId: schema.pipelineSpecs.sourcePluginId,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			genre: schema.pipelineSpecVersions.genre,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			taxonomy: schema.pipelineSpecVersions.taxonomy
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.orderBy(asc(schema.pipelineSpecs.id))
	/**
	 * 🚧 Which genre each create pipeline creates (PLAN-layering D3, D7): the
	 * genre whose defaults register it on `session-created` — a pipeline
	 * mounted by registrations has no lock to say. ⏳ A package's create spec
	 * still locked to its genre is read off the lock, as before.
	 */
	const createdBy = new Map<string, string[]>()
	for (const r of await db
		.select({ genreId: schema.registrations.scopeRef, specSlug: schema.registrations.specSlug })
		.from(schema.registrations)
		.where(
			and(
				eq(schema.registrations.scopeKind, "genre"),
				eq(schema.registrations.triggerFamily, "event"),
				eq(schema.registrations.triggerRef, sessionEvents.sessionCreated),
				eq(schema.registrations.dropped, false)
			)
		)
		.orderBy(asc(schema.registrations.id))) {
		if (!r.specSlug) continue
		const list = createdBy.get(r.specSlug) ?? []
		if (!list.includes(r.genreId)) list.push(r.genreId)
		createdBy.set(r.specSlug, list)
	}
	const seenGenres = new Set<string>()
	const fromSpecs: SessionGenre[] = (specRows as any[])
		.filter((r) => r.activeVersionId === r.versionId && r.genre?.shape)
		.flatMap((r) => {
			const ids =
				r.inputEvent === sessionEvents.sessionCreated && r.inputGenre
					? [r.inputGenre as string]
					: (createdBy.get(r.slug) ?? [])
			return ids
				.filter((id) => !seenGenres.has(id) && (seenGenres.add(id), true))
				.map((id) => ({ ...r, inputGenre: id }))
		})
		.map((r) => {
			// 🚧 The stored carry holds the five keys a session needs for its
			// life; the 2026-10-19 declaration keys (about, members, uses,
			// tasks) are read from the live registry when the carry lacks them.
			const live: any = getGenre(r.inputGenre) ?? null
			const g: any = {
				...(r.genre ?? {}),
				...(r.genre?.about === undefined && live?.about !== undefined ? { about: live.about } : {}),
				...(r.genre?.members === undefined && live?.members !== undefined ? { members: live.members } : {}),
				...(r.genre?.uses === undefined && live?.uses !== undefined ? { uses: live.uses } : {}),
				...(r.genre?.tasks === undefined && live?.tasks !== undefined ? { tasks: live.tasks } : {})
			}
			r = { ...r, genre: g }
			return {
			genreId: r.inputGenre,
			name: en(r.genre?.name) || r.inputGenre,
			description: en(r.genre?.description),
			family: typeof r.genre?.family === "string" ? r.genre.family : undefined,
			...(en(r.genre?.about).trim() ? { about: en(r.genre.about).trim() } : {}),
			...(r.genre?.members === "solo" ? { members: "solo" as const } : {}),
			...(r.genre?.uses && typeof r.genre.uses === "object" ? { uses: r.genre.uses as Record<string, unknown> } : {}),
			...(Array.isArray(r.genre?.tasks) && r.genre.tasks.length
				? {
					tasks: (r.genre.tasks as any[]).map((t) => ({
						...t,
						label: en(t.label) || t.key,
						...(en(t.description).trim() ? { description: en(t.description).trim() } : {})
					}))
				}
				: {}),
			shape: r.genre.shape as SessionShape,
			events: (r.genre?.events ?? undefined) as
				| Record<string, { required?: boolean; open?: boolean }>
				| undefined,
			...(Array.isArray(r.genre?.envoys) && r.genre.envoys.length
				? { envoys: r.genre.envoys as EnvoyDecl[] }
				: {}),
			...(en(r.genre?.playerLabel).trim()
				? { playerLabel: en(r.genre.playerLabel).trim() }
				: {}),
			...(r.genre?.settings &&
			typeof r.genre.settings === "object" &&
			!Array.isArray(r.genre.settings)
				? { settings: r.genre.settings as Record<string, unknown> }
				: {}),
			...(typeof r.sourcePluginId === "number" ? { sourcePluginId: r.sourcePluginId } : {})
		}
		})

	// Transitional: plugin genres still declared on input types, minus the
	// standard input whose identity moved (listing both shows Chat twice).
	const rows = await db
		.select()
		.from(schema.pipelineDefinitionRegistry)
		.where(eq(schema.pipelineDefinitionRegistry.kind, "inlet"))
		.orderBy(asc(schema.pipelineDefinitionRegistry.id))
	const fromInputs: SessionGenre[] = (rows as any[])
		.filter(
			(r) =>
				r.status === "live" &&
				r.sessionShape &&
				`${r.definitionId}@${r.version}` !== LEGACY_STANDARD_GENRE_ID
		)
		.map((r) => ({
			genreId: `${r.definitionId}@${r.version}`,
			name: en(r.i18n?.name) || r.definitionId,
			description: en(r.i18n?.description),
			shape: r.sessionShape as SessionShape,
			...(typeof r.ownerPluginId === "number" ? { sourcePluginId: r.ownerPluginId } : {})
		}))

	return [...fromSpecs, ...fromInputs]
}

/**
 * The genres a LISTING offers (R67): every registered genre minus those a
 * disabled plugin provides — its create spec's `source_plugin_id`, or its id
 * under the plugin's namespace. Only for pickers and admin lists: a session
 * already on such a genre keeps resolving it through `listSessionGenres`.
 */
export async function listOfferedGenres(db: Db): Promise<SessionGenre[]> {
	const all = await listSessionGenres(db)
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	if (!off.ids.size) return all
	// Only a genre whose CREATE spec the plugin owns is the plugin's: every
	// spec carries an `input_genre` lock, and a plugin's reply or swap spec
	// locked to Chat must not take Chat with it (R67 review).
	const owned = await db
		.select({ inputGenre: schema.pipelineSpecVersions.inputGenre })
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)
		.where(
			and(
				inArray(schema.pipelineSpecs.sourcePluginId, [...off.ids]),
				eq(schema.pipelineSpecVersions.inputEvent, sessionEvents.sessionCreated)
			)
		)
	const hidden = new Set(owned.map((r) => r.inputGenre).filter(Boolean))
	// 🚧 …and a genre whose defaults register a create pipeline a disabled
	// plugin owns (PLAN-layering D7: a pipeline mounted by registrations has
	// no lock to say whose genre it creates).
	for (const r of await db
		.select({ genreId: schema.registrations.scopeRef })
		.from(schema.registrations)
		.innerJoin(schema.pipelineSpecs, eq(schema.pipelineSpecs.slug, schema.registrations.specSlug))
		.where(
			and(
				eq(schema.registrations.scopeKind, "genre"),
				eq(schema.registrations.triggerRef, sessionEvents.sessionCreated),
				inArray(schema.pipelineSpecs.sourcePluginId, [...off.ids])
			)
		))
		hidden.add(r.genreId)
	return all.filter((g) => !hidden.has(g.genreId) && !off.ownsId(g.genreId))
}

export async function getSessionGenre(
	db: Db,
	genreId: string
): Promise<SessionGenre | null> {
	return (await listSessionGenres(db)).find((m) => m.genreId === genreId) ?? null
}

/**
 * Does this session satisfy the shape? Refusals are sentences, per 15 §1.3 —
 * the reader used a picker that offered the mode, and "constraint violated"
 * tells them nothing they can act on.
 *
 * A capability the shape omits entirely means the system does not exist for
 * the session: zero of it is required *and* permitted. Bounds omit `max` for
 * unlimited.
 */
export function shapeViolations(
	shape: SessionShape,
	session: { characters: number; personas: number; hasLorebook: boolean }
): string[] {
	const out: string[] = []
	const bound = (
		label: string,
		count: number,
		cap?: { min: number; max?: number }
	) => {
		const min = cap?.min ?? 0
		const max = cap ? cap.max : 0 // absent capability: none permitted
		if (count < min)
			out.push(
				`this genre needs at least ${min} ${label}${min === 1 ? "" : "s"} — the session has ${count}`
			)
		if (max != null && count > max)
			out.push(
				max === 0
					? `this genre has no ${label}s — the session has ${count}`
					: `this genre allows at most ${max} ${label}${max === 1 ? "" : "s"} — the session has ${count}`
			)
	}
	bound("character", session.characters, shape.characters)
	bound("persona", session.personas, shape.personas)
	// ⏳ No "requires a lorebook" (RF fix 2, 2026-10-23): `lorebook: 'required'`
	// is retired and reads as optional — every session has a world, its own
	// (its own book) when none is attached.
	if (!shape.lorebook && session.hasLorebook)
		out.push("this genre has no lorebook attachment — the session has one")
	return out
}

/**
 * The counts the validator needs, read once. `characters` counts LIVE
 * CHARACTER seats only: a cast row is a character's or an envoy's (U5g), and
 * an envoy is the genre's own speaker rather than a library character the
 * shape bounds — a guide session with its mascot seated has zero characters,
 * as its `characters: { max: 0 }` demands. A departed seat (`removed_at`)
 * is not in the room either (U5g review, W2).
 */
export async function sessionShapeFacts(
	db: Db,
	sessionId: number
): Promise<{ characters: number; personas: number; hasLorebook: boolean }> {
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const characters = await db
		.select({ sessionId: schema.sessionCharacters.sessionId })
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.envoySlug),
				isNull(schema.sessionCharacters.removedAt)
			)
		)
	const personas = await db
		.select({ sessionId: schema.sessionPersonas.sessionId })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)
	return {
		characters: (characters as any[]).length,
		personas: (personas as any[]).length,
		hasLorebook: session?.lorebookId != null
	}
}

/**
 * The genre's field values for a session — the supply side of the fields
 * round-trip, and the same cascade the settings document resolves
 * (`resolveSessionSettings`), so a run and the settings form never disagree.
 * Stored value, then the genre's pin, then the field's declared `default`
 * (§4.13); keys the genre does not declare or pin are dropped here so a mode
 * switch cannot smuggle stale facts under names the new mode never asked for.
 *
 * Defaults apply here, at read, and are never written at create (B16x): one
 * place serves every way a session is born — a create with or without a
 * preset, an import, the API — and rows older than a field's declaration,
 * with no data migration; a stored copy would also outrank a later pin.
 *
 * Best-effort like the other run-shaping reads: a failed lookup supplies
 * `{}`, never a failed turn — and a session on the F29 floor with no registry
 * rows behaves exactly as before fields existed.
 */
export async function genreFieldsFor(
	db: Db,
	sessionId: number
): Promise<Record<string, unknown>> {
	try {
		const [session] = await db
			.select({
				genreId: schema.sessions.genreId,
				presetId: schema.sessions.presetId,
				genreFields: schema.sessions.genreFields
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session) return {}
		const genre = await getSessionGenre(
			db,
			session.genreId ?? STANDARD_GENRE_ID
		)
		return await cascadeSessionFields(db, session, genre)
	} catch {
		return {}
	}
}

/**
 * What a session's persona-less person lines are called (lair re-plan R4):
 * its own override (`metadata.playerLabel`), else its genre's `playerLabel`,
 * else undefined — `resolvePlayerLabel`, the one cascade the page and the
 * settings document also use. Best-effort like `genreFieldsFor`: a failed
 * read is no label, never a failed turn.
 */
export async function playerLabelFor(
	db: Db,
	sessionId: number
): Promise<string | undefined> {
	try {
		const [session] = await db
			.select({
				genreId: schema.sessions.genreId,
				metadata: schema.sessions.metadata
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session) return undefined
		const genre = await getSessionGenre(
			db,
			session.genreId ?? STANDARD_GENRE_ID
		)
		return resolvePlayerLabel({
			declared: genre?.playerLabel,
			stored: storedPlayerLabel(session.metadata)
		})
	} catch {
		return undefined
	}
}

/**
 * 🚧 A preset's pins as plain values (PLAN-layering D4, A10): each layer may
 * set a value, lock it or leave it open — `{ value, lock?, askAtStart? }`
 * (`SettingValue`) — and every reader of a pin's *value* reads it through
 * the SDK's `settingValueOf` (Rule Based's rigour is `{ value: 'scripts',
 * lock: true }`). Who may change it is lane 5b's exposure cascade.
 */
export function presetPinValues(settings: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) return out
	for (const [k, v] of Object.entries(settings as Record<string, unknown>))
		out[k] = settingValueOf(v as never).value
	return out
}

/**
 * The cascade (§4.13) over declared ∪ pinned keys, in that order — declared
 * first so the form's order is the document's, pinned-only keys after.
 */
export function cascadeFields(layers: {
	declared: Record<string, { default?: unknown }>
	/**
	 * The genre layer — the genre's defaults' settings over its older pins
	 * (`genreLayerValues`), each a value or `{ value, lock?, askAtStart? }`.
	 */
	pinned: Readonly<Record<string, unknown>>
	/** 🚧 The preset layer (2026-10-19): `session > preset > genre > core`; values as above. */
	preset?: Readonly<Record<string, unknown>> | null
	stored: Record<string, unknown>
}): Record<string, unknown> {
	// 🚧 PLAN-layering A10: each layer may lock what the layers below it may
	// change — the session's stored value under a key the preset locked is
	// not read, nor the preset's under one the genre locked. One resolver,
	// the SDK's (`resolveExposure`), over the declared fields.
	const defined = (o: Readonly<Record<string, unknown>> | null | undefined) =>
		Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Record<string, SettingValue>
	const genre = defined(layers.pinned)
	const preset = layers.preset ? defined(layers.preset) : null
	const stored = defined(layers.stored)
	const { declared } = layers
	const resolved = resolveExposure(
		declared as Record<string, FieldDecl>,
		[
			{ layer: "genre", values: genre },
			...(preset ? [{ layer: "preset", values: preset }] : []),
			{ layer: "session", values: stored }
		],
		{ defaultReach: "owner" }
	)
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(declared)) {
		const v = resolved[key]?.value
		if (v !== undefined) out[key] = v
	}
	// A pinned key with no field renders no control and stores nothing: the
	// pin is what every run reads (the preset's over the genre's, unless the
	// genre locked it). A stored value under an undeclared key is not a field.
	for (const key of new Set([...Object.keys(genre), ...Object.keys(preset ?? {})])) {
		if (key in declared) continue
		const g = key in genre ? settingValueOf(genre[key]) : null
		const p = preset && key in preset && !g?.lock ? settingValueOf(preset[key]) : null
		const v = p ? p.value : g?.value
		if (v !== undefined) out[key] = v
	}
	return out
}

/** 🚧 The one cascade (§4.13) of a session's genre fields — declared ⊕ the genre layer ⊕ the preset layer ⊕ stored (D7). */
export async function cascadeSessionFields(
	db: Db,
	session: { genreId: string | null; presetId: number | null; genreFields: unknown },
	genre: Awaited<ReturnType<typeof getSessionGenre>>
): Promise<Record<string, unknown>> {
	const { genreLayerValues, presetLayerValues } = await import(
		"$lib/server/sessions/exposure"
	)
	return cascadeFields({
		declared: ((genre?.shape as any)?.fields ?? {}) as Record<
			string,
			{ default?: unknown }
		>,
		pinned: await genreLayerValues(
			session.genreId ?? STANDARD_GENRE_ID,
			genre?.settings
		),
		preset: await presetLayerValues(db, session.presetId ?? null),
		stored: (session.genreFields ?? {}) as Record<string, unknown>
	})
}

/** `ns:kind/name@N` → the bare type and its integer version. */
export function parseGenreId(genreId: string): {
	bareType: string
	version: number
} {
	const [bareType, versionStr] = genreId.split("@")
	return { bareType: bareType!, version: Number(versionStr ?? 1) }
}

/**
 * Upgrade a session's mode along its own type (19 §6, ruled 2026-08-23):
 * **there is no mid-session mode swap.** A session's mode is chosen at creation and
 * fixed for its life; what a mode *is* allowed to do is evolve — the same
 * bare input type at a higher version. `crawl@1 → crawl@2` is the declaring
 * author saying "this is still the crawl, improved," and the session follows;
 * `crawl → heist` would re-meaning every message already in the session, and is
 * refused no matter how well the cast happens to fit.
 *
 * The target's shape is still validated (the same validator creation calls):
 * an upgrade that tightened a bound refuses with the sentences rather than
 * stranding the session half-legal. Downgrades refuse too — versions move one
 * way, like every other pin in the system. Field values stay on the row; the
 * supply side filters to the current version's declared keys, so a dropped
 * field goes inert and an added one starts empty.
 */
export async function upgradeSessionGenre(
	db: Db,
	sessionId: number,
	targetGenreId: string
): Promise<{ error?: string }> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { error: "That session no longer exists." }
	const currentId = session.genreId ?? STANDARD_GENRE_ID
	if (currentId === targetGenreId) return {}

	const current = parseGenreId(currentId)
	const target = parseGenreId(targetGenreId)
	if (current.bareType !== target.bareType)
		return {
			error:
				`A session keeps its genre for life — '${currentId}' cannot become ` +
				`'${targetGenreId}'. Genres upgrade along their own type only.`
		}
	if (target.version <= current.version)
		return {
			error: `'${targetGenreId}' is not an upgrade of '${currentId}' — versions move one way.`
		}

	const mode = await getSessionGenre(db, targetGenreId)
	if (!mode)
		return {
			error: `'${targetGenreId}' is not a session genre this build registers.`
		}
	const violations = shapeViolations(
		mode.shape,
		await sessionShapeFacts(db, sessionId)
	)
	if (violations.length)
		return {
			error: `This session does not fit '${mode.name}': ${violations.join("; ")}.`
		}

	// The defaults the new version brings, seated as creation seats them
	// (U5g review, W3) — a seat the person unseated stays unseated, since
	// `seatDefaultEnvoys` never revives. Dynamic for the cycle: `envoys.ts`
	// reads this module's genre.
	const { seatDefaultEnvoys } = await import(
		"$lib/server/pipelines/entities/envoys"
	)
	// One transaction: a session left with the new genre_id but the old
	// genre's seats (or vice versa, on a crash between the two writes) is a
	// session no read agrees on the shape of.
	await db.transaction(async (tx: Db) => {
		await tx
			.update(schema.sessions)
			.set({ genreId: targetGenreId })
			.where(eq(schema.sessions.id, sessionId))
		await seatDefaultEnvoys(tx, sessionId, targetGenreId)
	})
	return {}
}

/**
 * Is this session's mode available to run (19 §6, ruled 2026-08-23)?
 *
 * A session whose mode disappeared — the declaring plugin disabled, the type
 * retired — goes **read-only**: its history stays readable and curatable,
 * and no new turn starts. Deliberately *not* a fallback to the standard
 * mode: the messages were written under the missing mode's shape, and
 * running them through a different one would silently re-meaning the session.
 *
 * The standard mode is the F29 floor — available by definition, registry or
 * no registry — so this can never make ordinary sessionting worse than today.
 */
export async function sessionGenreAvailable(
	db: Db,
	sessionId: number
): Promise<{ available: boolean; genreId: string; reason?: string }> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const genreId = session?.genreId ?? STANDARD_GENRE_ID
	if (genreId === STANDARD_GENRE_ID) return { available: true, genreId }
	try {
		if (await getSessionGenre(db, genreId)) return { available: true, genreId }
	} catch {
		// A failed read refuses the turn rather than guessing — the reason
		// below says what to check.
	}
	return {
		available: false,
		genreId,
		reason:
			`This session's genre ('${genreId}') is not installed, so the session is ` +
			`read-only. Its messages are safe; new turns resume when the genre returns.`
	}
}

/* --- turn-taking ------------------------------------------------------ */
// `listTurnStrategies` retired 2026-09-23 (PLAN-turn-order R28): what a
// session may pick is the turn-order spec's `strategy` node's own
// `expose.swaps` plus enabled contributions — `listSessionNodeSwaps` in
// entities/bindings.ts, the same list for every swappable node.

/* --- subject routing (19 §3, U-C3; plans/31 V2) ------------------------ */

export interface GenreAction {
	/**
	 * The action's own key within its spec (R-15, U5c) — joined to
	 * `specSlug` as `<spec slug>#<key>` it is the action's **identity**, the
	 * one thing routing, bindings, presets, enablement rows and the *new*
	 * marker key on (plans/31 V2). There is no second routing key.
	 */
	key: string
	/**
	 * Where a person meets it, per channel (plans/29 R-15 *venue*): the
	 * composer's row, a message's menu, the extra tab, a widget… A venue
	 * naming a channel appears on that channel alone; one naming none
	 * appears on every channel. _Was_ one `venue: string` until 2026-09-16,
	 * and `kind: button | menu` before that.
	 */
	venues: Venue[]
	/** Who may see it and who may act, as participant references (R-15). */
	audience: Audience
	/**
	 * Which side of the effects line (R-15 *The line*; U5d): `fiction`, or
	 * `world` — a result reaching cards, lore, settings or permissions, which
	 * no block may carry and no oracle may answer. The declaration's, else
	 * `fiction`.
	 */
	effects: ActionEffects
	/** The one prominence flag: primary set, or the overflow. */
	quick: boolean
	/**
	 * What a press collects before it fires (lair pass R3) — the
	 * declaration's `collects`, display text resolved. Absent: the action
	 * collects nothing and its run's `input.text` is empty.
	 */
	collects?: ListedCollects
	/**
	 * 🚧 The question asked before it fires (`ActionDecl.confirm`, 2026-10-18),
	 * display text resolved; the confirm button reads `confirmLabel`, else
	 * the action's name.
	 */
	confirm?: { question: string; description?: string; confirmLabel: string }
	/**
	 * The action's own **enabled-when** (plans/29 R-15; U5e), in list form
	 * — the declaration's, before the genre default beneath it and the
	 * session override above it are applied (`effectiveEnabledWhen`).
	 * Absent when the declaration states none; an explicit empty list is
	 * the declaration opting out of the genre's default.
	 */
	enabledWhen?: EnabledWhen[]
	/**
	 * The declaration's **present-when** (W-GATE D3), in list form: when it
	 * fails the action is left out of the listing and refused at the door,
	 * rather than greyed. Absent: always present.
	 */
	presentWhen?: EnabledWhen[]
	/** The slash name — declared, or derived by the namespace rule. */
	slash: string
	/** Lucide icon name, as the contributor declared it. */
	icon?: string
	/** What the icon says standing alone — the declaration's `iconAlt`; absent: `name`. */
	iconAlt?: string
	name: string
	/** What the action does, one sentence — required of every declaration (the legend, 2026-09-28). */
	description?: string
	/** Who contributed it — the spec whose active version declares it. */
	specSlug: string
	/**
	 * Companion or foreign, decided by namespace (§3).
	 *
	 * A contribution from the mode owner's own namespace is a **companion** —
	 * shipped alongside the mode by the same author, so present by default.
	 * One from any other namespace is **foreign**: somebody else's spec
	 * reaching into these sessions, so opt-in. (Called an *attachment* until
	 * 2026-10-02 — R1: that is the message-part word.)
	 *
	 * Mechanical on purpose. §3's phrasing is "no lists to keep; the namespace
	 * comparison is the rule" — the alternative is a registry of who is
	 * trusted, which is a thing to maintain and a thing to get wrong.
	 */
	origin: "companion" | "foreign"
	/** What `origin` implies: companions on, foreign actions off. */
	enabledByDefault: boolean
}

/** @deprecated the pre-U5c name; the shape is `GenreAction`. */
export type GenreTrigger = GenreAction

/** `core:inlet/user-message@1` → `core`. The half of an id before the colon. */
const namespaceOf = (id: string): string => {
	const i = id.indexOf(":")
	return i === -1 ? "" : id.slice(0, i)
}

/**
 * The contributed action set for a genre (19 §4; R-15) — what the session
 * view renders, from rows.
 *
 * The same criteria as `resolveSubjectSpec`'s contributed branch (published
 * status, active version), deliberately: a button whose press cannot resolve,
 * or a resolvable function with no button, would be the two halves of one
 * fact disagreeing. Retiring a spec's version removes its actions here and
 * its routing there in the same breath — no UI code involved.
 *
 * Read through the SDK's `actionsOf`, which folds the pre-U5c `triggers`
 * spelling a stored plugin version may still carry — one reader, so a
 * document from before the rename and one from after answer the same.
 */
/**
 * 🚧 The action identities a genre's registrations name (PLAN-layering D3,
 * D7): its defaults' (`defaults`) and any of its presets', in order. An
 * action's genre comes from the registrations that include it. `add` lets a
 * caller append a lock-era action to the same list.
 */
export async function registeredActionIdentities(
	db: Db,
	genreId: string
): Promise<{
	defaults: Set<string>
	offered: string[]
	add: (identity: string | null | undefined, isDefault: boolean) => void
}> {
	const defaults = new Set<string>()
	const offered: string[] = []
	const add = (identity: string | null | undefined, isDefault: boolean) => {
		if (!identity) return
		if (isDefault) defaults.add(identity)
		if (!offered.includes(identity)) offered.push(identity)
	}
	const regRows = await db
		.select({
			scopeKind: schema.registrations.scopeKind,
			scopeRef: schema.registrations.scopeRef,
			triggerRef: schema.registrations.triggerRef
		})
		.from(schema.registrations)
		.where(
			and(
				eq(schema.registrations.triggerFamily, "action"),
				eq(schema.registrations.dropped, false)
			)
		)
		.orderBy(asc(schema.registrations.id))
	const presetIds = new Set(
		(
			await db
				.select({ id: schema.sessionPresets.id })
				.from(schema.sessionPresets)
				.where(eq(schema.sessionPresets.genreId, genreId))
		).map((r) => String(r.id))
	)
	for (const r of regRows)
		if (r.scopeKind === "genre" && r.scopeRef === genreId) add(r.triggerRef, true)
	for (const r of regRows)
		if (r.scopeKind === "preset" && presetIds.has(r.scopeRef)) add(r.triggerRef, false)
	return { defaults, offered, add }
}

export async function listGenreActions(
	db: Db,
	genreId: string
): Promise<GenreAction[]> {
	try {
		/**
		 * 🚧 What a genre offers (PLAN-layering D3, D7, R33): the actions its
		 * defaults register (on by default — the companion rule, explicit),
		 * then those any of its presets registers, then ⏳ an action a package
		 * spec still locks to this genre (foreign, off by default — what the
		 * companion rule left opt-in). An action's genre comes from the
		 * registrations that include it, never from a lock (D3).
		 */
		const { defaults, offered, add } = await registeredActionIdentities(db, genreId)
		// ⚠ Ordered: the tie-break below is "first-published" (see the note
		// on `resolveSubjectVerdict`'s ordering).
		const specs = await db
			.select()
			.from(schema.pipelineSpecs)
			.orderBy(asc(schema.pipelineSpecs.id))
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.status, "published"))
		const declared = new Map<string, { spec: any; action: any }>()
		for (const s of specs as any[]) {
			if (s.activeVersionId == null) continue
			const v = (versions as any[]).find((x) => x.id === s.activeVersionId)
			if (!v?.contributes) continue
			for (const a of actionsOf({ id: s.slug, contributes: v.contributes })) {
				declared.set(`${s.slug}#${a.key}`, { spec: s, action: a })
				// ⏳ A lock-era package action for this genre: offered, opt-in.
				if ((a as { genre?: string }).genre === genreId) add(`${s.slug}#${a.key}`, false)
			}
		}

		const out: GenreAction[] = []
		for (const identity of offered) {
			const hit = declared.get(identity)
			if (!hit) continue
			const { spec: s, action: a } = hit
			// 🚧 An action whose audience names nobody (`see: []`) is the
			// host's to fire — a summary (R50): registered so its values
			// resolve through the registration, never listed, never pressed.
			if (Array.isArray(a.audience?.see) && a.audience.see.length === 0) continue
			const origin =
				namespaceOf(s.slug) === namespaceOf(genreId)
					? "companion"
					: "foreign"
			out.push({
				key: a.key,
				venues: a.venue,
				audience: a.audience ?? {
					see: [...DEFAULT_ACTION_AUDIENCE.see],
					act: [...DEFAULT_ACTION_AUDIENCE.act]
				},
				effects: effectsOf(a),
				quick: a.quick === true,
				...(listedCollects(a.collects) ? { collects: listedCollects(a.collects) } : {}),
				// 🚧 Asked before it fires (`confirm`, 2026-10-18).
				...(a.confirm && en(a.confirm.question)
					? {
							confirm: {
								question: en(a.confirm.question),
								...(a.confirm.description ? { description: en(a.confirm.description) } : {}),
								confirmLabel: (a.confirm.confirmLabel ? en(a.confirm.confirmLabel) : "") || en(a.label) || a.key
							}
						}
					: {}),
				// Kept as declared, an explicit `[]` included: that is how an
				// action opts out of its genre's default (`effectiveEnabledWhen`).
				...(a.enabledWhen !== undefined && a.enabledWhen !== null
					? { enabledWhen: normalizeEnabledWhen(a.enabledWhen) }
					: {}),
				...(a.presentWhen != null && normalizeEnabledWhen(a.presentWhen).length
					? { presentWhen: normalizeEnabledWhen(a.presentWhen) }
					: {}),
				slash: slashNameOf(a, s.slug),
				icon: typeof a.icon === "string" ? a.icon : undefined,
				...(a.iconAlt ? { iconAlt: en(a.iconAlt) } : {}),
				name: en(a.label) || a.key,
				...(a.description ? { description: en(a.description) } : {}),
				specSlug: s.slug,
				origin,
				// 🚧 On by default = the genre's defaults register it (R33).
				enabledByDefault: defaults.has(identity)
			})
		}
		return out
	} catch {
		return []
	}
}

/**
 * Which spec serves a **subject** for sessions of a genre (19 §3; plans/31
 * V2, ruled 2026-09-17 — one identity for an action).
 *
 * A subject is one of two things, told apart by its grammar:
 *
 *  · an **action identity** `<spec slug>#<key>`. Its candidates are its
 *    declarer and nobody else — a spec whose active published version
 *    declares that key for this genre. Two specs declaring one key are two
 *    identities (R-15: "two things"), each its own subject;
 *  · a **core event id** `core:event/…@1`. Its candidates are the bucket:
 *    the live published versions whose inlet lock is (genre, event). For the
 *    primary turn (`message-respond`) membership is structural at both ends
 *    (19 §0): the spec must also write a session message.
 *
 * When several serve, **the binding selects**, in this order (R-6, ruled
 * 2026-09-15): the **session's own** row in `pipeline_bindings`, then — for
 * an event subject — the session's **preset** (its event binding), then the
 * **pub's** row, then the companion rule. A session is a work, not a
 * preference (12 §2): what a person chose for *this* session beats what an
 * administrator chose for every session born on the preset, and the preset
 * in turn beats the pub-wide default.
 *
 * Every binding is only ever a choice *among the eligible* — a binding whose
 * spec left the bucket (retired, republished elsewhere, deleted) falls
 * through to the next layer rather than routing to something that cannot
 * serve. With no binding, the companion rule made deterministic: a
 * contributor in the genre owner's namespace first, then first-published.
 *
 * `spec` is null when nothing serves — including when the registry never
 * synced — so callers keep their own floor (the F29 posture: routing failing
 * must degrade to the built-in behaviour, never block the turn).
 *
 * `fallback` is the one thing that must not travel as silence: the session's
 * preset named a pipeline for this event and that pipeline does not
 * answer, so the layers below chose instead (ruled 2026-09-10). It is only
 * ever computed when the preset was consulted — a session whose own binding
 * won never asked its preset, so there was no substitution to say.
 */
export interface SubjectResolution {
	spec: string | null
	/** 🚧 The registration that answers (PLAN-layering D7) — its key, for the run's record. */
	registrationKey?: string
	/** 🚧 That registration's summary depth (`minAgeOf`, pr-6 pass 9 S3) — the run's `HostScope.minAge`. */
	registrationMinAge?: number
	/**
	 * Set when the session's preset bound this event to something this
	 * instance cannot resolve, so the layers below decided instead. Carried
	 * rather than swallowed for the reason the whole verdict exists: the
	 * substitution has to be sayable.
	 */
	fallback?: PresetFallback
}

/** The one write a spec in the primary-turn bucket must make (19 §0). */
const writesASessionMessage = async (db: Db, versionId: number): Promise<boolean> => {
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, versionId))
	return (nodes as any[]).some(
		(n) => n.kind === "outlet" && n.definitionId === CHAT_WRITE_TYPE
	)
}

export async function resolveSubjectVerdict(
	db: Db,
	genreId: string,
	subject: string,
	scope?: {
		sessionId?: number | null
		/**
		 * The spec the caller has already chosen — the one whose *action*
		 * was pressed (U5c review, W1). The verdict is then only the
		 * eligibility check: that spec if a registration in force runs it
		 * for the subject, else null.
		 */
		spec?: string | null
	}
): Promise<SubjectResolution> {
	try {
		const event = isEventId(subject) ? subject : null
		const identity = event ? null : parseActionIdentity(subject)
		if (!event && !identity) return { spec: null }

		// ⏳ A transitional input-type genre (`ns:inlet/x@1`) has no
		// registrations: its reply is still found by its entry inlet.
		if (genreId.includes("@"))
			return await transitionalSubject(db, genreId, subject, scope?.spec ?? null)

		/**
		 * 🚧 The registrations in force (PLAN-layering D7, R33): the
		 * session's own rows over its preset's changes over the genre's
		 * defaults — one resolver for the reply, every event and every
		 * action. With no session in hand, the genre's defaults. The pub
		 * layer and the companion rule are retired (R33): what a session
		 * runs is what its registrations say, nothing inferred.
		 */
		// The session's registrations answer for the session's own genre; a
		// caller naming another genre is answered by that genre's defaults.
		const resolved = scope?.sessionId != null ? await effectiveRegistrations(db, scope.sessionId) : null
		if (scope?.sessionId != null && resolved && resolved.genreId === genreId) {
			const regs = event
				? onEvent(resolved.effective, event)
				: [onAction(resolved.effective, subject)].filter((r) => !!r)
			const fallback = event ? resolved.fallbacks.find((f) => f.event === event) : undefined
			const said = fallback ? { fallback } : {}
			// A named spec (W1): eligible, or nothing.
			if (scope.spec != null) {
				const named = regs.find((r) => r!.pipeline === scope.spec)
				return named ? { spec: scope.spec, registrationKey: named.key, registrationMinAge: minAgeOf(named), ...said } : { spec: null, ...said }
			}
			// An event's registrations run when their `when` holds (R31); an
			// action's `when` is its enabled-when, judged at its door.
			const runs = event ? (await whenHolds(db, scope.sessionId, regs as never)).run : regs
			return {
				spec: runs[0]?.pipeline ?? null,
				...(runs[0] ? { registrationKey: runs[0].key, registrationMinAge: minAgeOf(runs[0]) } : {}),
				...said
			}
		}
		const regs = await genreRegistrations(db, genreId)
		const hits = event ? onEvent(regs, event) : [onAction(regs, subject)].filter((r) => !!r)
		if (scope?.spec != null)
			return { spec: hits.some((r) => r!.pipeline === scope.spec) ? scope.spec : null }
		return { spec: hits[0]?.pipeline ?? (event ? await lockedEventSpec(db, genreId, event) : null) }
	} catch {
		// Routing infrastructure failing still degrades to the caller's floor
		// (F29).
		return { spec: null }
	}
}

/**
 * ⏳ A transitional plugin genre declared on an input type (pre-24 §3): the
 * primary turn's candidates are the published specs whose entry inlet pins
 * that type and which write a session message (19 §0); the first by spec id.
 * Nothing else routes for it.
 */
async function transitionalSubject(
	db: Db,
	genreId: string,
	subject: string,
	named: string | null
): Promise<SubjectResolution> {
	if (subject !== sessionEvents.messageRespond) return { spec: null }
	const [bareType, versionStr] = genreId.split("@")
	const specs = await db
		.select()
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))
	for (const s of specs as any[]) {
		if (s.activeVersionId == null) continue
		const [v] = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, s.activeVersionId))
			.limit(1)
		if (!v || v.status !== "published") continue
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, v.id))
		const entry = (nodes as any[])
			.filter((n) => n.kind === "inlet")
			.sort((a, b) => a.position - b.position)[0]
		if (!entry || entry.definitionId !== bareType || String(entry.definitionVersion) !== versionStr) continue
		if (!(await writesASessionMessage(db, v.id))) continue
		if (named != null && s.slug !== named) continue
		return { spec: s.slug }
	}
	return { spec: null }
}

/** The same answer, for the callers that only need the slug. */
export async function resolveSubjectSpec(
	db: Db,
	genreId: string,
	subject: string,
	scope?: { sessionId?: number | null }
): Promise<string | null> {
	return (await resolveSubjectVerdict(db, genreId, subject, scope)).spec
}

// ── Which of a mode's functions a session actually has (19 §3) ─────────────────

export interface SessionFunction extends GenreAction {
	/** The answer in force, after all three layers. */
	enabled: boolean
	/**
	 * True when a session row states this, false when a lower layer answered.
	 *
	 * Surfaced rather than kept private because it is the difference between
	 * "this session turned the narrator off" and "nobody here has ever said" —
	 * and the second silently follows a later change of preset or default
	 * while the first does not. A control showing only the checkbox would make
	 * those two look identical.
	 */
	explicit: boolean
	/**
	 * Whether the session's preset includes this action.
	 *
	 * The permission line runs here (ruled 2026-08-24): a non-admin may toggle
	 * an **included** action off and back on; turning on something the preset
	 * does not include is an admin's call, because it gives the session a
	 * capability the pub owner did not put in the list.
	 */
	included: boolean
	/** Which layer decided, for the control surface to explain itself. */
	source: "session" | "preset" | "default"
	/**
	 * 🚧 R56: no model on this pub can do what its pipeline needs — the
	 * sentence ("Unavailable: needs a model that can draw pictures."). Such an
	 * action is not enabled, whatever the layers say, until a model is set.
	 */
	unavailable?: string
}

/**
 * The preset governing a session, the actions it includes, and the
 * configuration the session's pipeline runs with.
 *
 * Exported for the regression that pins `configId` — see the note inside.
 *
 * "The session's preset" is the config selected for the pipeline that actually
 * serves `respond` for this mode — the one running the session's turns. Not the
 * mode-owner's by namespace, because the *serving* spec is what the binding
 * already resolves and what every other per-session setting resolves against;
 * a second notion of "this session's pipeline" would be a second answer to the
 * same question.
 *
 * Returns `null` for the action list when nothing states one — distinct from
 * `[]`, which is a preset saying *none*.
 */
/**
 * The pipeline running a session's turns, and the preset it is on.
 *
 * "This session's pipeline" is whatever serves the primary turn
 * (`core:event/message-respond@1`) for the genre — the thing actually taking
 * the turns. Not the mode owner by namespace: the *serving*
 * spec is what the binding already resolves and what every other per-session
 * setting resolves against, and a second notion of the same thing would be a
 * second answer to give when they disagree.
 *
 * Shared by the action layering and the preset picker on purpose. A picker
 * offering presets of one pipeline while the actions came from another would
 * be two halves of one fact disagreeing.
 */
export async function sessionPipeline(
	db: Db,
	sessionId: number,
	genreId: string,
	userId?: number | null
): Promise<{
	specId: number
	specSlug: string
	/** ⏳ Always null since configurations retired (R38). */
	configId: number | null
	/** ⏳ Always null since configurations retired (R38). */
	configName: string | null
} | null> {
	void userId
	try {
		const specSlug = await resolveSubjectSpec(
			db,
			genreId,
			sessionEvents.messageRespond,
			{ sessionId }
		)
		if (!specSlug) return null

		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specSlug))
			.limit(1)
		if (!spec) return null
		return { specId: spec.id, specSlug, configId: null, configName: null }
	} catch {
		return null
	}
}

export async function presetActionsFor(
	db: Db,
	sessionId: number,
	genreId: string,
	userId?: number | null
): Promise<{ configId: number | null; included: string[] | null }> {
	void genreId
	void userId
	try {
		/**
		 * 🚧 What the session's preset includes (PLAN-layering D7): the
		 * actions its effective registrations — the genre's defaults with
		 * the preset's changes — register, by identity. Never null any more:
		 * the companion rule is the genre's defaults, written out (R33).
		 */
		const resolved = await effectiveRegistrations(db, sessionId)
		if (!resolved) return { configId: null, included: null }
		return {
			configId: null,
			included: resolved.offered
				.filter((r) => r.trigger.family === "action")
				.map((r) => (r.trigger as { action: string }).action)
		}
	} catch {
		return { configId: null, included: null }
	}
}

/**
 * The one action a bare key names among what a genre is offered, or null —
 * **exactly one declarer, of any origin** (U5c third pass, W4+W2; ruled
 * 2026-09-16). The rule the reader (`presetIncludes`), both writers
 * (`normalizeIncludedActions`, `promoteIncludedActions`), migration 0137 and
 * the boot's binding re-projection (V2) share, stated once: a key several
 * actions carry names none of them, and a foreign action that is the sole
 * declarer IS what the key means — an admin who included it did so when it
 * was valid, and losing it silently would be worse than keeping it.
 */
export function soleDeclarer(
	offered: ReadonlyArray<GenreAction>,
	key: string
): GenreAction | null {
	const declarers = offered.filter((t) => t.key === key)
	return declarers.length === 1 ? declarers[0]! : null
}

/**
 * Does a preset's included set name this action?
 *
 * The set stores **identities** — `<spec slug>#<key>` (U5c review, W-A;
 * ruled 2026-09-16): a preset curates declarations, and two actions on one
 * function are two entries. Core's message verbs, should one ever be listed,
 * are bare (`edit`) because they are listed under the name `core`, not a
 * row; nothing writes them today.
 *
 * ⏳ One release: a bare key (`narrate`) written before identities
 * — by `pipelines:setPresetActions` or `sessionPresets:update` — includes
 * the action that is the genre's **sole declarer** of that key
 * (`soleDeclarer`: exactly one, of any origin) and nothing when several
 * carry it. Migration 0137 rewrites such keys by the same rule where it
 * can; this fallback covers the rows it could not (no declarer, or several,
 * at the time — the boot notice in `seedSessionPresets` lists them), and
 * goes with the release after. `offered` is the genre's whole action list,
 * so the count is over every declarer and not the one being asked about.
 */
export const presetIncludes = (
	included: ReadonlyArray<string>,
	t: GenreAction,
	offered: ReadonlyArray<GenreAction>
): boolean => {
	const identity = actionIdentity(t)
	if (included.includes(identity)) return true
	if (!included.includes(t.key)) return false
	const sole = soleDeclarer(offered, t.key)
	return sole !== null && actionIdentity(sole) === identity
}

/**
 * Does a preset include this action — its included set where it states one,
 * the **companion rule** (`enabledByDefault`) where it is `null`?
 *
 * The one statement of the preset layer, shared by the session
 * (`listSessionFunctions`) and the Pipelines view's Edit level (the
 * `effectiveIncludedActions` `sessionPresets:list` carries). A view listing a
 * preset's actions by any other rule would be two halves of one fact
 * disagreeing: every shipped preset states `null`, so the default rule is
 * what most sessions actually run on.
 */
export const includedByPreset = (
	included: ReadonlyArray<string> | null,
	t: GenreAction,
	offered: ReadonlyArray<GenreAction>
): boolean =>
	included === null ? t.enabledByDefault : presetIncludes(included, t, offered)

/**
 * The mode's functions, with each one's state on this session.
 *
 * The *available* set is the mode's contributed triggers and nothing else, so
 * a function this mode was never offered cannot be turned on here — which is
 * what "explicitly per session mode" means in practice. `respond` is absent by
 * construction: it is intrinsic (§3), not a contribution, and a session that
 * could not reply would not be a session.
 *
 * Ordered companions-first then by name, so the things the mode's own author
 * shipped read as the mode's own surface and other people's additions read as
 * additions.
 */
export async function listSessionFunctions(
	db: Db,
	sessionId: number,
	genreId: string,
	userId?: number | null
): Promise<SessionFunction[]> {
	void userId
	const available = await listGenreActions(db, genreId)
	/**
	 * 🚧 Three layers, one resolver (PLAN-layering D7): the session's own
	 * rows over its preset's changes over the genre's defaults. `included`
	 * is what the preset offers (genre ⊕ preset); `enabled` is what is in
	 * force once the session's rows apply — a row that drops an action
	 * switches it off, one that registers it switches it on.
	 */
	const resolved = await effectiveRegistrations(db, sessionId)
	const actionsIn = (regs: ReadonlyArray<{ trigger: { family: string } }> | undefined) =>
		new Set(
			(regs ?? [])
				.filter((r) => r.trigger.family === "action")
				.map((r) => (r.trigger as unknown as { action: string }).action)
		)
	const offeredIds = actionsIn(resolved?.offered)
	const inForce = actionsIn(resolved?.effective)
	const sessionKeys = new Set((resolved?.rows.session ?? []).map((r) => r.key))
	const presetKeys = new Set((resolved?.rows.preset ?? []).map((r) => r.key))
	const keyOf = (identity: string): string =>
		[...(resolved?.offered ?? []), ...(resolved?.effective ?? [])].find(
			(r) => r.trigger.family === "action" && (r.trigger as { action: string }).action === identity
		)?.key ?? actionRegistrationKey(identity)

	/**
	 * 🚧 A ruleset's actions (PLAN-rulesets-functions D6): each invokable
	 * function of the session's ruleset, run by the one rules-action
	 * pipeline — registered in the genre's layer (`effectiveRegistrations`),
	 * offered at the composer, its label and words the function header's.
	 */
	{
		const { sessionRulesActions, RULES_ACTION_SPEC } = await import("$lib/server/rulesets/rulesActions")
		for (const a of await sessionRulesActions(db, sessionId)) {
			if (available.some((t) => actionIdentity(t) === a.identity)) continue
			const key = a.identity.slice(a.identity.lastIndexOf("#") + 1)
			available.push({
				key,
				venues: [{ kind: "composer" }] as GenreAction["venues"],
				audience: { see: [...DEFAULT_ACTION_AUDIENCE.see], act: [...DEFAULT_ACTION_AUDIENCE.act] },
				effects: "fiction",
				quick: false,
				slash: slashNameOf({ key }, RULES_ACTION_SPEC),
				name: en(a.label) || a.function,
				...(a.description !== undefined ? { description: en(a.description) } : {}),
				specSlug: RULES_ACTION_SPEC,
				origin: "companion",
				enabledByDefault: true
			} as GenreAction)
		}
	}

	// A session row may switch on an action its genre's list does not carry.
	for (const identity of inForce)
		if (!available.some((t) => actionIdentity(t) === identity)) {
			const parsed = parseActionIdentity(identity)
			if (!parsed) continue
			const extra = (await listGenreActionsFor(db, identity)) as GenreAction | null
			// 🚧 Not one the host fires (an audience naming nobody — a summary, R50).
			if (extra && !(Array.isArray(extra.audience?.see) && extra.audience.see.length === 0)) available.push(extra)
		}

	/**
	 * Annex fields (2026-09-26): each settable declared field is one action,
	 * `<owner>:annex#<key>` at the `widget` venue, seen and pressed by its
	 * `act` audience. A declared capability of its package rather than a
	 * pipeline a preset registers, so it is on unless this session's own row
	 * dropped it.
	 */
	const { settableAnnexFields } = await import("$lib/server/sessions/annexFields")
	const fields: SessionFunction[] = (await settableAnnexFields(db, genreId)).map((f) => {
		const specSlug = f.identity.slice(0, f.identity.lastIndexOf("#"))
		const row = resolved?.rows.session.find((r) => r.key === actionRegistrationKey(f.identity))
		const own = row ? !row.dropped : undefined
		const act = [...(f.decl.act ?? [])]
		return {
			key: f.decl.key,
			venues: [{ kind: "widget" }],
			audience: { see: act, act } as Audience,
			effects: "fiction",
			quick: false,
			slash: slashNameOf({ key: f.decl.key }, specSlug),
			name: (f.decl.label !== undefined ? en(f.decl.label) : "") || f.decl.key,
			...(f.decl.description !== undefined ? { description: en(f.decl.description) } : {}),
			specSlug,
			origin: namespaceOf(genreId) === f.owner ? "companion" : "foreign",
			enabledByDefault: true,
			included: true,
			source: own !== undefined ? "session" : "default",
			explicit: own !== undefined,
			enabled: own !== undefined ? own : true
		}
	})

	// 🚧 R56: an action whose pipeline needs a model nothing here serves is
	// unavailable — not enabled, with the sentence that says what is missing.
	const { unservedPipelines } = await import("$lib/server/pipelines/registrations/unserved")
	const unserved = await unservedPipelines(db, available.map((t) => t.specSlug))
	return [
		...available.map((t) => {
			const identity = actionIdentity(t)
			const key = keyOf(identity)
			const included = offeredIds.has(identity)
			const explicit = sessionKeys.has(key)
			const source: SessionFunction["source"] = explicit
				? "session"
				: presetKeys.has(key)
					? "preset"
					: "default"
			const missing = unserved.get(t.specSlug)
			return {
				...t,
				included,
				source,
				explicit,
				enabled: inForce.has(identity) && !missing,
				...(missing ? { unavailable: missing.sentence } : {})
			}
		}),
		...fields
	].sort(
		(a, b) =>
			Number(b.origin === "companion") - Number(a.origin === "companion") ||
			a.name.localeCompare(b.name)
	)
}

/** One declared action by identity, in the listing's shape — for an action a session row registers. */
async function listGenreActionsFor(db: Db, identity: string): Promise<GenreAction | null> {
	const parsed = parseActionIdentity(identity)
	if (!parsed) return null
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, parsed.specSlug))
		.limit(1)
	if (!spec?.activeVersionId) return null
	const [v] = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
		.limit(1)
	if (!v || v.status !== "published" || !v.contributes) return null
	const a = actionsOf({ id: spec.slug, contributes: v.contributes }).find((x) => x.key === parsed.key)
	if (!a) return null
	return {
		key: a.key,
		venues: a.venue,
		audience: a.audience ?? { see: [...DEFAULT_ACTION_AUDIENCE.see], act: [...DEFAULT_ACTION_AUDIENCE.act] },
		effects: effectsOf(a),
		quick: a.quick === true,
		...(listedCollects(a.collects) ? { collects: listedCollects(a.collects) } : {}),
		...(a.enabledWhen !== undefined && a.enabledWhen !== null ? { enabledWhen: normalizeEnabledWhen(a.enabledWhen) } : {}),
		...(a.presentWhen != null && normalizeEnabledWhen(a.presentWhen).length
			? { presentWhen: normalizeEnabledWhen(a.presentWhen) }
			: {}),
		slash: slashNameOf(a, spec.slug),
		icon: typeof a.icon === "string" ? a.icon : undefined,
		...(a.iconAlt ? { iconAlt: en(a.iconAlt) } : {}),
		name: en(a.label) || a.key,
		...(a.description ? { description: en(a.description) } : {}),
		specSlug: spec.slug,
		origin: "foreign",
		enabledByDefault: false
	}
}

/**
 * The functions actually in force — what the session view renders and what
 * `sessions:fireAction` will fire.
 *
 * Both callers go through this rather than filtering `listGenreActions`
 * themselves, for the reason `listGenreActions` and `resolveSubjectSpec`
 * already share their criteria: a button whose press is refused, or a
 * fireable function with no button, are two halves of one fact disagreeing.
 */
export async function enabledSessionFunctions(
	db: Db,
	sessionId: number,
	genreId: string,
	userId?: number | null
): Promise<SessionFunction[]> {
	return (await listSessionFunctions(db, sessionId, genreId, userId)).filter(
		(f) => f.enabled
	)
}

export interface SetSessionFunctionResult {
	ok: boolean
	error?: string
	/** The state in force afterwards, so a caller need not re-read. */
	enabled?: boolean
}

/**
 * Turn one of the mode's functions on or off for one session.
 *
 * Two refusals, both about meaning rather than safety:
 *
 * - **A function this mode does not offer** is refused by name. Writing it
 *   would store a row that decides nothing, and the next person to read the
 *   table would find an answer to a question nobody asks.
 * - **A mode mismatch** is refused for the same reason: the row is keyed by
 *   the mode it was chosen under, so writing one against a mode the session is
 *   not in produces a row that can never apply.
 *
 * Setting a function back to its default **deletes** the row rather than
 * storing the default (reset-is-delete). That is what keeps "no opinion"
 * distinguishable from "deliberately the same as the default", and it is why
 * a companion added in a later update reaches sessions that never had a view.
 */
export async function setSessionFunction(
	db: Db,
	sessionId: number,
	genreId: string,
	/**
	 * Which action: its identity (`<spec slug>#<key>`), or the bare key when
	 * exactly one action carries it (U5c review, W1). Several actions on
	 * one key named by the bare key is refused with their identities — a
	 * choice has to be about one thing.
	 */
	ref: string,
	enabled: boolean,
	actor?: { userId?: number | null; isAdmin?: boolean }
): Promise<SetSessionFunctionResult> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { ok: false, error: "that session no longer exists" }

	const sessionGenre = session.genreId ?? STANDARD_GENRE_ID
	if (sessionGenre !== genreId)
		return {
			ok: false,
			error:
				`this session is in ${sessionGenre}, not ${genreId} — an action choice is ` +
				`stored against the genre it was made under, so one written against ` +
				`another genre could never apply`
		}

	const available = await listSessionFunctions(
		db,
		sessionId,
		genreId,
		actor?.userId
	)
	const parsed = parseActionIdentity(ref)
	const named = parsed
		? available.filter(
				(t) => t.specSlug === parsed.specSlug && t.key === parsed.key
			)
		: available.filter((t) => t.key === ref)
	if (named.length > 1)
		return {
			ok: false,
			error:
				`'${ref}' names ${named.length} actions here — ` +
				`${named.map(actionIdentity).join(", ")}. Say which.`
		}
	const decl = named[0]
	if (!decl)
		return {
			ok: false,
			error:
				`no spec contributes '${ref}' to ${genreId}. A session can only ` +
				`turn on what its genre was offered — install or publish a spec that ` +
				`contributes it, and it appears here.`
		}
	const functionKey = actionIdentity(decl)

	// The permission line (ruled 2026-08-24). Toggling an action the preset
	// **includes** is the user's own business — it is their session, and the
	// instance owner already put the action in the list. Turning on something
	// the preset leaves out gives the session a capability nobody offered it, so
	// it is an admin's call.
	//
	// Only *turning on* is gated. A non-admin switching an excluded action off
	// is asking for what they already have, and refusing that would be a rule
	// with no one to protect.
	if (enabled && !decl.included && actor && actor.isAdmin !== true)
		return {
			ok: false,
			error:
				`'${decl.name}' is not part of this session's preset. An administrator ` +
				`can add it to this session, or include it in the preset so every session ` +
				`using it has it.`
		}

	/**
	 * 🚧 Written as the session's registration row (PLAN-layering D7,
	 * §11-1) — `session_functions` is ⏳ kept unread. Reset-is-delete against
	 * the layer below (the preset's offer): agreeing with it removes the row,
	 * switching an included action off drops it here, switching on one the
	 * preset leaves out registers it here.
	 */
	const { deleteRow, upsertRow } = await import("$lib/server/pipelines/registrations/write")
	const { rowOfDecl, rowOfDrop } = await import("$lib/server/pipelines/registrations/rows")
	const resolved = await effectiveRegistrations(db, sessionId)
	const key =
		[...(resolved?.offered ?? []), ...(resolved?.effective ?? [])].find(
			(r) => r.trigger.family === "action" && (r.trigger as { action: string }).action === functionKey
		)?.key ?? actionRegistrationKey(functionKey)
	const scope = { kind: "session" as const, sessionId }
	const origin = actor?.isAdmin === true ? "admin" : "owner"
	if (enabled === decl.included) {
		await deleteRow(db, scope, key)
		return { ok: true, enabled }
	}
	if (!enabled) {
		await upsertRow(db, { ...rowOfDrop(key, scope, origin), triggerRef: functionKey })
		return { ok: true, enabled }
	}
	// 🚧 The registration door (§11-2): a session's own registration is
	// judged like any other — the action's pipeline installed, fitting, and
	// the genre's envoys — and refused in a sentence.
	const registration = actionRegistration(functionKey)
	{
		const { registrationDoor, doorSentence } = await import("$lib/server/pipelines/registrations/door")
		const verdict = await registrationDoor(db, [registration], { layer: "this session", genreId, sessionId })
		if (verdict.errors.length) return { ok: false, error: doorSentence(verdict.errors) }
	}
	await upsertRow(db, rowOfDecl(registration, scope, origin))
	return { ok: true, enabled }
}

/**
 * The mode a pipeline serves, from its entry input node.
 *
 * The mode *is* the input type (19 §0), so this is one lookup rather than a
 * declaration anybody maintains: the spec's active version, its first node,
 * its pinned type. A spec whose entry input carries no shape is not serving a
 * mode and returns null — `summarize-request` is the case.
 *
 * Exists so the preset editor can offer the right action list. Without it the
 * editor would need its own idea of which actions belong to a pipeline, which
 * is the second answer this codebase keeps finding at the point where the two
 * disagree.
 */
export async function genreOfSpec(
	db: Db,
	specSlug: string
): Promise<string | null> {
	try {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specSlug))
			.limit(1)
		if (!spec?.activeVersionId) return null

		// 🚧 The genre whose defaults register it (PLAN-layering D3, D7): a
		// pipeline mounted by registrations has no lock to say.
		const [registered] = await db
			.select({ genreId: schema.registrations.scopeRef })
			.from(schema.registrations)
			.where(
				and(
					eq(schema.registrations.scopeKind, "genre"),
					eq(schema.registrations.specSlug, specSlug)
				)
			)
			.orderBy(asc(schema.registrations.id))
			.limit(1)
		if (registered?.genreId) return registered.genreId

		// ⏳ The input lock answers directly (24 §4).
		const [version] = await db
			.select({
				inputGenre: schema.pipelineSpecVersions.inputGenre
			})
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
			.limit(1)
		if (version?.inputGenre) return version.inputGenre

		// Transitional: a shape-bearing entry input type is a genre.
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId))
		const entry = (nodes as any[])
			.filter((n) => n.kind === "inlet")
			.sort((a, b) => a.position - b.position)[0]
		if (!entry) return null

		const genreId = `${entry.definitionId}@${entry.definitionVersion}`
		// Only a *shape-bearing* input type is a mode. Checked against the
		// registry rather than assumed, so a pipeline whose entry is an
		// ordinary input does not acquire a mode by having one.
		const [row] = await db
			.select({ sessionShape: schema.pipelineDefinitionRegistry.sessionShape })
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, entry.definitionId),
					eq(
						schema.pipelineDefinitionRegistry.version,
						Number(entry.definitionVersion)
					)
				)
			)
			.limit(1)
		return row?.sessionShape ? genreId : null
	} catch {
		return null
	}
}

/**
 * A preset's included set as it is stored: every entry an **identity** of an
 * action the genre is offered (W-A). The refusals are about meaning — an
 * entry no spec contributes would put a key in the list that can never
 * match anything, and the next person to read the row would find an answer
 * to a question nobody asks.
 *
 * ⏳ A bare function key is accepted while exactly one action of any origin
 * carries it (`soleDeclarer`), and stored as that action's identity — the
 * same reading `presetIncludes` gives a bare key left in a row — so a
 * client still sending the pre-identity shape lands the identity rather
 * than the key. A bare key several actions carry is refused with the
 * identities: a curation has to be about one thing. The strict writer; the
 * paths that may not refuse (boot, a copy) run `promoteIncludedActions`.
 */
export function normalizeIncludedActions(
	offered: ReadonlyArray<GenreAction>,
	included: ReadonlyArray<string>
): { ok: true; included: string[] } | { ok: false; error: string } {
	const out: string[] = []
	for (const entry of included) {
		const parsed = parseActionIdentity(entry)
		if (parsed) {
			const named = offered.find(
				(t) => t.specSlug === parsed.specSlug && t.key === parsed.key
			)
			if (!named)
				return {
					ok: false,
					error:
						`nothing contributes '${entry}' to this pipeline's genre, so ` +
						`including it would put a key in the list that can never match.`
				}
			out.push(entry)
			continue
		}
		const sole = soleDeclarer(offered, entry)
		if (sole) {
			out.push(actionIdentity(sole))
			continue
		}
		// Not one, so none or several — a single declarer was promoted above.
		const byKey = offered.filter((t) => t.key === entry)
		if (byKey.length)
			return {
				ok: false,
				error:
					`'${entry}' names ${byKey.length} actions here — ` +
					`${byKey.map(actionIdentity).join(", ")}. A preset includes an action by ` +
					`its identity ('<spec slug>#<key>'). Say which.`
			}
		return {
			ok: false,
			error:
				`nothing contributes '${entry}' to this pipeline's genre, so ` +
				`including it would put a key in the list that can never match.`
		}
	}
	return { ok: true, included: [...new Set(out)] }
}

/**
 * The lenient half of `normalizeIncludedActions`, for the paths that may
 * never refuse: a plugin preset projected at boot (`syncPluginPresets`) and
 * a preset copied from another (`sessionPresets:create` with `fromPresetId`).
 *
 * The same promotion — a bare key becomes the identity of the genre's sole
 * declarer of that key (`soleDeclarer`, any origin) — but a bare key
 * that cannot be promoted is **kept bare** and returned in `bare` for the
 * caller to report, rather than refused: a boot that refuses a manifest's
 * preset is a boot that offers nothing, and a copy that refuses is a copy
 * that lost a curation somebody made. Such a key is still served by
 * `presetIncludes`' ⏳ fallback, and it has one more chance at promotion on
 * the next sync or write. Identities pass through verbatim, deduplicated.
 */
export function promoteIncludedActions(
	offered: ReadonlyArray<GenreAction>,
	included: ReadonlyArray<string>
): { included: string[]; bare: string[] } {
	const out: string[] = []
	const bare: string[] = []
	for (const entry of included) {
		if (parseActionIdentity(entry)) {
			out.push(entry)
			continue
		}
		const sole = soleDeclarer(offered, entry)
		if (sole) {
			out.push(actionIdentity(sole))
			continue
		}
		out.push(entry)
		bare.push(entry)
	}
	return { included: [...new Set(out)], bare: [...new Set(bare)] }
}

/**
 * ⏳ The legacy squat on a pipeline configuration's actions and its "may be
 * chosen" switch — retired with configurations (R38; R50, 0110: nothing
 * reads a configuration). A preset's actions are its registrations
 * (`sessionPresets:update`); this answers every caller with the refusal and
 * touches nothing. Kept one release for the callers that still name it.
 */
export async function setPresetActions(
	_db: Db,
	_configId: number,
	_patch: { includedActions?: string[] | null; enabled?: boolean }
): Promise<{ ok: boolean; error?: string }> {
	return {
		ok: false,
		error:
			"A pipeline configuration no longer carries actions — configurations are retired. " +
			"Change which actions a session preset offers in the preset itself."
	}
}
