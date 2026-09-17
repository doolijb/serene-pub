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

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	actionsOf,
	envoySlugOf,
	type EnvoyDecl,
	type EnvoySpeaks
} from "@serene-pub/sdk"
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
	speaks: EnvoySpeaks
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
	speaks: e.speaks ?? (origin === "action" ? "on-action" : "in-turn")
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
 */
export async function seatEnvoy(
	db: Db,
	sessionId: number,
	slug: string,
	position = 0
): Promise<void> {
	const declared = await sessionDeclaredEnvoys(db, sessionId)
	if (!declared.some((d) => d.slug === slug))
		throw new Error(
			`'${slug}' is not an envoy this session's genre or its installed actions declare` +
				(declared.length
					? ` — it declares ${declared.map((d) => `'${d.slug}'`).join(", ")}`
					: " — it declares none")
		)
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
}

/** Unseat an envoy: the same soft-remove a character's seat gets. */
export async function unseatEnvoy(
	db: Db,
	sessionId: number,
	slug: string,
	removedName?: string | null
): Promise<void> {
	await db
		.update(schema.sessionCharacters)
		.set({
			removedAt: new Date(),
			isActive: false,
			...(removedName ? { removedName } : {})
		})
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				eq(schema.sessionCharacters.envoySlug, slug)
			)
		)
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
