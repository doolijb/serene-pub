/**
 * The message store — the single writer of the message model (20 §1).
 *
 * ## Phase 1 posture (20 §13): the legacy row leads, the store mirrors
 *
 * Every legacy write path (`sessions.ts`, `host.ts`, `generateResponse`,
 * `generationStatus`, `import`) routes through `insertLegacy` /
 * `updateLegacy` / `deleteLegacy` instead of touching `session_messages`
 * directly. The store writes the legacy row *verbatim* — legacy semantics
 * stay exactly as they were, which is what keeps every unmigrated reader and
 * the whole parity corpus honest — and then re-derives that message's
 * `messages` + `message_parts` rows through `projectLegacy`, the same pure
 * function the boot migration runs. Re-projection is wholesale
 * (delete-and-reinsert the message's parts): idempotent, deterministic, and
 * immune to patch-interpretation drift because there is nothing to interpret.
 *
 * **Id allocation:** the legacy table's sequence allocates; `messages` rows
 * are always written with the legacy id explicitly, so the two tables agree
 * on identity for free and the `messages` sequence stays untouched until the
 * legacy table retires (one `setval` in that future migration).
 *
 * Phase 2 inverts authority: readers move to the new model, the native APIs
 * below become the write path, and the mirror runs the other way until the
 * legacy table goes read-only.
 */

import { and, eq, gt, inArray, lte, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	projectLegacy,
	ORDINAL_MARKDOWN,
	type LegacyMessageRow,
	type NewPart
} from "./projectLegacy"
import { textOf, type TextOfOptions } from "./textOf"

type Db = { select: any; insert: any; update: any; delete: any }

export { textOf } from "./textOf"

/* ── the phase-1 write path (legacy vocabulary) ─────────────────────────── */

/** Insert one legacy-shaped message; mirrors to the new model. */
export async function insertLegacy(
	db: Db,
	values: Omit<typeof schema.sessionMessages.$inferInsert, "id">
): Promise<typeof schema.sessionMessages.$inferSelect> {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values(values)
		.returning()
	await mirrorRow(db, row)
	return row
}

/** Insert many (the importer's path); mirrors each. */
export async function insertLegacyMany(
	db: Db,
	values: Array<Omit<typeof schema.sessionMessages.$inferInsert, "id">>
): Promise<Array<typeof schema.sessionMessages.$inferSelect>> {
	if (!values.length) return []
	const rows = await db
		.insert(schema.sessionMessages)
		.values(values)
		.returning()
	for (const row of rows) await mirrorRow(db, row)
	return rows
}

/** Patch one legacy row verbatim; re-mirrors from the result. */
export async function updateLegacy(
	db: Db,
	id: number,
	patch: Partial<typeof schema.sessionMessages.$inferInsert>
): Promise<typeof schema.sessionMessages.$inferSelect | undefined> {
	const [row] = await db
		.update(schema.sessionMessages)
		.set(patch)
		.where(eq(schema.sessionMessages.id, id))
		.returning()
	if (row) await mirrorRow(db, row)
	return row
}

/**
 * Patch by arbitrary predicate (the compound-where sites: "this id AND still
 * generating"); every row the update touched is re-mirrored.
 */
export async function updateLegacyWhere(
	db: Db,
	where: unknown,
	patch: Partial<typeof schema.sessionMessages.$inferInsert>
): Promise<Array<typeof schema.sessionMessages.$inferSelect>> {
	const rows = await db
		.update(schema.sessionMessages)
		.set(patch)
		.where(where)
		.returning()
	for (const row of rows) await mirrorRow(db, row)
	return rows
}

/** Delete by predicate, from both worlds. */
export async function deleteLegacyWhere(
	db: Db,
	where: unknown
): Promise<Array<typeof schema.sessionMessages.$inferSelect>> {
	const rows = await db
		.delete(schema.sessionMessages)
		.where(where)
		.returning()
	if (rows.length)
		await db.delete(schema.messages).where(
			inArray(
				schema.messages.id,
				rows.map((r: any) => r.id)
			)
		)
	return rows
}

