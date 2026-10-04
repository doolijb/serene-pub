// Derives a new lorebookBindings row's {{char:N}} token from a per-lorebook
// monotonic counter (lorebooks.nextBindingNumber) — never decrements, even
// after a binding is deleted, so a number is never reused within a
// lorebook. Numbers are scoped per lorebook (each lorebook counts from 1
// independently) rather than shared globally across every lorebook in the
// system, which is what the row's own Postgres identity id gave before.
//
// Must be called inside the same transaction as the binding insert it's
// for — an atomic UPDATE...RETURNING here, followed by a crash before the
// insert commits, would otherwise permanently burn a number with no row to
// show for it (harmless, since numbers are never reused anyway, but the
// transaction wrapping costs nothing and keeps the two writes atomic).
//
// ⚠ Past every tag the book's members hold, too, not only past the counter
// (A16). `binding` is unique per book now (`lorebook_bindings_binding_unique`),
// so a counter left behind a member's tag — a row written by hand, a counter
// seeded before 0200 moved it — would turn the next mint into a unique
// violation and fail whatever write asked for it. Ten-digit tags count: the
// counter issues them once it passes 999,999,999.
//
// ⚠ A book that has issued MAX_MEMBER_NUMBER has no number left to give. It
// is refused in words rather than let the counter overflow its `integer`
// ("integer out of range" reaches nobody as a reason).
import * as schema from "$lib/server/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { MAX_MEMBER_NUMBER, castTag } from "$lib/server/utils/castTags"

/** A stored member tag and its number (the one spelling every writer uses). */
const HELD_TAG = String.raw`^\{\{char:([0-9]{1,10})\}\}$`

export async function deriveNextBindingToken(
	lorebookId: number,
	tx: Db
): Promise<string> {
	const members = schema.lorebookBindings
	/** The number this call claims: past the counter and every held tag. */
	const claimed = sql`GREATEST(
		${schema.lorebooks.nextBindingNumber}::bigint,
		(SELECT COALESCE(MAX(held.n), 0) + 1
			FROM (SELECT (regexp_match(${members.binding}, ${HELD_TAG}))[1]::bigint AS n
				FROM ${members} WHERE ${members.lorebookId} = ${lorebookId}) held
			WHERE held.n <= ${MAX_MEMBER_NUMBER})
	)`
	const [row] = await tx
		.update(schema.lorebooks)
		.set({ nextBindingNumber: sql`${claimed} + 1` })
		.where(
			and(
				eq(schema.lorebooks.id, lorebookId),
				sql`${claimed} <= ${MAX_MEMBER_NUMBER}`
			)
		)
		.returning({ nextBindingNumber: schema.lorebooks.nextBindingNumber })

	if (!row) {
		const [book] = await tx
			.select({ id: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebookId))
		if (!book) throw new Error(`Lorebook ${lorebookId} not found.`)
		throw new Error(
			"This book has used every cast number it can give out, so it cannot take another cast member."
		)
	}

	// The UPDATE returns the post-increment value — subtract 1 to get the
	// number this call actually claimed.
	return castTag(row.nextBindingNumber - 1)
}
