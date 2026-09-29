/**
 * Envoys, as the host reads them (plans/29 R-18, R-21 (6); 09-B B10; ruled
 * 2026-09-15, built 2026-09-16 as U5g).
 *
 * An envoy is a speaker a **genre** or a **contributed action** brings with
 * it — declared in one of those two places and nowhere else (SDK
 * `EnvoyDecl`). This module is the one reader of both: what a session's
 * genre declares, off the create spec's version row (`SessionGenre.envoys`),
 * and what the installed actions serving that genre declare, off their
 * published `contributes.actions[].envoy`. Everything that needs to know
 * "is `envoy:<slug>` real here" — the resolver, the cast read, seating, the
 * session view, the inspector — asks this and re-derives nothing.
 *
 * Slugs: a genre's envoy is addressed by its key; an action's by
 * `<plugin>.<key>` (`envoySlugOf`), so the two cannot collide. The origin is
 * a fact of the declaration (`DeclaredEnvoy.origin`), never re-derived from
 * the slug.
 */

import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	actionsOf,
	envoySlugOf,
	i18nText,
	type EnvoyDecl,
	type EnvoySpeaks
} from "@serene-pub/sdk"
import { DEFAULT_CHANNEL, parseChannel } from "$lib/server/messages/channels"
import {
	getSessionGenre,
	STANDARD_GENRE_ID
} from "$lib/server/pipelines/entities/sessionGenres"

/** One envoy this session may seat or hear from, with where it came from. */
export interface DeclaredEnvoy {
	/** The address — `mascot`, `acme.master`. */
	slug: string
	/** The declaring key, bare. */
	key: string
	origin: "genre" | "action"
	/** The contributing spec, for an action's envoy. */
	specSlug?: string
	name: EnvoyDecl["name"]
	description?: EnvoyDecl["description"]
	image?: string
	prompts?: EnvoyDecl["prompts"]
	default: boolean
	/**
	 * The genre's fallback envoy (`EnvoyDecl.fallback`, ruled 2026-09-26) —
	 * the speaker a line nobody claims posts as. A genre's envoy only.
	 */
	fallback: boolean
	speaks: EnvoySpeaks
	/**
	 * The line this envoy opens a new session with (`EnvoyDecl.greeting`,
	 * lair re-plan R6) — a genre's envoy only. Read by
	 * `core:query/envoy-greeting@1` (`collectEnvoyGreeting`).
	 */
	greeting?: EnvoyDecl["greeting"]
}

const fromDecl = (
	e: EnvoyDecl,
	slug: string,
	origin: DeclaredEnvoy["origin"],
	specSlug?: string
): DeclaredEnvoy => ({
	slug,
	key: e.key,
	origin,
	...(specSlug ? { specSlug } : {}),
	name: e.name,
	...(e.description ? { description: e.description } : {}),
	...(e.image ? { image: e.image } : {}),
	...(e.prompts ? { prompts: e.prompts } : {}),
	default: e.default === true,
	fallback: origin === "genre" && e.fallback === true,
	speaks: e.speaks ?? (origin === "action" ? "on-action" : "in-turn"),
	...(origin === "genre" && e.greeting ? { greeting: e.greeting } : {})
})

/**
 * The declarations, read once per genre per boot (U5g review, S4).
 *
 * `declaredEnvoys` is on every view, every trigger iteration and every run
 * start, and each read is four SELECTs over rows that change at exactly one
 * place: the pointer move in `boot/store.ts` `publishVersion`, which is the
 * only writer of a spec's active version and of a version's status. That
 * writer calls `invalidateDeclaredEnvoys`; nothing else needs to. Keyed by
 * the database handle so a test's second database — or a transaction's
 * handle — never reads another's answer.
 */
let declaredCache = new WeakMap<object, Map<string, DeclaredEnvoy[]>>()

/** Forget every cached declaration — the publish path's one obligation. */
export function invalidateDeclaredEnvoys(): void {
	// A WeakMap cannot be cleared; a new one is the same thing.
	declaredCache = new WeakMap()
}

/**
 * Every envoy declared for a genre: the genre's own, then each installed
 * action's — the same "published, active version" criteria `listGenreActions`
 * uses, so an action's envoy exists here exactly when its action is offered.
 * A fresh array each time; the cached one is nobody's to mutate.
 */
export async function declaredEnvoys(
	db: Db,
	genreId: string
): Promise<DeclaredEnvoy[]> {
	let perGenre = declaredCache.get(db as object)
	if (!perGenre) {
		perGenre = new Map()
		declaredCache.set(db as object, perGenre)
	}
	const cached = perGenre.get(genreId)
	if (cached) return cached.map((d) => ({ ...d }))
	const read = await readDeclaredEnvoys(db, genreId)
	// Frozen deep enough that a caller mutating its "fresh" copy's `prompts`
	// — shallow-cloned above, so still the cached object — throws in strict
	// mode instead of corrupting every other reader's cache.
	for (const d of read) {
		if (d.prompts) Object.freeze(d.prompts)
		if (d.greeting) Object.freeze(d.greeting)
		Object.freeze(d)
	}
	perGenre.set(genreId, read)
	return read.map((d) => ({ ...d }))
}

