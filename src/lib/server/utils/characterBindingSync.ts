// characterBindingSync.ts
// Decision-2 helper (see lorebookBindings/narrativeNodes merge plan): a
// lorebookBindings row's NAME is a stored snapshot of its bound
// character/persona, kept in sync one-directionally — the card is the source
// of truth for it, UNLESS the member has a name or nickname of its own in this
// book (`own_name` / `own_nickname`, playtest §0-D), which the snapshot applies
// (`memberShownName`). Because `name` is the stored shown name, every server
// reader of `binding.name` (graph, scene cast list, side characters, embed
// text, write proposals, castMemberCards refusals) follows without edits. Its ALIASES are the member's own (cast-first, #114, ruled
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
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	hasOwnNames,
	memberShownName
} from "$lib/shared/lorebooks/memberIdentity"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { memberOfCard } from "$lib/server/utils/castMemberCards"
import {
	ensureCardVersion,
	insertCastMember,
	writeBackShownName,
	writeCastVersion
} from "$lib/server/characters/versions"
import { memberColumnsOfVersion } from "$lib/server/lorebooks/retold"

async function defaultDb(): Promise<Db> {
	return (await import("$lib/server/db")).db
}

/**
 * Syncs the lorebookBindings rows bound to this character with the
 * character's current name/aliases. Call after any character update that
 * could have changed name, nickname, or aliases — cheap no-op if nothing is
 * bound.
 *
 * ⚠ **Which books a card edit reaches** (plan A25). With no `only`, the edit
 * reaches the members in books owned by the card's OWNER, across every one of
 * them. A member in somebody else's book — a guest's persona, cast in the
 * host's book when the guest joined a session reading it — keeps the name and
 * aliases the host's book was given: a guest renaming their persona never
 * rewrites the host's cast. `only.lorebookId` syncs that one book's member
 * whoever owns it — the attach-time sync, when a card is first linked into a
 * book whose owner the caller has already checked.
 *
 * ⚠ **The name is the card's unless the member has its own in this book; the
 * aliases are the member's** (#114, cast-first, ruled 2026-09-28; own names
 * §0-D, ruled 2026-11-04). `name` is replaced with the card's projection, or
 * with the member's own name/nickname when it carries one — then the card's
 * shown name and real name are merged into the aliases, so the member still
 * answers to the card's names. `aliases` are MERGED: the card's names (and its real name,
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
	dbInstance?: Db,
	only?: { lorebookId: number }
): Promise<void> {
	const db = dbInstance ?? (await defaultDb())
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext('charBindingSync:character'), ${characterId})`
		)

		const character = await tx.query.characters.findFirst({
			where: eq(schema.characters.id, characterId),
			columns: { name: true, nickname: true, userId: true }
		})
		if (!character) return
		// The card's own aliases are its current version's (`characters.aliases`
		// is frozen); name and nickname are the row's copies, written with it.
		const currentCard = await ensureCardVersion(tx, characterId)

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
		// member's aliases below (#114).
		const derived = currentCard?.aliases ?? []
		const realName = character.name?.trim()
		const aliases =
			realName && realName !== resolveCharacterName(character)
				? [...derived, realName]
				: derived

		const cardName = resolveCharacterName(character)
		const bound = await tx
			.select({
				id: schema.lorebookBindings.id,
				aliases: schema.lorebookBindings.aliases
			})
			.from(schema.lorebookBindings)
			.innerJoin(
				schema.lorebooks,
				eq(schema.lorebooks.id, schema.lorebookBindings.lorebookId)
			)
			.where(
				and(
					eq(schema.lorebookBindings.characterId, characterId),
					only
						? eq(schema.lorebookBindings.lorebookId, only.lorebookId)
						: eq(schema.lorebooks.userId, character.userId)
				)
			)
		// The members' base versions: the own name and nickname are read from
		// them, and the merged aliases are written to them too.
		const V = schema.characterVersions
		const bases = bound.length
			? await tx
					.select()
					.from(V)
					.where(
						and(
							inArray(
								V.castMemberId,
								bound.map((m) => m.id)
							),
							isNull(V.cardId),
							isNull(V.branchId),
							isNull(V.year),
							isNull(V.personalPosition),
							isNull(V.sourceSessionId)
						)
					)
			: []
		const baseOf = new Map(bases.map((b) => [b.castMemberId, b]))
		// The base name, as its base reads it: a followed name or nickname is
		// the base's PARENT card version's, which a member left behind on an
		// older card version does not share with the card's current name
		// (★chr-read-1). It is the stored `name` here, and keeps the member's
		// own name out of its aliases; `writeBackShownName` then sets the name
		// to what the member reads on Main, so a dated rename survives a card
		// edit (★cp-names-1).
		const parentIds = bases
			.map((b) => b.parentVersionId)
			.filter((id): id is number => id != null)
		const parents = new Map(
			(parentIds.length
				? await tx
						.select({
							id: V.id,
							name: V.name,
							nickname: V.nickname
						})
						.from(V)
						.where(inArray(V.id, parentIds))
				: []
			).map((p) => [p.id, p])
		)
		for (const row of bound) {
			const base = baseOf.get(row.id)
			// A base with no parent card version is card-less (a member linked
			// to a card since: see the link gap in lorebooks.castVersions.int.test),
			// so it holds no own names to apply; no base (an error) has none.
			const names =
				base && base.parentVersionId != null
					? memberColumnsOfVersion(base, { carded: true })
					: { ownName: null, ownNickname: null }
			const parent =
				base?.parentVersionId != null
					? parents.get(base.parentVersionId)
					: undefined
			const name = memberShownName(names, parent ?? character)
			// A member with its own names still answers to the card's.
			const cardAliases = hasOwnNames(names)
				? [...aliases, cardName]
				: aliases
			const merged = mergeAliases(row.aliases, cardAliases, name)
			// The stored name has one writer, `writeBackShownName` (below); only a
			// row with no base version (nothing for it to read) is named here.
			await tx
				.update(schema.lorebookBindings)
				.set(base ? { aliases: merged } : { name, aliases: merged })
				.where(eq(schema.lorebookBindings.id, row.id))
			// The card owner's edit is what this carries: the base's own
			// aliases follow the binding's. The name stays the card's (followed)
			// unless the member has its own.
			if (
				base &&
				(base.aliases.length !== merged.length ||
					base.aliases.some((a, i) => a !== merged[i]))
			)
				await writeCastVersion(tx, {
					member: row.id,
					changes: { aliases: merged },
					writtenBy: `user:${character.userId}`,
					at: { branchId: null, date: null, personalPosition: null }
				})
			// The stored name is the member's shown name at its book's present
			// on Main (the card's, or a dated rename's).
			if (base) await writeBackShownName(tx, row.id)
		}
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
 *
 * Null for a deleted card no member has: see `findOrInsertBinding`.
 */