/** Delete one message from both worlds. */
export async function deleteLegacy(db: Db, id: number): Promise<void> {
	await db
		.delete(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
	await db.delete(schema.messages).where(eq(schema.messages.id, id))
}

/** Re-derive one message's new-model rows from its legacy row. */
export async function mirrorRow(
	db: Db,
	row: LegacyMessageRow
): Promise<void> {
	const { message, parts } = projectLegacy(row)
	await upsertProjection(db, message as any, parts)
}

/**
 * The parts-address armistice (20 §13): the legacy mirror owns **step 0,
 * ordinals 0–2** — exactly the slots `projectLegacy` generates — and native
 * writes own everything else (steps ≥ 1, and ordinals ≥ `NATIVE_ORDINAL_BASE`
 * at step 0). Neither side ever touches the other's coordinates, so a legacy
 * swipe cannot delete a plugin's appended parts and a native append cannot
 * confuse the mirror. The same rule shapes the metadata merge below: the
 * mirror re-states only what the legacy row can express.
 */
export const NATIVE_ORDINAL_BASE = 10

async function upsertProjection(
	db: Db,
	message: typeof schema.messages.$inferInsert & { id: number },
	parts: NewPart[]
): Promise<void> {
	const [existing] = await db
		.select()
		.from(schema.messages)
		.where(eq(schema.messages.id, message.id))

	// Native state survives the mirror: step keys beyond 0 in the selection
	// map, plugin namespaces in extras, and a native kind a plugin stamped.
	const activeRevisions = {
		...(existing?.activeRevisions ?? {}),
		"0": (message.activeRevisions as Record<string, number>)["0"] ?? 0
	}
	const extras = {
		...(existing?.extras ?? {}),
		...(message.extras ?? {})
	}
	const nativeKind =
		existing &&
		existing.kind !== "core:chat" &&
		existing.kind !== "core:narration"

	await db
		.insert(schema.messages)
		.values({ ...message, activeRevisions, extras })
		.onConflictDoUpdate({
			target: schema.messages.id,
			set: {
				sessionId: message.sessionId,
				channel: nativeKind ? existing.channel : message.channel,
				kind: nativeKind ? existing.kind : message.kind,
				version: message.version,
				userId: message.userId,
				characterId: message.characterId,
				personaId: message.personaId,
				speakerLabel: nativeKind
					? existing.speakerLabel
					: message.speakerLabel,
				role: message.role,
				status: message.status,
				error: message.error,
				activeRevisions,
				extras,
				isHidden: message.isHidden,
				isEdited: message.isEdited,
				debugMeta: message.debugMeta,
				queueItemId: message.queueItemId,
				updatedAt: message.updatedAt
			}
		})
	// Reconcile the mirror's own address space (step 0, ordinals ≤ MARKDOWN,
	// every revision), and do it **concurrency-safely**. Streaming fires
	// overlapping `updateLegacyWhere` calls on one message, so two
	// re-projections can interleave (delete A, delete B, insert A, insert B);
	// a plain delete-then-insert makes B collide on the address index. So:
	// upsert the new parts (a racing duplicate updates the row rather than
	// throwing), and delete only the addresses that genuinely left the set —
	// a shrunk swipe history — never a blanket range that a sibling is about
	// to re-insert into.
	const keep = new Set(parts.map((p) => `${p.revision}:${p.ordinal}`))
	const existingParts: Array<{ revision: number; ordinal: number }> = await db
		.select({
			revision: schema.messageParts.revision,
			ordinal: schema.messageParts.ordinal
		})
		.from(schema.messageParts)
		.where(
			and(
				eq(schema.messageParts.messageId, message.id),
				eq(schema.messageParts.step, 0),
				lte(schema.messageParts.ordinal, ORDINAL_MARKDOWN)
			)
		)
	for (const e of existingParts)
		if (!keep.has(`${e.revision}:${e.ordinal}`))
			await db
				.delete(schema.messageParts)
				.where(
					and(
						eq(schema.messageParts.messageId, message.id),
						eq(schema.messageParts.step, 0),
						eq(schema.messageParts.revision, e.revision),
						eq(schema.messageParts.ordinal, e.ordinal)
					)
				)
	if (parts.length)
		await db
			.insert(schema.messageParts)
			.values(parts.map((p) => ({ ...p, messageId: message.id })))
			.onConflictDoUpdate({
				target: [
					schema.messageParts.messageId,
					schema.messageParts.step,
					schema.messageParts.revision,
					schema.messageParts.ordinal
				],
				set: {
					type: sql`excluded.type`,
					content: sql`excluded.content`,
					data: sql`excluded.data`
				}
			})
}

/* ── native writes (20 §13 phase 2+) ────────────────────────────────────── */

export interface NativePartInput {
	type: string
	content?: string | null
	data?: Record<string, unknown> | null
}

/**
 * Append parts to a message's current step, at native ordinals.
 *
 * v1 refuses `core:markdown`: the message *body* is still legacy-led (the
 * mirror owns it), and a native markdown append would make the legacy
 * `content` column a lie. Everything else — sections, images, files, blocks,
 * tool parts — does not enter the default `textOf` projection, so the legacy
 * surface stays exactly right while the parts surface grows.
 */
export async function appendParts(
	db: Db,
	messageId: number,
	parts: NativePartInput[],
	opts: { step?: number } = {}
): Promise<Array<typeof schema.messageParts.$inferSelect>> {
	if (!parts.length) return []
	for (const p of parts)
		if (p.type === "core:markdown")
			throw new Error(
				"appendParts refuses core:markdown while the body is legacy-led " +
					"(20 §13) — write body text through the legacy path, or open a " +
					"new step with appendStep."
			)
	const msg = await getMessage(db, messageId)
	if (!msg) throw new Error(`no message ${messageId} to append to`)
	const steps = [...new Set(msg.parts.map((p) => p.step))]
	const step = opts.step ?? (steps.length ? Math.max(...steps) : 0)
	const revision = msg.activeRevisions[String(step)] ?? 0
	const maxOrdinal = Math.max(
		NATIVE_ORDINAL_BASE - 1,
		...msg.parts
			.filter((p) => p.step === step && p.revision === revision)
			.map((p) => p.ordinal)
	)
	const rows = await db
		.insert(schema.messageParts)
		.values(
			parts.map((p, i) => ({
				messageId,
				step,
				revision,
				ordinal: maxOrdinal + 1 + i,
				type: p.type,
				content: p.content ?? null,
				data: p.data ?? null
			}))
		)
		.returning()
	await db
		.update(schema.messages)
		.set({ updatedAt: new Date() })
		.where(eq(schema.messages.id, messageId))
	return rows
}

/**
 * Open the next step (20 §1): parts land at step max+1, revision 0, and the
 * freeze rule takes effect — the previous step's selection is now frozen at
 * whatever produced this one. Markdown is legal here (a step's body is
 * native-led); the legacy `content` column is refreshed to the full `textOf`
 * so unmigrated readers see the whole activity as text.
 */
export async function appendStep(
	db: Db,
	messageId: number,
	parts: NativePartInput[]
): Promise<number> {
	const msg = await getMessage(db, messageId)
	if (!msg) throw new Error(`no message ${messageId} to step`)
	const steps = [...new Set(msg.parts.map((p) => p.step))]
	const step = (steps.length ? Math.max(...steps) : 0) + 1
	await db.insert(schema.messageParts).values(
		parts.map((p, i) => ({
			messageId,
			step,
			revision: 0,
			ordinal: NATIVE_ORDINAL_BASE + i,
			type: p.type,
			content: p.content ?? null,
			data: p.data ?? null
		}))
	)
	await db
		.update(schema.messages)
		.set({
			activeRevisions: { ...msg.activeRevisions, [String(step)]: 0 },
			updatedAt: new Date()
		})
		.where(eq(schema.messages.id, messageId))
	// Refresh the legacy surface, without touching the mirror's own slots.
	// The step-0 body must be pinned into `metadata.swipes` first: the legacy
	// `content` column now carries the *combined* text, and a later re-mirror
	// derives step 0's markdown from `swipes.history` when it exists — from
	// `content` when it does not, which would double the step texts. Pinning
	// makes the projection stable whatever legacy patch lands afterwards.
	const after = await getMessage(db, messageId)
	if (after) {
		const [legacy] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, messageId))
		const meta = (legacy?.metadata ?? {}) as Record<string, any>
		const patch: Record<string, unknown> = { content: textOf(after) }
		if (!meta.swipes?.history?.length) {
			const step0 = after.parts.find(
				(p) =>
					p.step === 0 &&
					p.revision === (after.activeRevisions["0"] ?? 0) &&
					p.type === "core:markdown"
			)
			patch.metadata = {
				...meta,
				swipes: {
					currentIdx: 0,
					history: [step0?.content ?? ""]
				}
			}
		}
		await db
			.update(schema.sessionMessages)
			.set(patch)
			.where(eq(schema.sessionMessages.id, messageId))
	}
	return step
}

