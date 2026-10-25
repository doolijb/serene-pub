/**
 * 🚧 **Lore imprints** — what a session's runs wrote on a lorebook, taken
 * back with the message that caused them (RF fix 4, 2026-10-23; the rule
 * **what a message changed goes with it**, NOMENCLATURE §24).
 *
 * Everything a run writes is anchored to the message that caused it and
 * carries the run. State, zones and proposals carry that on their own rows
 * (`state/write.ts`, `rulesets/zones.ts`); a write on a lorebook row — an
 * entry's field, a tie's words on its relationship row, a cast member's
 * state, the notes' rule-fed overlay, a room or a link a run filed — leaves
 * an **imprint** here (`lore_imprints`): the field, what it held before and
 * after, or the row it made. One table for every lorebook subject, because
 * the question is the same for all of them: *is this still as the run left
 * it?*
 *
 * ## The one retraction rule (`retractImprints`)
 *
 * A swipe, a regenerate, a delete and a failed reply all take back what the
 * message changed, newest imprint first:
 *
 *  1. **A later run wrote the same field since** (its imprint still stands):
 *     the field is that run's now. When its `before` is this one's `after`
 *     the chain is spliced (the later imprint takes this one's `before`, so
 *     taking IT back later lands where the field stood before both); when it
 *     is not, a person had already overwritten this write — nothing of it is
 *     left, and the imprint goes quietly.
 *  2. **Otherwise, on a session's own notes, it is reverted** — always: the
 *     notes are the session's, and a revised turn revises them.
 *  3. **On a real lorebook it is reverted only while the field still holds
 *     exactly what the run wrote** (or, for a row it made, the row is as made
 *     and nothing else stands on it). A shared book is never silently
 *     rewritten: when someone has changed it since, it stays, and the imprint
 *     is **kept** — the entry says it was *written by a reply that was since
 *     replaced*, with **Revert** for whoever may edit the book
 *     (`settleKeptImprint`).
 *
 * What the retraction did is handed back, row for row (`TakenImprint`), so a
 * replacement run that fails puts the world back as it was
 * (`restoreImprints`, through `restoreRetractedState`).
 *
 * ⚠ Every function takes its handle: inside a transaction the caller hands
 * its `tx` (the outer `db` deadlocks PGlite). Never statically imports
 * `$lib/server/db`.
 */
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm"
import { i18nText } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { KeptImprint } from "$lib/shared/entries/types"
import { assertRetractable, settledLineOf } from "$lib/server/sessions/settle"

/** What an imprint is written on: its subject's kind. */
export const IMPRINT_SUBJECTS = ["entry", "relationship", "member", "overlay"] as const
export type ImprintSubject = (typeof IMPRINT_SUBJECTS)[number]

/**
 * `standing` — in force; `kept` — its reply was replaced, and the book had
 * moved on (or a person edited the field); `settled` — the settle line passed
 * it, so it cannot be taken back (pr-6 A3).
 */
export const IMPRINT_STATUSES = ["standing", "kept", "settled"] as const
export type ImprintStatus = (typeof IMPRINT_STATUSES)[number]

export type LoreImprintRow = typeof schema.loreImprints.$inferSelect

/** Where an imprint is filed: the session, the message that caused it, the run. */
export interface ImprintAnchor {
	sessionId: number
	/** The turn's message; null for a session with no messages yet. */
	messageId: number | null
	runId: string | null
}

type Wrapped = { v: unknown } | null
const wrap = (v: unknown): Wrapped => (v === undefined ? null : { v: plain(v) })
const unwrap = (w: Wrapped | undefined): unknown => (w == null ? undefined : w.v)

/** A value as JSON keeps it — a `Date` as its ISO string. */
function plain(v: unknown): unknown {
	return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}

/** One spelling of a value, keys sorted: what "exactly as the run left it" compares. */
function canonical(v: unknown): string {
	if (v === undefined) return "\u0000absent"
	if (v instanceof Date) return JSON.stringify(v.toISOString())
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>
		return `{${Object.keys(o)
			.filter((k) => o[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
			.join(",")}}`
	}
	return JSON.stringify(v)
}