async function readDeclaredEnvoys(
	db: Db,
	genreId: string
): Promise<DeclaredEnvoy[]> {
	const out: DeclaredEnvoy[] = []
	const genre = await getSessionGenre(db, genreId)
	for (const e of genre?.envoys ?? []) out.push(fromDecl(e, e.key, "genre"))

	const specs = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))
	const versions = await db
		.select({
			id: schema.pipelineSpecVersions.id,
			contributes: schema.pipelineSpecVersions.contributes
		})
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.status, "published"))
	for (const s of specs) {
		if (s.activeVersionId == null) continue
		const v = versions.find((x) => x.id === s.activeVersionId)
		if (!v?.contributes) continue
		for (const a of actionsOf({ id: s.slug, contributes: v.contributes })) {
			if (a.genre !== genreId || !a.envoy) continue
			out.push(
				fromDecl(
					a.envoy,
					envoySlugOf({ action: { specId: s.slug } }, a.envoy.key),
					"action",
					s.slug
				)
			)
		}
	}
	return out
}

/** The envoys declared for a session's genre, by the session. */
export async function sessionDeclaredEnvoys(
	db: Db,
	sessionId: number
): Promise<DeclaredEnvoy[]> {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { genreId: true }
	})
	if (!session) return []
	return declaredEnvoys(db, session.genreId ?? STANDARD_GENRE_ID)
}

/** A seated envoy: the cast row joined to its declaration. */
export interface SeatedEnvoy extends DeclaredEnvoy {
	position: number
	removedAt: Date | null
}

/**
 * The envoys seated in a session — live and departed, like the character
 * rows the cast read returns — each joined to its declaration. A seat whose
 * declaration is gone (the genre stopped declaring it, the action was
 * retired) is dropped here: a slug nothing declares is `none` to the
 * resolver and has no card to render, and listing it would be a name with
 * nothing behind it.
 */
export async function seatedEnvoys(
	db: Db,
	sessionId: number
): Promise<SeatedEnvoy[]> {
	const [declared, rows] = await Promise.all([
		sessionDeclaredEnvoys(db, sessionId),
		db
			.select({
				envoySlug: schema.sessionCharacters.envoySlug,
				position: schema.sessionCharacters.position,
				removedAt: schema.sessionCharacters.removedAt
			})
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
	])
	const bySlug = new Map(declared.map((d) => [d.slug, d]))
	const out: SeatedEnvoy[] = []
	for (const r of rows) {
		if (!r.envoySlug) continue
		const decl = bySlug.get(r.envoySlug)
		if (!decl) continue
		out.push({ ...decl, position: r.position ?? 0, removedAt: r.removedAt })
	}
	return out.sort((a, b) => a.position - b.position)
}

/**
 * Seat an envoy in a session — a cast row with `envoy_slug` set. Idempotent:
 * a live seat is left alone; a departed one is revived. Refuses a slug the
 * session's genre and installed actions do not declare, with a sentence.
 * Answers whether the seat changed (it was not live before), so a caller
 * emits `member-added` only for a real change (M3 review).
 */
export async function seatEnvoy(
	db: Db,
	sessionId: number,
	slug: string,
	position = 0
): Promise<boolean> {
	const declared = await sessionDeclaredEnvoys(db, sessionId)
	if (!declared.some((d) => d.slug === slug))
		throw new Error(
			`'${slug}' is not an envoy this session's genre or its installed actions declare` +
				(declared.length
					? ` — it declares ${declared.map((d) => `'${d.slug}'`).join(", ")}`
					: " — it declares none")
		)
	const [before] = await db
		.select({ removedAt: schema.sessionCharacters.removedAt })
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				eq(schema.sessionCharacters.envoySlug, slug)
			)
		)
		.limit(1)
	const wasLive = !!before && before.removedAt == null
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: null, envoySlug: slug, position })
		.onConflictDoUpdate({
			target: [
				schema.sessionCharacters.sessionId,
				schema.sessionCharacters.envoySlug
			],
			set: { removedAt: null, removedName: null, isActive: true, position }
		})
	return !wasLive
}

/**
 * Unseat an envoy: the same soft-remove a character's seat gets. Answers
 * whether a live seat was actually removed (M3 review).
 */
export async function unseatEnvoy(
	db: Db,
	sessionId: number,
	slug: string,
	removedName?: string | null
): Promise<boolean> {
	const removed = await db
		.update(schema.sessionCharacters)
		.set({
			removedAt: new Date(),
			isActive: false,
			...(removedName ? { removedName } : {})
		})
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				eq(schema.sessionCharacters.envoySlug, slug),
				isNull(schema.sessionCharacters.removedAt)
			)
		)
		.returning({ envoySlug: schema.sessionCharacters.envoySlug })
	return removed.length > 0
}

/**
 * The sentence for a session that cannot have anyone answer (U5g review,
 * S7): its genre admits no characters (`shape.characters.max === 0`) and no
 * live `in-turn` envoy is seated — the guide session with its mascot
 * unseated. Null for every other session, including one that merely has
 * nobody due right now; that silence is the ordinary state and not a fault.
 */