/** Whether native steps exist — the freeze rule's gate for legacy swipes. */
export async function hasNativeSteps(
	db: Db,
	messageId: number
): Promise<boolean> {
	const [row] = await db
		.select({ id: schema.messageParts.id })
		.from(schema.messageParts)
		.where(
			and(
				eq(schema.messageParts.messageId, messageId),
				gt(schema.messageParts.step, 0)
			)
		)
		.limit(1)
	return !!row
}

/* ── the boot migration (20 §5) ─────────────────────────────────────────── */

/**
 * One-shot and idempotent: projects every legacy row that has no new-model
 * row yet. Safe to run on every boot — after the first pass the runtime
 * mirror keeps the worlds in step, so the scan finds nothing.
 */
export async function migrateMessages(
	db: Db
): Promise<{ migrated: number }> {
	const legacyIds: Array<{ id: number }> = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
	const haveIds: Array<{ id: number }> = await db
		.select({ id: schema.messages.id })
		.from(schema.messages)
	const have = new Set(haveIds.map((r) => r.id))
	const missing = legacyIds.map((r) => r.id).filter((id) => !have.has(id))
	if (!missing.length) return { migrated: 0 }

	// Chunked so a large history neither builds one giant IN() nor holds a
	// transaction open across the whole table.
	const CHUNK = 200
	for (let i = 0; i < missing.length; i += CHUNK) {
		const rows: LegacyMessageRow[] = await db
			.select()
			.from(schema.sessionMessages)
			.where(
				inArray(schema.sessionMessages.id, missing.slice(i, i + CHUNK))
			)
		for (const row of rows) await mirrorRow(db, row)
	}
	return { migrated: missing.length }
}

