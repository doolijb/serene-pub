/**
 * Keeping a prompt's text findable when the slot beneath it changes.
 *
 * A prompt row holds `fields` — field name → authored text — and the panel
 * renders **one box per DECLARED field**. So the day a node's slot stops
 * declaring `narratorName`, the text somebody wrote there does not become
 * wrong; it becomes *invisible*. It is still in the row, still in an export,
 * still impossible to find from any screen. That is the failure the user's
 * ruling names: *"if a node gets upgraded and something like the prompt field
 * got removed, we still need a way to recover/archive that information so the
 * user can reference/copy it to a different pipeline/node later."*
 *
 * This sweep is that mechanism. An undeclared key moves out of `fields` into
 * `archived_fields`, where `read.ts` sends it to the panel as a read-only block
 * beside the editors; a key a later version declares again moves back. Nothing
 * is deleted, ever, and the text travels with the row — so "copy it somewhere
 * else" is Duplicate, a gesture a person already has.
 *
 * ## Why it is on the row rather than in a table
 *
 * A `pipeline_value_archive` was the alternative, and it would repeat the
 * `pending_notices` mistake at larger scale: a table written by boot and read
 * by nothing, whose contents nobody can reach without a database client. The
 * whole point of this ruling is that the text stays *reachable by a person*,
 * and a person reaches a prompt through the prompt.
 *
 * ## Runs after the registry sync, before the config reconcile
 *
 * It reads what the slots declare from `pipeline_type_registry`, so the
 * registry must already describe this build. And a config's back-fill picks a
 * prompt per pool, so the pools must already be in their final shape when it
 * runs.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"

type Db = { select: any; insert: any; update: any; delete: any }

export interface PromptFieldReport {
	promptId: number
	name: string
	/** Keys moved out of `fields` because nothing declares them any more. */
	archived: string[]
	/** Keys moved back because a version declares them again. */
	restored: string[]
}

/**
 * Every field name any registered version of a type declares, per pool.
 *
 * **The union across versions, deliberately.** The registry keeps one row per
 * `(type, version)` and a published spec pins the version it was authored
 * against, so a field `@1` declares is still being read by every pipeline still
 * on `@1` even after `@2` drops it. Archiving on the newest version alone would
 * empty a live field and produce blank instructions in a running pipeline —
 * the precise silent failure this whole area refuses.
 *
 * A pool absent from this map is **not** an empty declaration. It is a type the
 * registry has never heard of: a plugin that is disabled, or one being
 * installed. Those rows are skipped entirely below rather than archived, which
 * is the difference between "this field went away" and "we cannot see the
 * declaration right now".
 */
export async function declaredFieldsByPool(
	db: Db
): Promise<Map<string, Set<string>>> {
	// Only versions some published spec actually PINS.
	//
	// `syncTypeRegistry` inserts and updates but never deletes, so a superseded
	// version's row survives forever. Unioning declared fields across every row
	// meant a field dropped in `@2` was still "declared" by the `@1` row sitting
	// beside it — so the sweep archived nothing, and any field ever declared by
	// any version stayed live. That is the whole purpose of this function
	// failing silently: the archive would simply always be empty.
	//
	// `pipeline_nodes.typeVersion` is exactly the reachable set, and it is the
	// same lookup the panel already uses to decide which declaration a config is
	// being reconciled against.
	const pinned = new Set<string>(
		(
			await db
				.select({
					typeId: schema.pipelineNodes.typeId,
					typeVersion: schema.pipelineNodes.typeVersion
				})
				.from(schema.pipelineNodes)
		).map((n: any) => `${n.typeId}@${n.typeVersion}`)
	)
	const registry = await db.select().from(schema.pipelineTypeRegistry)
	const out = new Map<string, Set<string>>()
	for (const row of registry as any[]) {
		// A registry row nothing pins is a superseded version; its declarations
		// are history, not a reason to keep a field alive.
		if (!pinned.has(`${row.typeId}@${row.version ?? 1}`)) continue
		const slots = (row.slots ?? {}) as Record<string, any>
		for (const [slotName, decl] of Object.entries(slots)) {
			if ((decl as any)?.kind !== "prompts") continue
			const pool = promptPoolKeyFor(row.typeId, slotName)
			const set = out.get(pool) ?? new Set<string>()
			for (const field of Object.keys((decl as any).fields ?? {}))
				set.add(field)
			out.set(pool, set)
		}
	}
	return out
}

/**
 * Move undeclared text into the archive, and re-declared text back out of it.
 *
 * A **fixed point**: it never touches a declared key, so running it twice on
 * the same rows performs no writes the second time. That property is what makes
 * it safe on every boot rather than behind a "have we swept yet" flag — a flag
 * that eventually lies — and it is what makes an edit somebody makes between
 * two boots survive, because a key they are actively writing is by definition a
 * declared one.
 *
 * `fields` wins a collision. A key present in both — possible only if a slot
 * re-declared a field while the row still carried an archived copy — keeps the
 * live text and drops the stale archived one, because the live text is the one
 * the panel has been showing and editing.
 */
export async function reconcilePromptFields(
	db: Db
): Promise<PromptFieldReport[]> {
	const declared = await declaredFieldsByPool(db)
	const rows = await db.select().from(schema.pipelinePrompts)

	const out: PromptFieldReport[] = []
	for (const row of rows as any[]) {
		const pool = promptPoolKeyFor(row.nodeTypeId, row.slot)
		const known = declared.get(pool)
		// No declaration in sight — see `declaredFieldsByPool`. Archiving here
		// would empty every prompt for a plugin somebody merely switched off,
		// and switching it back on would restore them from the archive with the
		// panel having shown nothing in between.
		if (!known) continue

		const fields = { ...((row.fields ?? {}) as Record<string, string>) }
		const archivedFields = {
			...((row.archivedFields ?? {}) as Record<string, string>)
		}

		const archived: string[] = []
		const restored: string[] = []
		// Tracked separately from the two lists because a collision changes the
		// row without belonging in either: the archived copy is dropped and
		// nothing is restored. Reporting it as a restore would be a lie, and
		// deciding to write from the lists alone would leave the stale copy in
		// the archive for good — the sweep would then find the same collision
		// on every boot and never resolve it.
		let changed = false

		for (const key of Object.keys(fields))
			if (!known.has(key)) {
				archivedFields[key] = fields[key]!
				delete fields[key]
				archived.push(key)
				changed = true
			}

		for (const key of Object.keys(archivedFields))
			if (known.has(key)) {
				// `fields` wins — see the note above.
				if (!(key in fields)) {
					fields[key] = archivedFields[key]!
					restored.push(key)
				}
				delete archivedFields[key]
				changed = true
			}

		if (!changed) continue

		await db
			.update(schema.pipelinePrompts)
			.set({ fields, archivedFields, updatedAt: new Date() })
			.where(eq(schema.pipelinePrompts.id, row.id))

		out.push({ promptId: row.id, name: row.name, archived, restored })
	}
	return out
}
