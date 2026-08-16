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
import * as schema from "$lib/server/db/schema"
import { eq, sql } from "drizzle-orm"
import type { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = PgliteDatabase<typeof schema> | PgliteTransaction<any, any>

export async function deriveNextBindingToken(
	lorebookId: number,
	tx: Executor
): Promise<string> {
	const [row] = await tx
		.update(schema.lorebooks)
		.set({
			nextBindingNumber: sql`${schema.lorebooks.nextBindingNumber} + 1`
		})
		.where(eq(schema.lorebooks.id, lorebookId))
		.returning({ nextBindingNumber: schema.lorebooks.nextBindingNumber })

	if (!row) throw new Error(`Lorebook ${lorebookId} not found.`)

	// The UPDATE returns the post-increment value — subtract 1 to get the
	// number this call actually claimed.
	return `{{char:${row.nextBindingNumber - 1}}}`
}
