import { db as defaultDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"

/**
 * Remember that this character is one the user plays.
 *
 * **The one writer of `characters.is_persona`** outside a deliberate toggle, so
 * that "is this a persona" is answered the same way no matter which path put it
 * in a session. Every `session_personas` insert calls it — the session forms,
 * the import, the wizard's starter, the persona-catalogue import — because
 * attaching a character as a voice IS the user saying they play it, and the
 * library should not have to be told a second time.
 *
 * **Idempotent and one statement.** The `NOT is_persona` predicate means the
 * common case (already flagged) writes nothing, so this is safe to call on
 * every attach, in a loop, without reading first. It never CLEARS the flag:
 * detaching a character from the last session it was voiced in must not empty
 * the persona picker behind the user's back.
 *
 * Takes the transaction when there is one, so the flag lands or rolls back with
 * the membership row it accompanies.
 */
export async function markCharacterAsPersona(
	characterId: number | null | undefined,
	dbOrTx: Db = defaultDb
): Promise<void> {
	if (characterId == null) return
	await dbOrTx
		.update(schema.characters)
		.set({ isPersona: true })
		.where(
			and(
				eq(schema.characters.id, characterId),
				eq(schema.characters.isPersona, false)
			)
		)
}