/** Whether two values are the same value (absent is its own answer). */
export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

// ── The subjects ────────────────────────────────────────────────────────────

/** How one subject kind is read, written, removed and put back. */
interface SubjectAccess {
	row(db: Db, id: number): Promise<Record<string, unknown> | null>
	/** The book the row stands in now. */
	bookOf(row: Record<string, unknown>): number | null
	read(row: Record<string, unknown>, field: string): unknown
	write(db: Db, id: number, field: string, value: unknown): Promise<void>
	/** A made row: removed (its cascade with it), and put back from its snapshot. */
	remove?(db: Db, id: number): Promise<void>
	insert?(db: Db, snapshot: Record<string, unknown>): Promise<void>
	/** The columns a made row is judged on — derived ones (vectors, hashes, stamps) never. */
	ignored?: ReadonlySet<string>
	/** Something else stands on the row that its removal would take with it. */
	holds?(db: Db, id: number): Promise<boolean>
}

const E = schema.lorebookEntries
const R = schema.narrativeRelationships
const B = schema.lorebookBindings

const FIELD_PREFIX = "fields."
/** The `fields.<key>` address of an entry's typed field. */
export const entryFieldAddress = (key: string) => `${FIELD_PREFIX}${key}`

/** A snapshot's dates are strings in JSON; the row's are dates. */
const withDates = (snap: Record<string, unknown>, keys: readonly string[]) => {
	const out = { ...snap }
	for (const k of keys) if (typeof out[k] === "string") out[k] = new Date(out[k] as string)
	return out
}
const without = (snap: Record<string, unknown>, keys: ReadonlySet<string>) =>
	Object.fromEntries(Object.entries(snap).filter(([k]) => !keys.has(k)))

const ENTRY_DERIVED = new Set(["embedTextHash", "annotationTextHash"])
const RELATIONSHIP_DERIVED = new Set(["embedding", "embeddingModel", "embeddingSourceHash", "vectorizedAt"])

