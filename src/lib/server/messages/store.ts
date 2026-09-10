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

import { and, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	projectLegacy,
	ORDINAL_MARKDOWN,
	type LegacyMessageRow,
	type NewMessage,
	type NewPart
} from "./projectLegacy"
import { textOf, type TextOfOptions } from "./textOf"
import { byLaneThenTime, channelSpansLanes, channelWhere } from "./channels"

export { textOf } from "./textOf"

/* ── the phase-1 write path (legacy vocabulary) ─────────────────────────── */

/**
 * Edge whitespace comes off every **committed** body (ruling 2026-09-08).
 *
 * It is never part of the text and it is not merely untidy: a stored body is
 * fed back to the model as the continue seed's prefill, and on the completion
 * path that seed's assistant block is rendered open (`prompt/messages.ts`), so
 * a trailing space lands *inside* the open block. Anthropic's Messages API
 * refuses a prefill ending in whitespace outright. Mid-word continues cannot be
 * detected reliably, so trimming at both ends of the round trip — here on save,
 * and again at compile — is the whole of the fix.
 *
 * **A streaming partial is exempt.** A patch that leaves `isGenerating: true`
 * is a mid-stream frame, and frames split anywhere: `"the sto"` then `" re."`.
 * Trimming one would delete a separator the next frame depends on and make the
 * live text differ from the text that lands. The write that closes the same run
 * carries `isGenerating: false`, so the row that survives the turn — the row a
 * later continue reads as its prefill — is trimmed either way.
 *
 * Only `content` is touched. `metadata.swipes.history` is written verbatim by
 * its callers and mirrored verbatim; that surface is out of this ruling's
 * scope.
 */
function trimCommittedContent<
	T extends { content?: unknown; isGenerating?: unknown }
>(values: T): T {
	if (values.isGenerating === true) return values
	if (typeof values.content !== "string") return values
	const content = values.content.trim()
	return content === values.content ? values : { ...values, content }
}

/** Insert one legacy-shaped message; mirrors to the new model. */
export async function insertLegacy(
	db: Db,
	values: Omit<typeof schema.sessionMessages.$inferInsert, "id">
): Promise<typeof schema.sessionMessages.$inferSelect> {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values(trimCommittedContent(values))
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
		.values(values.map(trimCommittedContent))
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
		.set(trimCommittedContent(patch))
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
	where: SQL | undefined,
	patch: Partial<typeof schema.sessionMessages.$inferInsert>
): Promise<Array<typeof schema.sessionMessages.$inferSelect>> {
	const rows = await db
		.update(schema.sessionMessages)
		.set(trimCommittedContent(patch))
		.where(where)
		.returning()
	for (const row of rows) await mirrorRow(db, row)
	return rows
}

/** Delete by predicate, from both worlds. */
export async function deleteLegacyWhere(
	db: Db,
	where: SQL | undefined
): Promise<Array<typeof schema.sessionMessages.$inferSelect>> {
	const rows = await db
		.delete(schema.sessionMessages)
		.where(where)
		.returning()
	if (rows.length)
		await db.delete(schema.messages).where(
			inArray(
				schema.messages.id,
				rows.map((r) => r.id)
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
	// Narrowed rather than laundered: `NewMessage.id` is optional because the
	// column is generated, and `projectLegacy` always sets it from the legacy
	// row — which is the whole id-allocation rule at the top of this file.
	await upsertProjection(db, message as NewMessage & { id: number }, parts)
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
				// Mirrored like every other field since 0200. It was pinned to
				// `existing.channel` while the legacy row had no channel column
				// — without that pin a greeting seeded onto a declared lane was
				// reset to `main` by the next edit. The legacy row can express
				// the lane now and is the single writer of it, so preserving
				// the mirror's copy would only let the two disagree, with the
				// prompt-facing read using the legacy one.
				channel: message.channel,
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
		// Through the same trim as every other committed body — this is the one
		// write in the file that reaches `session_messages` without going via
		// the legacy helpers, and `textOf` joins parts with blank lines, so a
		// step whose last part ends in a newline would leave one on the column.
		await db
			.update(schema.sessionMessages)
			.set(trimCommittedContent(patch))
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

/**
 * One session's messages, on one channel.
 *
 * An omitted channel is the session's default lane, `main` — the same rule
 * every other message read obeys (see `messages/channels.ts`). It used to
 * mean "every lane", which is the silent union that scoping exists to
 * prevent; `ALL_CHANNELS` is how a caller asks for that on purpose.
 *
 * A **bare slug is the whole channel** and `slug:n` is one lane of it (ruling
 * 2026-09-09). A whole-channel result comes back in lane-then-time order, so
 * several conversations under one slug read as several conversations; with only
 * lane 1 in play that ordering is the `id` ordering it already had.
 */
export async function listMessages(
	db: Db,
	sessionId: number,
	opts: { channel?: string } = {}
): Promise<MessageWithParts[]> {
	const where = and(
		eq(schema.messages.sessionId, sessionId),
		channelWhere(schema.messages.channel, opts.channel)
	)
	const listed = await db
		.select()
		.from(schema.messages)
		.where(where)
		.orderBy(schema.messages.id)
	const rows = channelSpansLanes(opts.channel)
		? byLaneThenTime(listed)
		: listed
	if (!rows.length) return []
	const parts = await db
		.select()
		.from(schema.messageParts)
		.where(
			inArray(
				schema.messageParts.messageId,
				rows.map((r) => r.id)
			)
		)
	const byMessage = new Map<number, any[]>()
	for (const p of parts) {
		const list = byMessage.get(p.messageId) ?? []
		list.push(p)
		byMessage.set(p.messageId, list)
	}
	return rows.map((r) => ({
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
