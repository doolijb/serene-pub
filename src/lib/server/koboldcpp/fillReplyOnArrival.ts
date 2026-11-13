/**
 * Puts a freshly downloaded text model on the Reply loadout when Reply is empty.
 *
 * Why it exists (review A6, 2026-11-11): the download completes on the server,
 * so the fill lives here and not in the Set up chat dialog, where closing the
 * dialog or tab during a download left Reply empty.
 *
 * It is the ONLY automatic writer of the Reply pair on arrival (P2), and it
 * fills only an EMPTY Reply: a pair somebody chose is never overwritten. The
 * fill is visible on the Loadouts row and in Set up chat's Done step, which
 * names the model; Use in Reply changes it (P1).
 *
 * ## "Empty" is read and written in one transaction
 *
 * The emptiness read and the write share one `db.transaction`, using only
 * `tx`. PGlite is one connection behind a transaction mutex, so a **Use in
 * Reply** (`connections:setDefault`) arriving meanwhile waits for the commit
 * and lands after the fill: the person's choice is the one that stays. Two
 * fills at once queue the same way, and the second finds Reply filled.
 */

import { eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	capabilityDefault,
	setCapabilityDefault
} from "$lib/server/connections/capabilityDefaults"
import { starRefusal } from "$lib/server/connections/starRefusal"
import { managedKoboldCppEndpoint } from "./managedEndpoint"

const REPLY = "text->text"

export async function fillReplyIfEmpty(
	db: Db,
	filename: string
): Promise<{
	connectionId: number
	connectionModelId: number
	name: string
} | null> {
	const endpoint = await managedKoboldCppEndpoint(db)
	if (!endpoint) return null

	const [row] = await db
		.select()
		.from(schema.connectionModels)
		.where(
			and(
				eq(schema.connectionModels.connectionId, endpoint.id),
				eq(schema.connectionModels.model, filename)
			)
		)
		.limit(1)
	if (!row) return null

	// The judge the Use buttons go through: keeps embedding, speech, image,
	// switched-off and missing rows out.
	const refusal = await starRefusal(db, {
		capability: REPLY,
		connectionId: endpoint.id,
		connectionModelId: row.id
	})
	if (refusal) return null

	const filled = await db.transaction(async (tx) => {
		const current = await capabilityDefault(tx, REPLY)
		if (current?.connectionId != null) return false
		await setCapabilityDefault(tx, REPLY, {
			connectionId: endpoint.id,
			connectionModelId: row.id
		})
		return true
	})
	if (!filled) return null
	return {
		connectionId: endpoint.id,
		connectionModelId: row.id,
		name: row.name
	}
}