const SUBJECTS: Record<ImprintSubject, SubjectAccess> = {
	entry: {
		async row(db, id) {
			const [row] = await db.select().from(E).where(eq(E.id, id)).limit(1)
			return (row as Record<string, unknown> | undefined) ?? null
		},
		bookOf: (row) => row.lorebookId as number,
		read(row, field) {
			if (field.startsWith(FIELD_PREFIX)) {
				const fields = (row.fields ?? {}) as Record<string, unknown>
				return fields[field.slice(FIELD_PREFIX.length)]
			}
			return row[field] ?? undefined
		},
		async write(db, id, field, value) {
			const { mergeFields, DEFAULT_VECTOR_NAME } = await import("$lib/server/utils/lorebookEntries")
			if (field.startsWith(FIELD_PREFIX)) {
				await db
					.update(E)
					.set({ fields: mergeFields({ [field.slice(FIELD_PREFIX.length)]: value ?? null }) as never })
					.where(eq(E.id, id))
				return
			}
			await db
				.update(E)
				.set({ [field]: value ?? null } as never)
				.where(eq(E.id, id))
			// What the default space embeds moved: its vector is stale (as the outlet's write says).
			if (field === "title" || field === "content")
				await db
					.delete(schema.lorebookEntryVectors)
					.where(
						and(
							eq(schema.lorebookEntryVectors.entryId, id),
							eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME)
						)
					)
		},
		async remove(db, id) {
			await db.delete(E).where(eq(E.id, id))
		},
		async insert(db, snapshot) {
			await db.insert(E).values(withDates(without(snapshot, ENTRY_DERIVED), ["createdAt", "updatedAt"]) as never)
		},
		ignored: new Set(["id", "createdAt", "updatedAt", "position", ...ENTRY_DERIVED]),
		async holds(db, id) {
			const [link] = await db
				.select({ id: R.id })
				.from(R)
				.where(or(eq(R.fromEntryId, id), eq(R.toEntryId, id)))
				.limit(1)
			if (link) return true
			const [child] = await db.select({ id: E.id }).from(E).where(eq(E.anchorEntryId, id)).limit(1)
			if (child) return true
			const [amended] = await db
				.select({ id: schema.entryAmendments.id })
				.from(schema.entryAmendments)
				.where(eq(schema.entryAmendments.entryId, id))
				.limit(1)
			return !!amended
		}
	},
	relationship: {
		async row(db, id) {
			const [row] = await db.select().from(R).where(eq(R.id, id)).limit(1)
			return (row as Record<string, unknown> | undefined) ?? null
		},
		bookOf: (row) => row.lorebookId as number,
		read: (row, field) => row[field] ?? undefined,
		async write(db, id, field, value) {
			await db
				.update(R)
				.set({ [field]: value ?? null } as never)
				.where(eq(R.id, id))
		},
		async remove(db, id) {
			await db.delete(R).where(eq(R.id, id))
		},
		async insert(db, snapshot) {
			await db.insert(R).values(withDates(without(snapshot, RELATIONSHIP_DERIVED), ["createdAt", "updatedAt"]) as never)
		},
		ignored: new Set(["id", "createdAt", "updatedAt", ...RELATIONSHIP_DERIVED])
	},
	member: {
		async row(db, id) {
			const [row] = await db.select().from(B).where(eq(B.id, id)).limit(1)
			return (row as Record<string, unknown> | undefined) ?? null
		},
		bookOf: (row) => row.lorebookId as number,
		read: (row, field) => row[field] ?? undefined,
		async write(db, id, field, value) {
			await db
				.update(B)
				.set({ [field]: value ?? null } as never)
				.where(eq(B.id, id))
		}
	},
	/**
	 * The notes' rule-fed overlay (`lorebooks.extra_json.ruleFed`, ties T3
	 * ★5), by the notes' own id: `entryFields.<entry id>.<field>` or
	 * `castStates.<member id>`.
	 */
	overlay: {
		async row(db, id) {
			const [row] = await db
				.select({ id: schema.lorebooks.id, extraJson: schema.lorebooks.extraJson })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, id))
				.limit(1)
			return row ? { ...row, lorebookId: row.id } : null
		},
		bookOf: (row) => row.lorebookId as number,
		read(row, field) {
			const fed = ((row.extraJson ?? {}) as Record<string, unknown>).ruleFed as Record<string, any> | undefined
			const [kind, id, ...rest] = field.split(".")
			const at = fed?.[kind!]?.[id!]
			return rest.length ? at?.[rest.join(".")] : at
		},
		async write(db, id, field, value) {
			const [book] = await db
				.select({ extraJson: schema.lorebooks.extraJson })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, id))
				.limit(1)
			if (!book) return
			const extra = { ...((book.extraJson ?? {}) as Record<string, unknown>) }
			const fed: Record<string, any> = { entryFields: {}, castStates: {}, ...((extra.ruleFed ?? {}) as Record<string, any>) }
			const [kind, key, ...rest] = field.split(".")
			const group = { ...(fed[kind!] ?? {}) }
			if (rest.length) {
				const one = { ...(group[key!] ?? {}) }
				if (value === undefined) delete one[rest.join(".")]
				else one[rest.join(".")] = value
				if (Object.keys(one).length) group[key!] = one
				else delete group[key!]
			} else if (value === undefined) delete group[key!]
			else group[key!] = value
			fed[kind!] = group
			extra.ruleFed = fed
			await db.update(schema.lorebooks).set({ extraJson: extra }).where(eq(schema.lorebooks.id, id))
		}
	}
}

// ── Writing one ─────────────────────────────────────────────────────────────

/**
 * File one field a run wrote: what it held, what it holds now. Nothing for
 * a write that changed nothing. A **kept** imprint on the same field goes:
 * its note ("written by a reply that was since replaced") describes a field
 * only until something writes it again.
 */