/* ── native reads (phase 2 grows the native writes) ─────────────────────── */

export interface MessageWithParts
	extends Omit<typeof schema.messages.$inferSelect, never> {
	parts: Array<typeof schema.messageParts.$inferSelect>
}

export async function getMessage(
	db: Db,
	id: number
): Promise<MessageWithParts | undefined> {
	const [message] = await db
		.select()
		.from(schema.messages)
		.where(eq(schema.messages.id, id))
	if (!message) return undefined
	const parts = await db
		.select()
		.from(schema.messageParts)
		.where(eq(schema.messageParts.messageId, id))
	return { ...message, parts: sortParts(parts) }
}

export async function listMessages(
	db: Db,
	sessionId: number,
	opts: { channel?: string } = {}
): Promise<MessageWithParts[]> {
	const where = opts.channel
		? and(
				eq(schema.messages.sessionId, sessionId),
				eq(schema.messages.channel, opts.channel)
			)
		: eq(schema.messages.sessionId, sessionId)
	const rows = await db
		.select()
		.from(schema.messages)
		.where(where)
		.orderBy(schema.messages.id)
	if (!rows.length) return []
	const parts = await db
		.select()
		.from(schema.messageParts)
		.where(
			inArray(
				schema.messageParts.messageId,
				rows.map((r: any) => r.id)
			)
		)
	const byMessage = new Map<number, any[]>()
	for (const p of parts) {
		const list = byMessage.get(p.messageId) ?? []
		list.push(p)
		byMessage.set(p.messageId, list)
	}
	return rows.map((r: any) => ({
		...r,
		parts: sortParts(byMessage.get(r.id) ?? [])
	}))
}

