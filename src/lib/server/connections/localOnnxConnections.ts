/**
 * The two local ONNX connection rows the app creates for itself.
 *
 * Every boot, `sync()` makes sure this pub has exactly one connection of each
 * local ONNX type: **Local embeddings** (`local-onnx`) and **Local named
 * entities** (`local-onnx-ner`). The model runs in this process, so there is
 * no host to configure and nothing for a person to add; what they choose is
 * which model's files are on disk.
 *
 * Owner rulings (2026-11-04, final): "two rows, Local embeddings and Local
 * named entities, undeletable (remove a model's files instead); extra
 * hand-made rows fold into the kept one (the one a loadout names, else the
 * oldest); fresh installs fill no loadout." And: "the app creates the local
 * ONNX rows, never fills a loadout with them (no-implicit-pickup stands)."
 * One active model per modality is a person's choice, so this file never
 * writes a loadout, a connection default or a star. The only loadout write
 * possible is the fold's repoint of a folded row's `connection_id` to the
 * kept row.
 *
 * ## Matched on TYPE, not on id
 *
 * After the fold there is one row per type, so the type finds it - the managed
 * KoboldCPP precedent (`managedEndpoint.ts`). An id would be a hardcoded seed
 * and ids differ between installs. There is no `seed_key` column on
 * connections, and none is needed while the type is unique.
 *
 * ## Not while a 0.5.3 upgrade is pending
 *
 * The attic restore keeps 0.5.3's connection ids and reconciles the live
 * connection count against the attic's, so a row made before it ran would
 * collide with an id and break the count. While the attic exists this does
 * nothing; the boot after the upgrade finishes (the attic is dropped) makes
 * the rows.
 *
 * An unavailable machine (`localOnnxAvailability`) gets no rows, and older
 * rows stay as they are. Idempotent: a settled install writes nothing. The
 * boot log line in `defaults.ts` is the record of anything it did.
 */

import { asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { resolveConnectionCapabilities } from "$lib/server/connections/resolve"
import { foldConnectionInto } from "$lib/server/connections/connectionFold"
import { atticExists } from "$lib/server/attic"
import { localOnnxAvailability } from "$lib/server/localModels/onnxRuntime"

/** The fixed name of the one row of each local ONNX type. */
export const LOCAL_ONNX_CONNECTION_NAME: Readonly<Record<string, string>> = {
	[CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS]: "Local embeddings",
	[CONNECTION_TYPE.LOCAL_ONNX_NER]: "Local named entities"
}

export async function ensureLocalOnnxConnections(
	db: Db
): Promise<{ created: number; folded: number; renamed: number }> {
	const result = { created: 0, folded: 0, renamed: 0 }
	if (await atticExists(db)) return result
	if (!(await localOnnxAvailability()).available) return result

	for (const [type, name] of Object.entries(LOCAL_ONNX_CONNECTION_NAME)) {
		const rows = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.type, type))
			.orderBy(asc(schema.connections.id))

		if (rows.length === 0) {
			const defaults =
				CONNECTION_DEFAULTS[type as keyof typeof CONNECTION_DEFAULTS]
			const data: Record<string, unknown> = {
				...defaults,
				type,
				modality: defaults.modality,
				name,
				extraJson: { ...(defaults.extraJson ?? {}) }
			}
			// Connections have no model column.
			delete data.model
			data.capabilities = {
				resolved: resolveConnectionCapabilities(
					data as InsertConnection
				)
			}
			await db.insert(schema.connections).values(data as InsertConnection)
			result.created++
			continue
		}

		// The kept row: the first one a loadout names, else the oldest.
		const named = new Set(
			(
				await db
					.select({ id: schema.loadouts.connectionId })
					.from(schema.loadouts)
					.where(
						inArray(
							schema.loadouts.connectionId,
							rows.map((r) => r.id)
						)
					)
			).map((r) => r.id)
		)
		const kept = rows.find((r) => named.has(r.id)) ?? rows[0]

		for (const source of rows) {
			if (source.id === kept.id) continue
			try {
				await db.transaction(async (tx) =>
					foldConnectionInto(tx, source, kept)
				)
				result.folded++
			} catch (error) {
				console.error(
					`[connections] Could not fold local ONNX connection ${source.id} into ${kept.id}; leaving it as its own row:`,
					error
				)
			}
		}

		if (kept.name !== name) {
			await db
				.update(schema.connections)
				.set({ name })
				.where(eq(schema.connections.id, kept.id))
			result.renamed++
		}
	}
	return result
}