export async function imprintField(
	db: Db,
	anchor: ImprintAnchor,
	at: { lorebookId: number; subject: ImprintSubject; subjectId: number; field: string },
	before: unknown,
	after: unknown
): Promise<void> {
	if (sameValue(before, after)) return
	const I = schema.loreImprints
	await db
		.delete(I)
		.where(
			and(
				eq(I.subjectKind, at.subject),
				eq(I.subjectId, at.subjectId),
				eq(I.field, at.field),
				eq(I.status, "kept")
			)
		)
	await db.insert(I).values({
		sessionId: anchor.sessionId,
		messageId: anchor.messageId,
		runId: anchor.runId,
		lorebookId: at.lorebookId,
		subjectKind: at.subject,
		subjectId: at.subjectId,
		field: at.field,
		before: wrap(before),
		after: wrap(after)
	})
}

/** File every field of a row a run changed, read before and after the write. */
export async function imprintChanges(
	db: Db,
	anchor: ImprintAnchor,
	at: { lorebookId: number; subject: ImprintSubject; subjectId: number },
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	fields: readonly string[]
): Promise<void> {
	const access = SUBJECTS[at.subject]
	for (const field of fields)
		await imprintField(db, anchor, { ...at, field }, access.read(before, field), access.read(after, field))
}

/** File a row a run made, as made: retracting it removes the row. */
export async function imprintMade(
	db: Db,
	anchor: ImprintAnchor,
	at: { lorebookId: number; subject: "entry" | "relationship"; subjectId: number }
): Promise<void> {
	const row = await SUBJECTS[at.subject].row(db, at.subjectId)
	if (!row) return
	await db.insert(schema.loreImprints).values({
		sessionId: anchor.sessionId,
		messageId: anchor.messageId,
		runId: anchor.runId,
		lorebookId: at.lorebookId,
		subjectKind: at.subject,
		subjectId: at.subjectId,
		field: null,
		before: null,
		after: wrap(row)
	})
}

/**
 * The anchor a run's lorebook write files under: the turn's message when
 * the run has one (a message of this session), else the session's newest —
 * the same anchor the notes' rows take (`turnAnchorOf`).
 */
export async function imprintAnchorFor(
	db: Db,
	sessionId: number,
	opts: { turnMessageId?: number | null; runId?: string | null }
): Promise<ImprintAnchor> {
	const { turnAnchorOf } = await import("$lib/server/lorebooks/ownBook")
	return {
		sessionId,
		messageId: await turnAnchorOf(db, sessionId, opts.turnMessageId ?? null),
		runId: opts.runId ?? null
	}
}

// ── Taking them back ────────────────────────────────────────────────────────

/** What the retraction did with one imprint — enough to put it back. */
export type TakenImprint =
	| { act: "reverted"; imprint: LoreImprintRow }
	| { act: "spliced"; imprint: LoreImprintRow; later: { id: number; before: Wrapped } }
	| { act: "kept"; imprint: LoreImprintRow }
	| { act: "unmade"; imprint: LoreImprintRow; row: Record<string, unknown>; orphans: LoreImprintRow[] }
	| { act: "dropped"; imprint: LoreImprintRow }

/** Which imprints a retraction walks: a message's (swipe, delete), or a turn's runs' (a retake). */
export type ImprintSelection =
	| { messageIds: readonly number[] }
	| { sessionId: number; runIds: readonly string[] }