/**
 * Wire enrichment (20 §13 phase 2): merge each legacy-shaped row's new-model
 * half onto it — parts, the selection map, kind, speaker label, channel,
 * extras — so the client can render parts-native while every legacy field
 * keeps working. Rows with no projection yet (a not-yet-mirrored write mid
 * flight) pass through untouched; the client's legacy fallback renders them
 * identically, which is what the parity gate guarantees.
 */
export async function attachParts<T extends { id: number }>(
	db: Db,
	rows: T[]
): Promise<
	Array<
		T & {
			parts?: Array<typeof schema.messageParts.$inferSelect>
			activeRevisions?: Record<string, number>
			kind?: string
			speakerLabel?: string | null
			channel?: string
			extras?: Record<string, unknown>
			version?: string | null
		}
	>
> {
	if (!rows.length) return rows
	const ids = rows.map((r) => r.id)
	const metas: Array<typeof schema.messages.$inferSelect> = await db
		.select()
		.from(schema.messages)
		.where(inArray(schema.messages.id, ids))
	const parts: Array<typeof schema.messageParts.$inferSelect> = await db
		.select()
		.from(schema.messageParts)
		.where(inArray(schema.messageParts.messageId, ids))
	const metaById = new Map(metas.map((m) => [m.id, m]))
	const partsById = new Map<number, any[]>()
	for (const p of parts) {
		const list = partsById.get(p.messageId) ?? []
		list.push(p)
		partsById.set(p.messageId, list)
	}
	return rows.map((r) => {
		const meta = metaById.get(r.id)
		if (!meta) return r
		return {
			...r,
			parts: sortParts(partsById.get(r.id) ?? []),
			activeRevisions: meta.activeRevisions,
			kind: meta.kind,
			speakerLabel: meta.speakerLabel,
			channel: meta.channel,
			extras: meta.extras,
			version: meta.version
		}
	})
}

export function messageText(
	message: MessageWithParts,
	opts?: TextOfOptions
): string {
	return textOf(message, opts)
}

const sortParts = <T extends { step: number; revision: number; ordinal: number }>(
	parts: T[]
): T[] =>
	[...parts].sort(
		(a, b) => a.step - b.step || a.revision - b.revision || a.ordinal - b.ordinal
	)

/* ── the invariant (20 §1) ──────────────────────────────────────────────── */

/**
 * Every key in `active_revisions` names a step that exists and a revision
 * that exists at it. The store being the single writer is what *keeps* this
 * true; this check is what *proves* it in tests and diagnostics.
 */
export function checkMapInvariant(message: MessageWithParts): string[] {
	const problems: string[] = []
	const bySteps = new Map<number, Set<number>>()
	for (const p of message.parts) {
		const revs = bySteps.get(p.step) ?? new Set<number>()
		revs.add(p.revision)
		bySteps.set(p.step, revs)
	}
	for (const [stepKey, rev] of Object.entries(message.activeRevisions)) {
		const step = Number(stepKey)
		const revs = bySteps.get(step)
		if (!revs)
			problems.push(`active_revisions names step ${step} with no parts`)
		else if (!revs.has(rev))
			problems.push(
				`active_revisions selects revision ${rev} of step ${step}, which has no parts`
			)
	}
	return problems
}