export async function noSpeakerRefusal(
	db: Db,
	sessionId: number
): Promise<string | null> {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { genreId: true }
	})
	if (!session) return null
	const genre = await getSessionGenre(db, session.genreId ?? STANDARD_GENRE_ID)
	if (genre?.shape?.characters?.max !== 0) return null
	const live = (await seatedEnvoys(db, sessionId)).some(
		(e) => !e.removedAt && e.speaks === "in-turn"
	)
	if (live) return null
	return "This session has no one to answer — seat an envoy in Session settings."
}

/**
 * Why the pipeline's own voice cannot answer on this channel, else null
 * (lair re-plan R6).
 *
 * In a narrator genre the own voice (the null turn entry) is its fallback
 * envoy — the Lair's Castellan. On `main` that voice runs the turn whoever is
 * seated, and fallback **naming** never depends on the seat (`ownVoiceName`,
 * `unclaimedLineSpeaker` read declarations): story turns keep running under
 * its name. On any OTHER channel the own voice is that envoy **talking** — the
 * Castellan in the Sanctum — and an envoy with no live seat has no seat to
 * talk from, so only that talk stops, refused by name.
 */
export async function ownVoiceSeatRefusal(
	db: Db,
	sessionId: number,
	channel: string | undefined
): Promise<string | null> {
	if (!channel || parseChannel(channel).slug === DEFAULT_CHANNEL) return null
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { genreId: true }
	})
	if (!session) return null
	const genre = await getSessionGenre(db, session.genreId ?? STANDARD_GENRE_ID)
	if (genre?.shape?.voice !== "narrator") return null
	const fallback = (await sessionDeclaredEnvoys(db, sessionId)).find(
		(d) => d.fallback
	)
	if (!fallback) return null
	const live = (await seatedEnvoys(db, sessionId)).some(
		(e) => e.slug === fallback.slug && !e.removedAt
	)
	if (live) return null
	const name = i18nText(fallback.name) || fallback.slug
	return `${name} is not seated in this session, so nobody answers here — seat ${name} in Session settings.`
}

/**
 * Seat every `default: true` envoy the genre declares — what creating a
 * session of the genre does with no choice offered (R-18), and what a genre
 * upgrade does for the defaults the new version brings (U5g review, W3).
 * `onConflictDoNothing`: a seat the person already unseated stays unseated —
 * an upgrade must not undo a choice. Returns the slugs seated.
 */
export async function seatDefaultEnvoys(
	db: Db,
	sessionId: number,
	genreId: string,
	extra: readonly string[] = []
): Promise<string[]> {
	const declared = await declaredEnvoys(db, genreId)
	const wanted = new Set<string>(
		declared.filter((d) => d.default && d.origin === "genre").map((d) => d.slug)
	)
	for (const slug of extra) if (declared.some((d) => d.slug === slug)) wanted.add(slug)
	let position = 0
	for (const slug of wanted) {
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId: null, envoySlug: slug, position: position++ })
			.onConflictDoNothing()
	}
	return [...wanted]
}

/**
 * Who speaks a line nobody claimed (ruled 2026-09-26: "everyone should have
 * names, even just placeholders") — a message write with no character, no
 * persona, no `speaker` and no narration. In order:
 *
 * 1. the running document's own action envoy, when its contributed actions
 *    declare exactly one — a dice spec's result is its Dice Master's;
 * 2. the genre's fallback envoy (`EnvoyDecl.fallback`).
 *
 * Null when neither exists: the row stays speakerless and every reader names
 * it with the session's narrator name, then `UNCLAIMED_LINE_NAME` — never
 * "Unknown". Only slugs this session actually declares are answered.
 */
export async function unclaimedLineSpeaker(
	db: Db,
	sessionId: number,
	running?: { specId?: string; contributes?: unknown }
): Promise<`envoy:${string}` | null> {
	const declared = await sessionDeclaredEnvoys(db, sessionId)
	if (running?.specId && running.contributes) {
		const own = new Set(
			declared
				.filter((d) => d.origin === "action" && d.specSlug === running.specId)
				.map((d) => d.slug)
		)
		if (own.size === 1) return `envoy:${[...own][0]}`
	}
	const fallback = declared.find((d) => d.fallback)
	return fallback ? `envoy:${fallback.slug}` : null
}

/**
 * The sentence for a message write naming an envoy this session does not
 * declare — null when it does (or the reference is not an envoy's). Refused
 * by name at the write: a line under a name nothing declares is a line
 * nobody can render.
 */
export async function undeclaredSpeakerRefusal(
	db: Db,
	sessionId: number,
	slug: string
): Promise<string | null> {
	const declared = await sessionDeclaredEnvoys(db, sessionId)
	if (declared.some((d) => d.slug === slug)) return null
	return (
		`speaks as envoy '${slug}', which this session's genre and its installed actions do not declare` +
		(declared.length
			? ` — declared: ${declared.map((d) => `'${d.slug}'`).join(", ")}`
			: " — none are declared")
	)
}
