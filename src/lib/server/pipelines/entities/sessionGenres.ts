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
import { answersEvent } from "$lib/server/pipelines/entities/presetBindings"
import {
	presetEventSpec,
	type PresetFallback
} from "$lib/server/pipelines/entities/presetBindings"
import { i18nText, type EnvoyDecl, type I18n, type SessionShape } from "@serene-pub/sdk"
import { listedCollects, type ListedCollects } from "$lib/shared/actions/collects"
import {
	resolvePlayerLabel,
	storedPlayerLabel
} from "$lib/shared/sessions/playerLabel"

/** The F29 floor: always present, the default and the backfill (24 §3). */
export const STANDARD_GENRE_ID = "core:genre/chat"

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
	const fromSpecs: SessionGenre[] = (specRows as any[])
		.filter(
			(r) =>
				r.activeVersionId === r.versionId &&
				r.inputEvent === sessionEvents.sessionCreated &&
				r.inputGenre &&
				r.genre?.shape
		)
		.map((r) => ({
			genreId: r.inputGenre,
			name: en(r.genre?.name) || r.inputGenre,
			description: en(r.genre?.description),
			family: typeof r.genre?.family === "string" ? r.genre.family : undefined,
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
		}))

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
	if (shape.lorebook === "required" && !session.hasLorebook)
		out.push("this genre requires a lorebook and the session has none")
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
		return cascadeFields({
			declared: ((genre?.shape as any)?.fields ?? {}) as Record<
				string,
				{ default?: unknown }
			>,
			pinned: genre?.settings ?? {},
			stored: (session.genreFields ?? {}) as Record<string, unknown>
		})
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
 * The cascade (§4.13) over declared ∪ pinned keys, in that order — declared
 * first so the form's order is the document's, pinned-only keys after.
 */
