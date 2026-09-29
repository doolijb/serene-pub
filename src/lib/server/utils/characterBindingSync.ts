// characterBindingSync.ts
// Decision-2 helper (see lorebookBindings/narrativeNodes merge plan): a
// lorebookBindings row's NAME is a stored snapshot of its bound
// character/persona, kept in sync one-directionally — the card is the source
// of truth for it. Its ALIASES are the member's own (cast-first, #114, ruled
// 2026-09-28): the sync merges the card's names in and never removes one, and
// `lorebooks:updateBinding` lets the author edit them on a carded member.
//
// THIS MODULE MUST NOT STATICALLY IMPORT `$lib/server/db`. It is imported by
// db/defaults.ts, whose sync() runs at module scope of db/index.ts — a static
// import would make db/index.ts depend on a module that depends on it, through
// its own boot path.
//
// The `defaultDb()` dynamic import below is the fallback for callers with no
// db of their own. It is NOT safe to reach during boot for the same reason:
// re-entering a mid-evaluation module works unbundled, but Rollup emits the
// chunk namespace object as a `const` after the module body, so it throws
// `Cannot access 'index' before initialization` in a packaged build. Callers
// on the boot path (db/defaults.ts) therefore pass `db` explicitly — see the
// comment at its backfillMissingBindingNames() call.
//
// A previous version of this note justified the optional `dbInstance` by
// pointing at `scripts/migrate-lorebook-bindings-data.ts`. That script does
// not exist in the repo and never did, so the stated rationale was unfalsifiable
// either way; the real constraint is the import cycle above. Tests also pass an
// instance explicitly (characterBindingSync.test.ts).

import * as schema from "$lib/server/db/schema"
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import {
	resolveCharacterName
} from "$lib/shared/utils/resolveCharacterName"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"

async function defaultDb(): Promise<Db> {
	return (await import("$lib/server/db")).db
}

/**
 * Syncs every lorebookBindings row bound to this character (across every
 * lorebook it's bound in, not just one) with the character's current
 * name/aliases. Call after any character update that could have changed
 * name, nickname, or aliases — cheap no-op if nothing is bound.
 *
 * ⚠ **The name is the card's; the aliases are the member's** (#114,
 * cast-first, ruled 2026-09-28). `name` is replaced with the card's
 * projection. `aliases` are MERGED: the card's names (and its real name,
 * below) are added to whatever the member already answers to, never written
 * over it — an alias the author gave the member, or one the member had before
 * a card was linked, survives every sync. The cost is deliberate: a name the
 * card later drops stays on the member until the author removes it there.
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
	dbInstance?: Db
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

		// The real name is part of the PROJECTION, not user data.
		//
		// resolveCharacterName prefers the nickname, so once one is set the
		// binding is named by it and the real name disappears from everything
		// downstream — every cast list, every name matcher. A scene referring
		// to "Commander Thorne" then has nothing to match against a binding
		// named "Maren", and the graph proposes a duplicate character.
		//
		// Deriving it HERE, rather than seeding characters.aliases at save
		// time, is deliberate. A first attempt did the latter and it was a
		// side-effect: it silently edited a user-owned field during a save the
		// user made for another reason. The card's names are MERGED into the
		// member's aliases below (#114) — `name` is still a full replace.
		const derived = character.aliases ?? []
		const realName = character.name?.trim()
		const aliases =
			realName && realName !== resolveCharacterName(character)
				? [...derived, realName]
				: derived

		const name = resolveCharacterName(character)
		const bound = await tx
			.select({
				id: schema.lorebookBindings.id,
				aliases: schema.lorebookBindings.aliases
			})
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.characterId, characterId))
		for (const row of bound)
			await tx
				.update(schema.lorebookBindings)
				.set({ name, aliases: mergeAliases(row.aliases, aliases, name) })
				.where(eq(schema.lorebookBindings.id, row.id))
	})
}

/**
 * The member's aliases with the card's merged in: the member's own first, in
 * their order, then any card name they do not already carry (case-insensitive,
 * trimmed). The member's display name is never also an alias of itself.
 */
export function mergeAliases(
	member: readonly string[] | null | undefined,
	card: readonly string[],
	name: string
): string[] {
	const out: string[] = []
	const seen = new Set<string>([name.trim().toLowerCase()])
	for (const alias of [...(member ?? []), ...card]) {
		const trimmed = (alias ?? "").trim()
		const key = trimmed.toLowerCase()
		if (!trimmed || seen.has(key)) continue
		seen.add(key)
		out.push(trimmed)
	}
	return out
}

// ⚠ There is no persona variant of the sync above, and adding one would be a
// bug: a persona IS a character, so its bindings are character bindings, and a
// second advisory-lock salt over the same id space would let one row be synced
// by two transactions at once instead of keeping two spaces apart.

/**
 * Find an existing lorebook binding for the given character, or
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
	args: {
		lorebookId: number
		characterId?: number | null
	},
	dbInstance?: Db
): Promise<number> {
	return (await resolveOrCreateBindingRow(args, dbInstance)).id
}

/**
 * The same resolve-or-create as `resolveOrCreateBinding`, reporting whether
 * the row was minted here. Same `{ id, created }` shape as the sibling
 * `resolveOrCreateBindingByName` (availableSceneCast.ts).
 *
 * Callers that only need the id use the wrapper above; this exists for the
 * ones that must tell "already bound" from "bound just now" — the
 * `lorebooks:createBinding` ack, and the session cast check's decision to
 * re-broadcast the cast list only when it actually changed.
 */
export async function resolveOrCreateBindingRow(
	{
		lorebookId,
		characterId
	}: {
		lorebookId: number
		characterId?: number | null
	},
	dbInstance?: Db
): Promise<{ id: number; created: boolean }> {
	const db = dbInstance ?? (await defaultDb())
	if (!characterId) throw new Error("characterId required")

	// Advisory lock scoped to lorebookId — without it, two concurrent calls
	// for the same not-yet-bound character can both pass the existing-row
	// check and both insert a binding. Same fix, same reason, as the sibling
	// resolveOrCreateBindingByName (availableSceneCast.ts).
	const result = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)

		const existing = await tx.query.lorebookBindings.findFirst({
			where: and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				eq(schema.lorebookBindings.characterId, characterId)
			)
		})
		if (existing) return { row: existing, created: false }

		const token = await deriveNextBindingToken(lorebookId, tx)
		const [inserted] = await tx
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				binding: token,
				characterId
			})
			.returning()
		return { row: inserted, created: true }
	})

	// Sync only on a fresh insert — matches the pre-lock behavior, where an
	// existing row returned before ever reaching the sync call below.
	if (result.created)
		await syncLorebookBindingsForCharacter(characterId, db)

	return { id: result.row.id, created: result.created }
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
	dbInstance?: Db
): Promise<void> {
	const db = dbInstance ?? (await defaultDb())
	const staleBoundBindings = await db.query.lorebookBindings.findMany({
		where: and(
			isNotNull(schema.lorebookBindings.characterId),
			or(
				isNull(schema.lorebookBindings.name),
				eq(schema.lorebookBindings.name, "")
			)
		),
		columns: { characterId: true }
	})
	const characterIds = new Set<number>()
	for (const binding of staleBoundBindings)
		if (binding.characterId) characterIds.add(binding.characterId)
	for (const characterId of characterIds) {
		await syncLorebookBindingsForCharacter(characterId, db)
	}
}