async function isNotes(db: Db, lorebookId: number, cache: Map<number, boolean>): Promise<boolean> {
	const hit = cache.get(lorebookId)
	if (hit !== undefined) return hit
	const [book] = await db
		.select({ sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	const notes = book?.sessionId != null
	cache.set(lorebookId, notes)
	return notes
}

/**
 * **Take back what a message changed on the lorebook** — the one retraction
 * rule above, every standing imprint the selection names, newest first.
 * Returns what was done, for `restoreImprints`.
 */
export async function retractImprints(db: Db, selection: ImprintSelection): Promise<TakenImprint[]> {
	const I = schema.loreImprints
	// The settle line (pr-6 A3): a message selection refuses at or below it;
	// a run selection leaves settled stretches alone.
	if ("messageIds" in selection) {
		for (const id of selection.messageIds) await assertRetractable(db, id)
	}
	const line = "messageIds" in selection ? null : await settledLineOf(db, selection.sessionId)
	const where =
		"messageIds" in selection
			? selection.messageIds.length
				? inArray(I.messageId, [...selection.messageIds])
				: undefined
			: selection.runIds.length
				? and(
						eq(I.sessionId, selection.sessionId),
						inArray(I.runId, [...selection.runIds]),
						line != null ? or(isNull(I.messageId), gt(I.messageId, line)) : undefined
					)
				: undefined
	if (!where) return []
	const batch = (await db
		.select()
		.from(I)
		.where(and(where, eq(I.status, "standing")))
		.orderBy(desc(I.id))) as LoreImprintRow[]
	const taken: TakenImprint[] = []
	const notesCache = new Map<number, boolean>()
	/** Kept by THIS retraction: an earlier write of the same message joins its note rather than adding a second. */
	const keptNow = new Set<number>()
	const drop = (id: number) => db.delete(I).where(eq(I.id, id))
	for (const imprint of batch) {
		const subject = imprint.subjectKind as ImprintSubject
		const access = SUBJECTS[subject]
		const row = await access.row(db, imprint.subjectId)
		// Gone since, or carried out of the book it was written in (a note
		// applied to the lorebook is the person's now): nothing to take back.
		if (!row || access.bookOf(row) !== imprint.lorebookId) {
			await drop(imprint.id)
			taken.push({ act: "dropped", imprint })
			continue
		}
		const notes = await isNotes(db, imprint.lorebookId, notesCache)
		if (imprint.field != null) {
			const [later] = await db
				.select()
				.from(I)
				.where(
					and(
						eq(I.subjectKind, imprint.subjectKind),
						eq(I.subjectId, imprint.subjectId),
						eq(I.field, imprint.field),
						keptNow.size
							? or(eq(I.status, "standing"), inArray(I.id, [...keptNow]))
							: eq(I.status, "standing"),
						gt(I.id, imprint.id)
					)
				)
				.orderBy(I.id)
				.limit(1)
			if (later) {
				// 1. A later run wrote the field since: it is that run's now.
				if (sameValue(unwrap(later.before), unwrap(imprint.after))) {
					await db.update(I).set({ before: imprint.before }).where(eq(I.id, later.id))
					taken.push({ act: "spliced", imprint, later: { id: later.id, before: later.before } })
				} else taken.push({ act: "dropped", imprint })
				await drop(imprint.id)
				continue
			}
			const now = access.read(row, imprint.field)
			if (notes || sameValue(now, unwrap(imprint.after))) {
				// 2–3. The notes always; a book while the field is as the run left it.
				await access.write(db, imprint.subjectId, imprint.field, unwrap(imprint.before))
				await drop(imprint.id)
				taken.push({ act: "reverted", imprint })
				continue
			}
			// 3. Changed since, on a real book: it stays, and says so.
			await db.update(I).set({ status: "kept" }).where(eq(I.id, imprint.id))
			keptNow.add(imprint.id)
			taken.push({ act: "kept", imprint })
			continue
		}
		// A row the run made.
		const laterOnRow = (await db
			.select()
			.from(I)
			.where(
				and(
					eq(I.subjectKind, imprint.subjectKind),
					eq(I.subjectId, imprint.subjectId),
					gt(I.id, imprint.id)
				)
			)) as LoreImprintRow[]
		const asMade = (unwrap(imprint.after) ?? {}) as Record<string, unknown>
		const untouched =
			!laterOnRow.some((l) => l.status === "standing") &&
			Object.keys(asMade)
				.filter((k) => !access.ignored?.has(k))
				.every((k) => sameValue(row[k] ?? undefined, asMade[k] ?? undefined)) &&
			!(await access.holds?.(db, imprint.subjectId))
		if (notes || untouched) {
			await access.remove!(db, imprint.subjectId)
			// What a later run wrote on the row went with it.
			if (laterOnRow.length) await db.delete(I).where(inArray(I.id, laterOnRow.map((l) => l.id)))
			await drop(imprint.id)
			taken.push({ act: "unmade", imprint, row: plain(row) as Record<string, unknown>, orphans: laterOnRow })
			continue
		}
		await db.update(I).set({ status: "kept" }).where(eq(I.id, imprint.id))
		keptNow.add(imprint.id)
		taken.push({ act: "kept", imprint })
	}
	return taken
}

/**
 * **Put back what `retractImprints` took** — a replacement run that failed
 * replaced nothing (`restoreRetractedState`). Oldest first, the reverse of
 * the retraction: a made row comes back, ids and all, before what was
 * written on it; each field goes back to what the run wrote while it still
 * holds what the retraction left.
 */
export async function restoreImprints(db: Db, taken: readonly TakenImprint[]): Promise<boolean> {
	const I = schema.loreImprints
	let changed = false
	for (const t of [...taken].reverse()) {
		const access = SUBJECTS[t.imprint.subjectKind as ImprintSubject]
		if (t.act === "dropped") continue
		if (t.act === "kept") {
			await db.update(I).set({ status: "standing" }).where(eq(I.id, t.imprint.id))
			continue
		}
		if (t.act === "spliced") {
			await db.update(I).set({ before: t.later.before }).where(eq(I.id, t.later.id))
			await db.insert(I).values(t.imprint as never)
			continue
		}
		if (t.act === "unmade") {
			await access.insert!(db, t.row)
			await db.insert(I).values(t.imprint as never)
			if (t.orphans.length) await db.insert(I).values(t.orphans as never)
			changed = true
			continue
		}
		// reverted
		const row = await access.row(db, t.imprint.subjectId)
		if (row && sameValue(access.read(row, t.imprint.field!), unwrap(t.imprint.before))) {
			await access.write(db, t.imprint.subjectId, t.imprint.field!, unwrap(t.imprint.after))
			changed = true
		}
		await db.insert(I).values(t.imprint as never)
	}
	return changed
}

/** Whether a retraction changed what anyone reads (a kept or dropped imprint changes nothing). */
export const imprintsChanged = (taken: readonly TakenImprint[]): boolean =>
	taken.some((t) => t.act === "reverted" || t.act === "unmade")

// ── The note, and its Revert ────────────────────────────────────────────────

/** One kept imprint, as the entry's note says it (on the wire, `LorebookEntry.keptImprints`). */
export type { KeptImprint }

/** A field address in words, as the entry's form names it. */
function fieldLabel(field: string, decl?: { fields?: Record<string, { label?: unknown }> }): string {
	if (field.startsWith(FIELD_PREFIX)) {
		const key = field.slice(FIELD_PREFIX.length)
		return i18nText(decl?.fields?.[key]?.label as never) ?? key
	}
	if (field === "title") return "Name"
	if (field === "content") return "Content"
	return field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
}

/** The kept imprints on a book's entries, by entry id — what each entry's note says. */
export async function keptImprintsByEntry(
	db: Db,
	lorebookId: number,
	entryIds: readonly number[]
): Promise<Map<number, KeptImprint[]>> {
	const out = new Map<number, KeptImprint[]>()
	if (!entryIds.length) return out
	const I = schema.loreImprints
	const rows = (await db
		.select({ imprint: I, typeId: E.typeId })
		.from(I)
		.innerJoin(E, eq(E.id, I.subjectId))
		.where(
			and(
				eq(I.lorebookId, lorebookId),
				eq(I.status, "kept"),
				eq(I.subjectKind, "entry"),
				inArray(I.subjectId, [...entryIds])
			)
		)
		.orderBy(I.id)) as { imprint: LoreImprintRow; typeId: string }[]
	if (!rows.length) return out
	const { entryDeclaration } = await import("$lib/server/entries/declarations")
	for (const { imprint, typeId } of rows) {
		const decl = entryDeclaration(typeId) as { fields?: Record<string, { label?: unknown }> } | undefined
		const list = out.get(imprint.subjectId) ?? []
		list.push({
			id: imprint.id,
			field: imprint.field,
			label: imprint.field ? fieldLabel(imprint.field, decl) : null,
			...(imprint.field && imprint.before ? { before: imprint.before.v } : {}),
			...(imprint.after && imprint.field ? { after: imprint.after.v } : {}),
			at: (imprint.createdAt instanceof Date ? imprint.createdAt : new Date(imprint.createdAt)).toISOString()
		})
		out.set(imprint.subjectId, list)
	}
	return out
}

/** The refusals the note's buttons give, in their own sentences. */
export const KEPT_IMPRINT_REFUSALS = Object.freeze({
	missing: "That change is no longer waiting on a decision.",
	notYours: "Only someone who may edit this lorebook can revert it."
})

/**
 * A person wrote these fields of a lorebook row: every `standing` imprint on
 * them becomes `kept` now, and the made-row imprint (`field IS NULL`) of that
 * row too. Returns how many.
 */
export async function markImprintsKept(
	db: Db,
	at: { subjectKind: ImprintSubject; subjectId: number; fields: readonly string[] }
): Promise<number> {
	if (!at.fields.length) return 0
	const I = schema.loreImprints
	const rows = await db
		.update(I)
		.set({ status: "kept" })
		.where(
			and(
				eq(I.subjectKind, at.subjectKind),
				eq(I.subjectId, at.subjectId),
				eq(I.status, "standing"),
				or(inArray(I.field, [...at.fields]), isNull(I.field))
			)
		)
		.returning({ id: I.id })
	return rows.length
}

/**
 * The note's two buttons: **Revert** puts the field back to what it held
 * before the replaced reply wrote it (a row the reply added is removed),
 * **Keep** keeps it as it is and the note goes. Either way the imprint is
 * done with. Whoever may edit the book only (`assertOwnedBook`); the caller
 * asks before calling.
 */
export async function settleKeptImprint(
	db: Db,
	imprintId: number,
	choice: "revert" | "keep"
): Promise<{ lorebookId: number; subject: ImprintSubject; subjectId: number; typeId?: string }> {
	const I = schema.loreImprints
	const [imprint] = (await db
		.select()
		.from(I)
		.where(and(eq(I.id, imprintId), eq(I.status, "kept")))
		.limit(1)) as LoreImprintRow[]
	if (!imprint) throw new Error(KEPT_IMPRINT_REFUSALS.missing)
	const subject = imprint.subjectKind as ImprintSubject
	const access = SUBJECTS[subject]
	const row = await access.row(db, imprint.subjectId)
	if (choice === "revert" && row && access.bookOf(row) === imprint.lorebookId) {
		if (imprint.field != null) await access.write(db, imprint.subjectId, imprint.field, unwrap(imprint.before))
		else {
			await access.remove!(db, imprint.subjectId)
			// What else was filed on the row went with it.
			await db.delete(I).where(and(eq(I.subjectKind, subject), eq(I.subjectId, imprint.subjectId)))
		}
	}
	await db.delete(I).where(eq(I.id, imprint.id))
	return {
		lorebookId: imprint.lorebookId,
		subject,
		subjectId: imprint.subjectId,
		...(subject === "entry" && row ? { typeId: row.typeId as string } : {})
	}
}

/** The book a kept imprint is on, or null — for the caller's access check. */
export async function keptImprintBook(db: Db, imprintId: number): Promise<number | null> {
	const I = schema.loreImprints
	const [row] = await db
		.select({ lorebookId: I.lorebookId })
		.from(I)
		.where(and(eq(I.id, imprintId), eq(I.status, "kept")))
		.limit(1)
	return row?.lorebookId ?? null
}

/** Every imprint of a session, newest first — for a test or an inspector. */
export async function imprintsOf(db: Db, sessionId: number): Promise<LoreImprintRow[]> {
	const I = schema.loreImprints
	return (await db.select().from(I).where(eq(I.sessionId, sessionId)).orderBy(desc(I.id))) as LoreImprintRow[]
}