export function cascadeFields(layers: {
	declared: Record<string, { default?: unknown }>
	pinned: Readonly<Record<string, unknown>>
	stored: Record<string, unknown>
}): Record<string, unknown> {
	const { declared, pinned, stored } = layers
	const out: Record<string, unknown> = {}
	const keys = [
		...Object.keys(declared),
		...Object.keys(pinned).filter((k) => !(k in declared))
	]
	for (const key of keys) {
		const isDeclared = key in declared
		// The session layer exists only for a declared field: a stored value
		// under an undeclared key is not a field and cannot be smuggled in.
		if (isDeclared && key in stored && stored[key] !== undefined) {
			out[key] = stored[key]
			continue
		}
		if (key in pinned && pinned[key] !== undefined) {
			out[key] = pinned[key]
			continue
		}
		const fallback = isDeclared ? declared[key]?.default : undefined
		if (fallback !== undefined) out[key] = fallback
	}
	return out
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
export async function listGenreActions(
	db: Db,
	genreId: string
): Promise<GenreAction[]> {
	try {
		// ⚠ Ordered. The tie-break below is "first-published", and an
		// unordered SELECT makes that whatever order the heap returns —
		// which differs between a freshly seeded database and one that has
		// been rewritten a few hundred times. Two installs with identical
		// data would route the same session to different pipelines, and only one
		// of them would ever see it go wrong.
		const specs = await db
			.select()
			.from(schema.pipelineSpecs)
			.orderBy(asc(schema.pipelineSpecs.id))
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.status, "published"))
		const out: GenreAction[] = []
		for (const s of specs as any[]) {
			if (s.activeVersionId == null) continue
			const v = (versions as any[]).find(
				(x) => x.id === s.activeVersionId
			)
			if (!v?.contributes) continue
			for (const a of actionsOf({ id: s.slug, contributes: v.contributes })) {
				if (a.genre !== genreId) continue
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
					enabledByDefault: origin === "companion"
				})
			}
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
		 * eligibility check: that spec if it currently serves the subject
		 * for this genre, else null. No binding layer is consulted, because
		 * a binding selects among alternatives when nobody named one, and
		 * here somebody did.
		 */
		spec?: string | null
	}
): Promise<SubjectResolution> {
	let fallback: PresetFallback | undefined
	try {
		/**
		 * A genre id carries no `@`; a transitional input-type genre does.
		 * Dispatch for genre ids keys on the input lock — (genre, event) as
		 * columns (24 §3/§4); the type-matching path below serves only the
		 * transitional plugin genres.
		 */
		const [bareType, versionStr] = genreId.split("@")
		const isGenreId = versionStr === undefined
		const genreNamespace = genreId.split(":")[0]
		const event = isEventId(subject) ? subject : null
		const identity = event ? null : parseActionIdentity(subject)
		if (!event && !identity) return { spec: null }

		// ⚠ Ordered. The tie-break below is "first-published", and an
		// unordered SELECT makes that whatever order the heap returns —
		// which differs between a freshly seeded database and one that has
		// been rewritten a few hundred times. Two installs with identical
		// data would route the same session to different pipelines, and only one
		// of them would ever see it go wrong.
		const specs = await db
			.select()
			.from(schema.pipelineSpecs)
			.orderBy(asc(schema.pipelineSpecs.id))
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.status, "published"))
		const activeBySpec = new Map<number, any>()
		for (const s of specs as any[])
			if (s.activeVersionId != null)
				activeBySpec.set(
					s.id,
					(versions as any[]).find((v) => v.id === s.activeVersionId)
				)

		const candidates: Array<{ slug: string; namespace: string }> = []

		if (event) {
			const primary = event === sessionEvents.messageRespond
			for (const s of specs as any[]) {
				const v = activeBySpec.get(s.id)
				if (!v) continue
				/**
				 * The bucket, genre-first (24 §4): the input lock declares
				 * (genre, event) as columns, so membership is a field check —
				 * this spec answers the event for this genre.
				 */
				if (isGenreId) {
					if (v.inputGenre !== genreId || !answersEvent(v, event)) continue
				} else {
					if (!primary) continue
					/**
					 * Transitional (plugin input-type genres): entry input pins
					 * the genre's type — and the primary-write signature below
					 * still applies (19 §0), because `graph-build` reads a
					 * session exactly as a reply does and must not answer one.
					 */
					const nodes = await db
						.select()
						.from(schema.pipelineNodes)
						.where(eq(schema.pipelineNodes.specVersionId, v.id))
					const entry = (nodes as any[])
						.filter((n) => n.kind === "inlet")
						.sort((a, b) => a.position - b.position)[0]
					if (
						!entry ||
						entry.definitionId !== bareType ||
						String(entry.definitionVersion) !== versionStr
					)
						continue
				}
				// The primary turn: membership is structural at both ends —
				// what the pipeline reads (above) and what it writes (19 §0).
				if (primary && !(await writesASessionMessage(db, v.id))) continue
				candidates.push({
					slug: s.slug,
					namespace: String(s.slug).split(":")[0]
				})
			}
		} else if (identity) {
			// The declarer, and only the declarer: the identity names it.
			const s = (specs as any[]).find((x) => x.slug === identity.specSlug)
			const v = s ? activeBySpec.get(s.id) : undefined
			if (
				s &&
				v?.contributes &&
				actionsOf({ id: s.slug, contributes: v.contributes }).some(
					(a) => a.genre === genreId && a.key === identity.key
				)
			)
				candidates.push({
					slug: s.slug,
					namespace: String(s.slug).split(":")[0]
				})
		}

		// A named spec (W1): eligible, or nothing — the layers below are for
		// a fire that named none.
		if (scope?.spec != null)
			return {
				spec: candidates.some((c) => c.slug === scope.spec)
					? scope.spec
					: null
			}

		// The binding selects (19 §3). Eligibility is re-checked at every
		// layer — a bound spec must still be a candidate to win — and there
		// is no user layer (simplified 2026-08-24).
		const slugBySpecId = new Map<number, string>(
			(specs as any[]).map((s) => [s.id, s.slug])
		)
		const eligible = new Set(candidates.map((c) => c.slug))
		const bindings = (await db
			.select()
			.from(schema.pipelineBindings)
			.where(
				and(
					eq(schema.pipelineBindings.genreId, genreId),
					eq(schema.pipelineBindings.subject, subject)
				)
			)) as any[]
		const boundAt = (kind: string, id: number): string | null => {
			const row = bindings.find(
				(b) => b.scopeKind === kind && b.scopeId === id
			)
			const slug = row ? slugBySpecId.get(row.specId) : undefined
			return slug && eligible.has(slug) ? slug : null
		}

		// 1. The session's own binding (R-6). A work, not a preference: the
		//    person's choice for this session is the first thing consulted,
		//    and the preset is never asked when it answers — so no fallback
		//    account is owed either.
		if (scope?.sessionId != null) {
			const own = boundAt("session", scope.sessionId)
			if (own) return { spec: own }
		}

		/**
		 * 2. The session's preset (24 §1), through the same reader
		 *    `resolveSessionEventSpec` uses — two doors onto one fact, so a
		 *    reply and a dispatched event agree on the session and preset
		 *    layers. ⚠ Only those: this resolver also reads the pub
		 *    binding (layer 3) and the companion rule, and the dispatcher
		 *    reads neither, so a pub-scope binding of a turn-order event
		 *    is stored and never dispatched (A7r review; owed). An event
		 *    subject only: a preset binds events, never actions.
		 *
		 * A binding that stopped resolving carries on to the layers below and
		 * takes its account with it (ruled 2026-09-10): the reply still
		 * happens, on whatever the bucket would have chosen, and every surface
		 * says which and why.
		 */
		if (event) {
			const verdict = await presetEventSpec(db, {
				sessionId: scope?.sessionId,
				genreId,
				event
			})
			if (verdict.via === "preset") return { spec: verdict.spec }
			if (verdict.via === "fallback") {
				const { via: _via, spec: _spec, ...rest } = verdict
				fallback = rest
			}
		}

		if (!candidates.length)
			return { spec: null, ...(fallback ? { fallback } : {}) }

		// 3. The pub's binding — an administrator's default for every
		//    session of the genre that neither chose for itself nor was born
		//    on a preset that did.
		const pubWide = boundAt("pub", 0)
		if (pubWide)
			return { spec: pubWide, ...(fallback ? { fallback } : {}) }

		// 4. The companion rule.
		const companion = candidates.find((c) => c.namespace === genreNamespace)
		return {
			spec: (companion ?? candidates[0]!).slug,
			...(fallback ? { fallback } : {})
		}
	} catch {
		// Routing infrastructure failing still degrades to the caller's floor
		// (F29). So does a preset binding pointing at nothing — the difference
		// is that the second one is *reported*, on the verdict, all the way
		// out to the receipt and the screens.
		return { spec: null, ...(fallback ? { fallback } : {}) }
	}
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
	configId: number | null
	configName: string | null
} | null> {
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

		const { resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const selected = await resolveSelectedConfig(db, spec.id, specSlug, {
			sessionId
		})
		return {
			specId: spec.id,
			specSlug,
			configId: selected?.configId ?? null,
			configName: selected?.name ?? null
		}
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
	try {
		/**
		 * The serving pipeline's configuration — resolved for EVERY session,
		 * whether or not it names a preset.
		 *
		 * ⚠ Never skipped for a session with a preset: a preset-born session
		 * has a configuration just as a preset-less one does.
		 * `resolveSelectedConfig` is itself preset-aware, so this one call
		 * answers for both kinds of session.
		 */
		const pipeline = await sessionPipeline(db, sessionId, genreId, userId)
		const configId = pipeline?.configId ?? null

		// The session preset is the ruled home of action curation (24 §1,
		// admin IA 2026-08-28): a session born from a preset reads that
		// preset's list. The config-row path below survives as the fallback
		// for sessions with no preset, until the legacy squat retires fully.
		const [session] = await db
			.select({ presetId: schema.sessions.presetId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (session?.presetId != null) {
			const [preset] = await db
				.select({
					includedActions: schema.sessionPresets.includedActions
				})
				.from(schema.sessionPresets)
				.where(eq(schema.sessionPresets.id, session.presetId))
				.limit(1)
			if (preset) {
				const raw = preset.includedActions
				return {
					configId,
					included: Array.isArray(raw) ? raw.map(String) : null
				}
			}
		}

		if (configId == null) return { configId: null, included: null }

		const [config] = await db
			.select({
				id: schema.pipelineConfigs.id,
				includedActions: schema.pipelineConfigs.includedActions
			})
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
			.limit(1)

		const raw = config?.includedActions
		return {
			configId: config?.id ?? null,
			included: Array.isArray(raw) ? raw.map(String) : null
		}
	} catch {
		// Routing or config resolution failing must not decide a session has no
		// actions — the F29 posture. Fall through to the companion rule.
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
	const available = await listGenreActions(db, genreId)
	const rows = await db
		.select()
		.from(schema.sessionFunctions)
		.where(
			and(
				eq(schema.sessionFunctions.sessionId, sessionId),
				eq(schema.sessionFunctions.genreId, genreId)
			)
		)
	const stated = new Map<string, boolean>(
		(rows as any[]).map((r) => [r.functionKey as string, !!r.enabled])
	)
	/**
	 * A row is keyed by the action's identity — `<spec slug>#<key>` — so two
	 * actions sharing a key switch independently (U5c review, W1). Identity
	 * only (plans/31 V2): a row keyed any other way answers for nothing.
	 */
	const statedFor = (t: GenreAction): boolean | undefined =>
		stated.get(actionIdentity(t))

	const preset = await presetActionsFor(db, sessionId, genreId, userId)

	/**
	 * Annex fields (2026-09-26): each settable declared field is one action,
	 * `<owner>:annex#<key>` at the `widget` venue, seen and pressed by its
	 * `act` audience. A declared capability of its package rather than a
	 * pipeline a preset picks, so it is on unless this session's own row
	 * turned it off — a preset's included set does not reach it.
	 */
	const { settableAnnexFields } = await import("$lib/server/sessions/annexFields")
	// Only a field that names who may set it (`act`) is an action; one
	// without is pipeline-written only (ruling 2026-09-26) and never listed.
	const fields: SessionFunction[] = (await settableAnnexFields(db, genreId)).map((f) => {
		const specSlug = f.identity.slice(0, f.identity.lastIndexOf("#"))
		const own = stated.get(f.identity)
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

	return [
		...available
		.map((t) => {
			// Three layers, first answer wins: the session's own row, then the
			// preset's included set, then the companion rule. Each is only
			// consulted where the one above it said nothing, which is what
			// lets a preset change reach sessions that never had a view while
			// leaving alone the ones that did.
			const included = includedByPreset(preset.included, t, available)
			const own = statedFor(t)
			const source: SessionFunction["source"] =
				own !== undefined
					? "session"
					: preset.included === null
						? "default"
						: "preset"
			return {
				...t,
				included,
				source,
				explicit: own !== undefined,
				enabled: own !== undefined ? own : included
			}
		}),
		...fields
	]
		.sort(
			(a, b) =>
				Number(b.origin === "companion") -
					Number(a.origin === "companion") ||
				a.name.localeCompare(b.name)
		)
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

	const where = and(
		eq(schema.sessionFunctions.sessionId, sessionId),
		eq(schema.sessionFunctions.genreId, genreId),
		eq(schema.sessionFunctions.functionKey, functionKey)
	)
	// Reset-is-delete against the layer *below* this one — the preset's answer,
	// or the companion rule where the preset states nothing. Comparing against
	// the companion rule alone would leave a row behind every time somebody
	// agreed with their preset, and those rows would then outlive the preset.
	if (enabled === decl.included) {
		await db.delete(schema.sessionFunctions).where(where)
		return { ok: true, enabled }
	}

	const [existing] = await db
		.select({ id: schema.sessionFunctions.id })
		.from(schema.sessionFunctions)
		.where(where)
		.limit(1)

	if (existing)
		await db
			.update(schema.sessionFunctions)
			.set({ enabled, updatedAt: new Date() })
			.where(eq(schema.sessionFunctions.id, existing.id))
	else
		await db
			.insert(schema.sessionFunctions)
			.values({ sessionId, genreId, functionKey, enabled })

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

		// The input lock answers directly (24 §4).
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
 * Set which actions a preset includes, and whether it may be chosen.
 *
 * Admin-only at the socket; the refusals here are about meaning. An immutable
 * preset is refused because core's shipped rows are "selectable and copyable,
 * never edited in place" — the same rule the rest of the panel runs under, so
 * the answer to "why can't I edit this" is one answer everywhere. The list is
 * validated and stored **by identity** (`normalizeIncludedActions`): an
 * action no spec contributes to this pipeline's mode is refused by name,
 * because storing it would put a key in the list that can never match
 * anything.
 *
 * ⏳ This writes the legacy squat on `pipeline_configs.included_actions`;
 * `session_presets.included_actions` (`sessionPresets:update`) is the ruled
 * home and runs the same normaliser.
 */
export async function setPresetActions(
	db: Db,
	configId: number,
	patch: { includedActions?: string[] | null; enabled?: boolean }
): Promise<{ ok: boolean; error?: string }> {
	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, configId))
		.limit(1)
	if (!config) return { ok: false, error: "that preset no longer exists" }

	if (config.isImmutable)
		return {
			ok: false,
			error:
				`'${config.name}' is shipped with Serene Pub and is never edited in ` +
				`place. Duplicate it and edit the copy.`
		}

	let includedActions = patch.includedActions
	if (includedActions != null) {
		const [spec] = await db
			.select({ slug: schema.pipelineSpecs.slug })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, config.specId))
			.limit(1)
		const genreId = spec ? await genreOfSpec(db, spec.slug) : null
		const offered = genreId ? await listGenreActions(db, genreId) : []
		const normalized = normalizeIncludedActions(offered, includedActions)
		if (!normalized.ok) return normalized
		includedActions = normalized.included
	}

	await db
		.update(schema.pipelineConfigs)
		.set({
			...(includedActions !== undefined ? { includedActions } : {}),
			...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelineConfigs.id, configId))

	return { ok: true }
}

// ── The preset a session runs on (19 §7, ruled 2026-08-24) ────────────────────

export interface PresetOption {
	configId: number
	name: string
	/** The pipeline's own default — pre-selected when nothing was chosen. */
	isDefault: boolean
	/** Whether a non-admin may choose it. Admins see disabled ones too. */
	enabled: boolean
	/** Core's shipped preset, or a plugin's: selectable, never edited. */
	readOnly: boolean
}

/**
 * The presets a session may run on, and the one it is on.
 *
 * A *preset* is a pipeline configuration a person is allowed to see and use —
 * the two are one idea. What is on offer is
 * therefore the configurations of the pipeline serving this session's mode, minus
 * the ones an administrator has switched off.
 *
 * Disabled presets are still listed **for an admin**, marked, because an admin
 * disabling one and then not finding it in the list would look like it had
 * been deleted. A non-admin never sees them: that is what the switch is for.
 */
export async function listSessionPresets(
	db: Db,
	sessionId: number,
	genreId: string,
	viewer: { userId?: number | null; isAdmin?: boolean }
): Promise<{
	specSlug: string | null
	selectedId: number | null
	options: PresetOption[]
}> {
	const pipeline = await sessionPipeline(db, sessionId, genreId, viewer.userId)
	if (!pipeline) return { specSlug: null, selectedId: null, options: [] }

	const rows = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, pipeline.specId))
		.orderBy(asc(schema.pipelineConfigs.id))

	const options = (rows as any[])
		.filter((c) => viewer.isAdmin === true || c.enabled !== false)
		.map((c) => ({
			configId: c.id as number,
			name: c.name as string,
			isDefault: !!c.isDefault,
			enabled: c.enabled !== false,
			readOnly: !!c.isImmutable
		}))

	return {
		specSlug: pipeline.specSlug,
		selectedId: pipeline.configId,
		options
	}
}

/**
 * Put a session on a preset.
 *
 * Writes a **session-scope** selection, which is the same row `pipelines:
 * selectConfig` writes — one mechanism, so a preset chosen here and one chosen
 * from the pipeline panel are the same fact rather than two that can disagree.
 *
 * The refusal that matters is the disabled one. `enabled` is the
 * administrator's answer to "what may people choose", and a picker that hid a
 * preset while the write accepted it would make the switch advisory — anything
 * able to emit a socket event would still get it.
 */
export async function chooseSessionPreset(
	db: Db,
	sessionId: number,
	genreId: string,
	configId: number,
	viewer: { userId?: number | null; isAdmin?: boolean }
): Promise<{ ok: boolean; error?: string }> {
	const pipeline = await sessionPipeline(db, sessionId, genreId, viewer.userId)
	if (!pipeline)
		return {
			ok: false,
			error: "no pipeline serves this session's genre, so there is nothing to configure"
		}

	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, configId))
		.limit(1)
	if (!config) return { ok: false, error: "that preset no longer exists" }

	if (config.specId !== pipeline.specId)
		return {
			ok: false,
			error:
				`'${config.name}' belongs to a different pipeline. Presets are ` +
				`namespaced to the pipeline they were written for.`
		}

	if (config.enabled === false && viewer.isAdmin !== true)
		return {
			ok: false,
			error: `'${config.name}' is not available to choose.`
		}

	const { selectConfig } = await import("$lib/server/pipelines/config/named")
	await selectConfig(
		db,
		pipeline.specId,
		"session",
		sessionId,
		configId,
		viewer.userId ?? undefined
	)
	return { ok: true }
}