export async function resolveOrCreateBinding(
	args: {
		lorebookId: number
		characterId?: number | null
	},
	dbInstance?: Db
): Promise<number | null> {
	return (await resolveOrCreateBindingRow(args, dbInstance))?.id ?? null
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
 *
 * Null for a deleted card no member has: see `findOrInsertBinding`.
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
): Promise<{ id: number; created: boolean } | null> {
	const db = dbInstance ?? (await defaultDb())
	if (!characterId) throw new Error("characterId required")

	// Advisory lock scoped to lorebookId — without it, two concurrent calls
	// for the same not-yet-bound character can both pass the existing-row
	// check and both insert a binding. Same fix, same reason, as the sibling
	// resolveOrCreateBindingByName (availableSceneCast.ts).
	const result = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
		return findOrInsertBinding(tx, lorebookId, characterId)
	})
	if (!result) return null

	// Sync only on a fresh insert — matches the pre-lock behavior, where an
	// existing row returned before ever reaching the sync call below.
	if (result.created)
		await syncLorebookBindingsForCharacter(characterId, db, { lorebookId })

	return { id: result.row.id, created: result.created }
}

/**
 * The book's cast member for a character, found or inserted on the CALLER's
 * transaction, so it commits (or rolls back) with whatever the caller writes
 * beside it — `entries:create` adds the member a character-lore entry is
 * anchored to in the entry's own write.
 *
 * Found by any card of theirs (`memberOfCard`, plan A25): a card a dated
 * change draws a member with is that member's, so seating it never mints a
 * second one.
 *
 * ⚠ **A deleted card is never given a member** (plan A25): the delete is
 * soft, so sessions still seat it and old messages still name it as their
 * sender, and every path that seats, summarises or captures a scene reaches
 * here with it. A member the card already has is found as before; with none,
 * this answers null and inserts nothing — so unlinking a deleted card from its
 * member, then touching the session again, does not mint a second member
 * linked to it. A card id with no card behind it answers the same. 🚧
 * `mintDeleted` lifts that for one caller only: the boot fill of seats whose
 * card was deleted before the delete-time fill existed (★RF-1 at startup,
 * owner 2026-11-10), which turns the new member card-less in the same
 * transaction.
 *
 * ⚠ The caller holds the book's advisory lock
 * (`pg_advisory_xact_lock(lorebookId)`) before calling, and syncs a new row's
 * name and aliases from the card after the commit
 * (`syncLorebookBindingsForCharacter`), as `resolveOrCreateBindingRow` does.
 *
 * The member is born with its **base version** (`insertCastMember`, plan §32
 * §8): the one writer of `character_versions` writes it in the same
 * transaction.
 */
export async function findOrInsertBinding(
	tx: Db,
	lorebookId: number,
	characterId: number,
	opts: { mintDeleted?: boolean } = {}
): Promise<{
	row: typeof schema.lorebookBindings.$inferSelect
	created: boolean
} | null> {
	const memberId = await memberOfCard(tx, lorebookId, characterId)
	const existing =
		memberId == null
			? undefined
			: await tx.query.lorebookBindings.findFirst({
					where: eq(schema.lorebookBindings.id, memberId)
				})
	if (existing) return { row: existing, created: false }

	const card = await tx.query.characters.findFirst({
		where: eq(schema.characters.id, characterId),
		columns: { isDeleted: true }
	})
	if (!card || (card.isDeleted && !opts.mintDeleted)) return null

	const token = await deriveNextBindingToken(lorebookId, tx)
	const { member } = await insertCastMember(tx, {
		lorebookId,
		binding: token,
		characterId
	})
	return { row: member, created: true }
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
		columns: { characterId: true, lorebookId: true }
	})
	// Book by book: a nameless member is filled in wherever it is, including a
	// host's book holding a guest's card.
	const seen = new Set<string>()
	for (const { characterId, lorebookId } of staleBoundBindings) {
		if (!characterId || seen.has(`${characterId}:${lorebookId}`)) continue
		seen.add(`${characterId}:${lorebookId}`)
		await syncLorebookBindingsForCharacter(characterId, db, { lorebookId })
	}
}
