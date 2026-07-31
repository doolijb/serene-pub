// characterBindingSync.ts
// Decision-2 helper (see lorebookBindings/narrativeNodes merge plan): a
// lorebookBindings row's name/aliases are a stored snapshot of its bound
// character/persona, kept in sync one-directionally — the entity is always
// the source of truth. Editing a bound row's name/aliases directly is
// rejected elsewhere (narrativeGraphUpdateNodeHandler); this is the only
// path that's allowed to write those two columns on a bound row.
//
// Takes an optional `dbInstance` (defaulting to the app's shared `db`) so
// the standalone data-migration script (scripts/migrate-lorebook-bindings-
// data.ts) can reuse this exact logic against its own PGlite connection
// without pulling in `$lib/server/db`'s `$app/environment` dependency,
// which only resolves inside a SvelteKit/Vite context. The default is
// loaded via a dynamic import (only reached when no explicit instance is
// passed in) rather than a top-level import, so this module itself stays
// safe to import from a plain standalone script.

import * as schema from "$lib/server/db/schema"
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import type { PgliteDatabase } from "drizzle-orm/pglite"

type DbLike = PgliteDatabase<typeof schema>

async function defaultDb(): Promise<DbLike> {
	return (await import("$lib/server/db")).db
}

/**
 * Syncs every lorebookBindings row bound to this character (across every
 * lorebook it's bound in, not just one) with the character's current
 * name/aliases. Call after any character update that could have changed
 * name, nickname, or aliases — cheap no-op if nothing is bound.
 *
 * Round-12 audit fix (MEDIUM): reads the character then writes every bound
 * row, with no lock — two near-simultaneous edits to the same character
 * could interleave so the *earlier* edit's read finishes writing *after*
 * the later edit's, leaving every bound row's cached name stale until the
 * next edit. Locked with a Postgres advisory lock scoped to this
 * characterId (2-argument form, salted with hashtext('charBindingSync:
 * character') so this lock space can never collide with the numerically
 * separate lorebookId-keyed locks elsewhere in this codebase — a character
 * and an unrelated lorebook can share the same integer id). MUST NOT be
 * called from inside another already-open advisory-locked transaction
 * (eg. one already holding a lorebookId lock) — every current caller was
 * verified not to (see the round-12 remediation plan), but a future one
 * that did would risk a lock-ordering deadlock against a concurrent
 * transaction acquiring the two lock kinds in the opposite order.
 */
export async function syncLorebookBindingsForCharacter(
	characterId: number,
	dbInstance?: DbLike
): Promise<void> {
	const db = dbInstance ?? (await defaultDb())
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext('charBindingSync:character'), ${characterId})`
		)

		const character = await tx.query.characters.findFirst({
			where: eq(schema.characters.id, characterId),
			columns: { name: true, nickname: true, aliases: true }
		})
		if (!character) return

		await tx
			.update(schema.lorebookBindings)
			.set({
				name: resolveCharacterName(character),
				aliases: character.aliases ?? []
			})
			.where(eq(schema.lorebookBindings.characterId, characterId))
	})
}

/**
 * Syncs every lorebookBindings row bound to this persona (across every
 * lorebook it's bound in) with the persona's current name/aliases. Call
 * after any persona update that could have changed name or aliases —
 * cheap no-op if nothing is bound.
 *
 * Round-12 audit fix (MEDIUM): same race and same fix as
 * syncLorebookBindingsForCharacter above, with a different salt so the two
 * lock spaces (character vs persona) can't collide with each other either.
 * Same "must not be called from inside another advisory-locked
 * transaction" constraint applies.
 */
export async function syncLorebookBindingsForPersona(
	personaId: number,
	dbInstance?: DbLike
): Promise<void> {
	const db = dbInstance ?? (await defaultDb())
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext('charBindingSync:persona'), ${personaId})`
		)

		const persona = await tx.query.personas.findFirst({
			where: eq(schema.personas.id, personaId),
			columns: { name: true, aliases: true }
		})
		if (!persona) return

		await tx
			.update(schema.lorebookBindings)
			.set({
				name: resolvePersonaName(persona),
				aliases: persona.aliases ?? []
			})
			.where(eq(schema.lorebookBindings.personaId, personaId))
	})
}

