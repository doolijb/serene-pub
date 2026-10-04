/**
 * **Upgrade notes** — what the 0.5.3 → 0.6 upgrade changed in somebody's data,
 * or could not carry, said once where an admin will find it.
 *
 * Each note becomes one admin logbook record (object type `data-upgrade`,
 * `shared/adminLogbook.ts`), and the wiring (`finish.ts`) adds one summary record and one
 * notification to every admin (`DATA_UPGRADE_DONE`). Not a config **notice**
 * (`pipeline_config_notices`, a standing condition on one configuration) and
 * not a notification by itself: a note is a record of something that already
 * happened.
 */
import * as schema from "$lib/server/db/schema"
import type { LogbookChange } from "$lib/shared/adminLogbook"

/** What a note is about, so the History list can be read by kind. */
export type UpgradeNoteTopic =
	| "accepted-loss"
	| "binding-merged"
	| "cast-tag"
	| "character-detail"
	| "connection-converted"
	/** Several 0.5.3 connections to one service became one connection. */
	| "connection-merged"
	/** A 0.5.3 connection took the name 0.6 gives its service. */
	| "connection-renamed"
	| "embeddings"
	| "entry-priority"
	| "history-date"
	| "image-missing"
	| "migration-ledger"
	| "persona-default"
	| "persona-uuid"
	| "prompt-format"
	| "prompt-override"
	| "sampling-clamped"
	| "sampling-renamed"
	| "scene-dropped"
	| "search-by-meaning"
	| "session-lorebooks"
	| "summary"
	| "wiring"

export interface UpgradeNote {
	topic: UpgradeNoteTopic
	/** What it is about, as a person names it: "Atlas of Everything". */
	objectLabel: string
	/** One sentence, present tense. */
	summary: string
	changes?: LogbookChange[]
}

export const UPGRADE_NOTE_EVENT = "upgrade:0.5.3"
export const UPGRADE_NOTE_ACTOR = "Serene Pub upgrade"

export class UpgradeNotes {
	readonly list: UpgradeNote[] = []

	add(note: UpgradeNote): void {
		this.list.push(note)
	}

	count(topic?: UpgradeNoteTopic): number {
		return topic
			? this.list.filter((n) => n.topic === topic).length
			: this.list.length
	}
}

/** How many upgrade notes History holds — the count the summary and the notification say. */
export async function countUpgradeNotes(db: Db): Promise<number> {
	const { count, eq } = await import("drizzle-orm")
	const [row] = await db
		.select({ n: count() })
		.from(schema.adminLogbook)
		.where(eq(schema.adminLogbook.objectType, "data-upgrade"))
	return Number(row?.n ?? 0)
}

/** Write every note as a logbook record, in the caller's transaction. */
export async function writeUpgradeNotes(
	db: Db,
	notes: readonly UpgradeNote[]
): Promise<number> {
	if (!notes.length) return 0
	const rows = notes.map((n) => ({
		actorUserId: null,
		actorName: UPGRADE_NOTE_ACTOR,
		event: UPGRADE_NOTE_EVENT,
		objectType: "data-upgrade",
		// The topic, so `History?type=data-upgrade&id=<topic>` lists one kind.
		objectId: n.topic,
		objectLabel: n.objectLabel,
		action: "other" as const,
		summary: n.summary,
		changes: n.changes ?? []
	}))
	for (let i = 0; i < rows.length; i += 200)
		await db.insert(schema.adminLogbook).values(rows.slice(i, i + 200))
	return rows.length
}