/**
 * Find an existing lorebook binding for the given character or persona, or
 * create a new one — the binding token is derived from the lorebook's own
 * per-lorebook counter (never reused after a delete), not a recomputed max
 * — see the merge plan's decision 1 (this used to scan existing bindings
 * for the highest {{char:N}} number and mint N+1, which silently reused a
 * deleted binding's number and collided with that old number still baked
 * into stored content). Shared by the character-lore binding path and the
 * scene-summarize/scene-process auto-participant guarantee (both
 * `summarize.ts` and `scenes.ts`) — a single lookup-or-create-plus-sync
 * path so they can't drift.
 */
export async function resolveOrCreateBinding(
	{
		lorebookId,
		characterId,
		personaId
	}: {
		lorebookId: number
		characterId?: number | null
		personaId?: number | null
	},
	dbInstance?: DbLike
): Promise<number> {
	const db = dbInstance ?? (await defaultDb())
	if (!characterId && !personaId)
		throw new Error("characterId or personaId required")

	// Advisory lock scoped to lorebookId — without it, two concurrent calls
	// for the same not-yet-bound character/persona can both pass the
	// existing-row check and both insert a binding. Same fix, same reason,
	// as the sibling resolveOrCreateBindingByName (availableSceneCast.ts).
	const result = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)

		const existing = await tx.query.lorebookBindings.findFirst({
			where: characterId
				? and(
						eq(schema.lorebookBindings.lorebookId, lorebookId),
						eq(schema.lorebookBindings.characterId, characterId)
					)
				: and(
						eq(schema.lorebookBindings.lorebookId, lorebookId),
						eq(schema.lorebookBindings.personaId, personaId!)
					)
		})
		if (existing) return { row: existing, created: false }

		const token = await deriveNextBindingToken(lorebookId, tx)
		const [inserted] = await tx
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				binding: token,
				characterId: characterId ?? null,
				personaId: personaId ?? null
			})
			.returning()
		return { row: inserted, created: true }
	})

	// Sync only on a fresh insert — matches the pre-lock behavior, where an
	// existing row returned before ever reaching the sync calls below.
	if (result.created) {
		if (characterId) {
			await syncLorebookBindingsForCharacter(characterId, db)
		} else if (personaId) {
			await syncLorebookBindingsForPersona(personaId, db)
		}
	}

	return result.row.id
}

/**
 * One-off backfill for bound lorebookBindings rows that never went through
 * sync (e.g. a lorebook import from before restoreBoundEntities called it)
 * and are left with a permanently NULL/empty name — falling through to the
 * raw {{char:N}} token everywhere a binding's name is displayed. Safe to
 * call on every server boot: naturally idempotent, matching nothing once
 * every bound-insert path syncs on creation (as they all now do).
 */
export async function backfillMissingBindingNames(
	dbInstance?: DbLike
): Promise<void> {
	const db = dbInstance ?? (await defaultDb())
	const staleBoundBindings = await db.query.lorebookBindings.findMany({
		where: and(
			or(
				isNotNull(schema.lorebookBindings.characterId),
				isNotNull(schema.lorebookBindings.personaId)
			),
			or(
				isNull(schema.lorebookBindings.name),
				eq(schema.lorebookBindings.name, "")
			)
		),
		columns: { characterId: true, personaId: true }
	})
	const characterIds = new Set<number>()
	const personaIds = new Set<number>()
	for (const binding of staleBoundBindings) {
		if (binding.characterId) characterIds.add(binding.characterId)
		else if (binding.personaId) personaIds.add(binding.personaId)
	}
	for (const characterId of characterIds) {
		await syncLorebookBindingsForCharacter(characterId, db)
	}
	for (const personaId of personaIds) {
		await syncLorebookBindingsForPersona(personaId, db)
	}
}
