/**
 * 🚧 (M2c, path B) **Library writes**: a genre's pipeline makes or changes
 * what is in a person's library — a character, a lorebook, a lorebook read
 * into a session — as the ACTING PERSON, under their consent.
 *
 *  · rights: the person's own (`personMay`), never beyond what a click could;
 *  · consent: their **library write mode** (`user_settings.library_write_mode`,
 *    NULL reads Review) — Off halts, Review holds a `state_proposals` row of
 *    kind `library` for them to Accept or Reject, Full writes now and keeps an
 *    `applied` row so Back can take it back.
 *
 * One pair of functions, `undoLibraryChange` / `redoLibraryChange`, is what
 * Back and Forward use; `revertLibraryChangesAnchoredTo` is
 * `revertClockMovesAnchoredTo`'s twin.
 *
 * ⚠ Every function takes its `db`. Inside a transaction only `tx` may be
 * used — which is why the export a deleted book needs for Forward is made
 * BEFORE the transaction (`exportLibraryBooksAnchoredTo`), and a book is
 * re-imported (Forward) after it.
 */
import { and, desc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { personMay, type ActingPerson } from "$lib/server/auth/actingPerson"

/** 🚧 The four library writes (the outlets' ops). */
// One name each across the app: the op is the ledger's (`shared/state/ledgerLines.ts`), the mode the setting's (`shared/library/libraryWriteMode.ts`).
import type { LibraryOp } from "$lib/shared/state/ledgerLines"
import type { LibraryWriteMode } from "$lib/shared/library/libraryWriteMode"
export type { LibraryOp, LibraryWriteMode }
export const LIBRARY_OPS: readonly LibraryOp[] = [
	"create-character",
	"update-character",
	"create-lorebook",
	"attach-lorebook"
]

/** 🚧 What a person's library write mode can be. NULL reads Review. */

/** The text fields of a card a library write may change (the outlet's names). */
export const CHARACTER_CHANGE_FIELDS = [
	"name",
	"description",
	"personality",
	"scenario",
	"first_mes",
	"mes_example"
] as const
type ChangeField = (typeof CHARACTER_CHANGE_FIELDS)[number]

/** 🚧 The payload of a `library` row in `state_proposals`. */
export interface LibraryChangePayload {
	kind: "library"
	op: LibraryOp
	/** The outlet's ports (attach: `sessionId` always filled in by the host). */
	input: Record<string, unknown>
	/** The person whose library it is. */
	by: number
	/** The card's or book's name, for the ledger. */
	label: string
	result?: { characterId?: number; lorebookId?: number; sessionId?: number }
	/** What an update or an attach replaced. */
	before?: { fields?: Partial<Record<ChangeField, string | null>>; lorebookId?: number | null }
	/** A deleted book's export, for Forward. */
	document?: unknown
	/** 🚧 Why nothing was made (a `skipped` row: the person's library write mode is Off). */
	skipped?: string
}

export const isLibraryChange = (c: unknown): c is LibraryChangePayload =>
	!!c && typeof c === "object" && (c as { kind?: unknown }).kind === "library"

/** A library write refused, as a sentence a person can read. */
export class LibraryWriteRefusal extends Error {}

export const LIBRARY_OFF_SENTENCE =
	"Your library write mode is Off, so nothing is added to your library. You can change it under Settings › User."
export const NOBODY_ACTING_SENTENCE = "Nobody is acting for this run, so nothing is added to a library."

/** A person's library write mode: NULL (never chosen) reads Review. */
export async function libraryWriteModeFor(db: Db, userId: number): Promise<LibraryWriteMode> {
	const [own] = await db
		.select({ mode: schema.userSettings.libraryWriteMode })
		.from(schema.userSettings)
		.where(eq(schema.userSettings.userId, userId))
		.limit(1)
	const mode = own?.mode
	return mode === "full" || mode === "off" ? mode : "review"
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)
const intOf = (v: unknown): number | null => {
	const n = typeof v === "string" && v.trim() ? Number(v) : v
	return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null
}

// ── Reading what the outlet was handed ─────────────────────────────────────

/** The card as the app's card reader takes it: a V3 card, its `data`, or a plain card. */
function cardDataOf(card: unknown): Record<string, unknown> {
	let c: unknown = card
	if (typeof c === "string") {
		try {
			c = JSON.parse(c)
		} catch {
			throw new LibraryWriteRefusal("That is not a character card: it is not JSON.")
		}
	}
	if (!isRecord(c)) throw new LibraryWriteRefusal("A character card is an object with at least a name.")
	const data = isRecord(c.data) ? c.data : c
	const name = typeof data.name === "string" ? data.name.trim() : ""
	if (!name) throw new LibraryWriteRefusal("A character needs a name.")
	// Only the card's text goes in: a drafted card never carries extensions,
	// a uuid or an embedded book into the library.
	const out: Record<string, unknown> = { name, description: typeof data.description === "string" ? data.description : "" }
	for (const k of ["personality", "scenario", "first_mes", "mes_example", "creator_notes"] as const)
		if (typeof data[k] === "string") out[k] = data[k]
	if (Array.isArray(data.tags)) out.tags = data.tags.filter((t): t is string => typeof t === "string")
	return out
}

/** `changes` read whole: only the six text fields, each text, at least one. */
function changesOf(changes: unknown): Partial<Record<ChangeField, string>> {
	if (!isRecord(changes)) throw new LibraryWriteRefusal("The changes are an object of the card's text fields.")
	const out: Partial<Record<ChangeField, string>> = {}
	for (const [k, v] of Object.entries(changes)) {
		if (!(CHARACTER_CHANGE_FIELDS as readonly string[]).includes(k))
			throw new LibraryWriteRefusal(`'${k}' is not a field that can be changed on a character here.`)
		if (typeof v !== "string") throw new LibraryWriteRefusal(`'${k}' is text.`)
		if (k === "name" && !v.trim()) throw new LibraryWriteRefusal("A character needs a name.")
		out[k as ChangeField] = v
	}
	if (!Object.keys(out).length) throw new LibraryWriteRefusal("That changes nothing.")
	return out
}

const START = "<START>"
/** The card's fields as columns (`mes_example` is the column's list, joined as the card export joins it). */
function columnsOf(fields: Partial<Record<ChangeField, string | null>>) {
	const set: Record<string, unknown> = {}
	if (fields.name != null) set.name = fields.name
	if (fields.description != null) set.description = fields.description
	if (fields.personality !== undefined) set.personality = fields.personality
	if (fields.scenario !== undefined) set.scenario = fields.scenario
	if (fields.first_mes !== undefined) set.firstMessage = fields.first_mes
	if (fields.mes_example !== undefined)
		set.exampleDialogues = fields.mes_example ? fields.mes_example.split(START) : []
	return set
}

/** Write text fields onto a card — the strokes rule, and a stale embedding cleared when its text moved. */
async function writeCardFields(
	db: Db,
	characterId: number,
	fields: Partial<Record<ChangeField, string | null>>
): Promise<string> {
	const [stored] = await db
		.select({ name: schema.characters.name, description: schema.characters.description })
		.from(schema.characters)
		.where(eq(schema.characters.id, characterId))
		.limit(1)
	if (!stored) throw new LibraryWriteRefusal("Character not found.")
	const { applyStrokesToCard } = await import("$lib/server/characters/strokes")
	const set = applyStrokesToCard(columnsOf(fields) as any) as Record<string, unknown>
	const movesText =
		(typeof fields.name === "string" && fields.name !== stored.name) ||
		(typeof fields.description === "string" && fields.description !== stored.description)
	await db
		.update(schema.characters)
		.set({
			...set,
			updatedAt: new Date(),
			...(movesText ? { embedding: null, embeddingModel: null, embeddingSourceHash: null, vectorizedAt: null } : {})
		})
		.where(eq(schema.characters.id, characterId))
	return typeof fields.name === "string" ? fields.name : stored.name
}

/** The after-effects of a card's text moving, outside any transaction. */
async function afterCardWrite(characterId: number, name: string): Promise<void> {
	const { syncLorebookBindingsForCharacter } = await import("$lib/server/utils/characterBindingSync")
	const { autoEnqueueCharacter } = await import("$lib/server/embedding/vectorizationQueue")
	await syncLorebookBindingsForCharacter(characterId).catch(console.error)
	autoEnqueueCharacter(characterId, name).catch(console.error)
}

/** A card's six fields as they stand, in the outlet's names. */
async function cardFieldsOf(db: Db, characterId: number, names: readonly ChangeField[]) {
	const [c] = await db
		.select()
		.from(schema.characters)
		.where(eq(schema.characters.id, characterId))
		.limit(1)
	if (!c) throw new LibraryWriteRefusal("Character not found.")
	const all: Record<ChangeField, string | null> = {
		name: c.name,
		description: c.description,
		personality: c.personality ?? null,
		scenario: c.scenario ?? null,
		first_mes: c.firstMessage ?? null,
		mes_example: Array.isArray(c.exampleDialogues) ? c.exampleDialogues.join(START) : null
	}
	return Object.fromEntries(names.map((n) => [n, all[n]])) as Partial<Record<ChangeField, string | null>>
}

// ── The session's book (the one line path `sessions:update` uses) ──────────

/** Point a session at a book (or none) through `sessionLinePatch`, as `sessions:update` does. */
async function setSessionBook(db: Db, sessionId: number, lorebookId: number | null): Promise<void> {
	const [before] = await db
		.select({
			id: schema.sessions.id,
			name: schema.sessions.name,
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!before) throw new LibraryWriteRefusal("Session not found.")
	const { sessionLinePatch } = await import("$lib/server/sockets/sessions")
	try {
		await db.transaction(async (tx) => {
			const patch = await sessionLinePatch(tx as unknown as Db, {
				before: { lorebookId: before.lorebookId, lorebookBranchId: before.lorebookBranchId },
				session: { id: before.id, name: before.name },
				lorebookId
			})
			await tx
				.update(schema.sessions)
				.set({ ...patch, lorebookId, updatedAt: new Date() })
				.where(eq(schema.sessions.id, sessionId))
		})
	} catch (e) {
		throw new LibraryWriteRefusal(e instanceof Error ? e.message : String(e))
	}
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	await ownBookFor(db, sessionId)
}

/** The text a lorebook document is handed over as. */
const documentText = (raw: unknown): string => {
	if (raw == null || (typeof raw !== "object" && typeof raw !== "string"))
		throw new LibraryWriteRefusal("A lorebook is a document, as Lorebooks › Import reads it.")
	return typeof raw === "string" ? raw : JSON.stringify(raw)
}

/**
 * Check one library change WITHOUT making it — its input read whole and the
 * person's rights asked — and name it for the ledger. Review holds a change
 * only after this, so a pending row is one the person could accept.
 * Throws `LibraryWriteRefusal` with a sentence.
 */
export async function describeLibraryChange(
	db: Db,
	person: ActingPerson,
	op: LibraryOp,
	input: Record<string, unknown>
): Promise<{ label: string }> {
	switch (op) {
		case "create-character":
			return { label: String(cardDataOf(input.card).name) }
		case "update-character": {
			const id = intOf(input.characterId)
			if (id === null) throw new LibraryWriteRefusal("That names no character.")
			changesOf(input.changes)
			const may = await personMay(db, person, "write", { kind: "character", id })
			if (!may.ok) throw new LibraryWriteRefusal(may.reason)
			const [c] = await db
				.select({ name: schema.characters.name })
				.from(schema.characters)
				.where(and(eq(schema.characters.id, id), eq(schema.characters.isDeleted, false)))
				.limit(1)
			if (!c) throw new LibraryWriteRefusal("Character not found.")
			return { label: c.name }
		}
		case "create-lorebook": {
			const { readLorebookImport } = await import("$lib/server/sockets/lorebooks")
			try {
				const { card, lorebookData } = readLorebookImport(documentText(input.lorebook))
				return { label: String(card?.name ?? lorebookData?.name ?? "").trim() || "Untitled lorebook" }
			} catch (e) {
				if (e instanceof LibraryWriteRefusal) throw e
				throw new LibraryWriteRefusal(e instanceof Error ? e.message : String(e))
			}
		}
		case "attach-lorebook": {
			const lorebookId = intOf(input.lorebookId)
			const sessionId = intOf(input.sessionId)
			if (lorebookId === null) throw new LibraryWriteRefusal("That names no lorebook.")
			if (sessionId === null) throw new LibraryWriteRefusal("That names no session to read it into.")
			const readable = await personMay(db, person, "read", { kind: "lorebook", id: lorebookId })
			if (!readable.ok) throw new LibraryWriteRefusal(readable.reason)
			const writable = await personMay(db, person, "write", { kind: "session", id: sessionId })
			if (!writable.ok) throw new LibraryWriteRefusal(writable.reason)
			const [book] = await db
				.select({ name: schema.lorebooks.name, sessionId: schema.lorebooks.sessionId, kind: schema.lorebooks.kind })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, lorebookId))
				.limit(1)
			if (!book || book.sessionId != null || book.kind !== "book") throw new LibraryWriteRefusal("Lorebook not found.")
			return { label: book.name }
		}
	}
}

// ── Apply ──────────────────────────────────────────────────────────────────

export interface LibraryApplied {
	label: string
	result: NonNullable<LibraryChangePayload["result"]>
	before?: LibraryChangePayload["before"]
}

/**
 * Make one library change as `person`: their rights (`personMay`), then the
 * app's own writer for it. Throws `LibraryWriteRefusal` with a sentence.
 * Not a transaction: the writers it reaches take their own.
 */
export async function applyLibraryChange(
	db: Db,
	person: ActingPerson,
	op: LibraryOp,
	input: Record<string, unknown>
): Promise<LibraryApplied> {
	switch (op) {
		case "create-character": {
			const data = cardDataOf(input.card)
			const { createCharacterFromParsedData } = await import("$lib/server/sockets/characters")
			// it answers the character row itself (after its avatar and tags)
			const character = await createCharacterFromParsedData(data, undefined, person.userId, db)
			return { label: String(character.name), result: { characterId: character.id } }
		}
		case "update-character": {
			const id = intOf(input.characterId)
			if (id === null) throw new LibraryWriteRefusal("That names no character.")
			const changes = changesOf(input.changes)
			const may = await personMay(db, person, "write", { kind: "character", id })
			if (!may.ok) throw new LibraryWriteRefusal(may.reason)
			const [live] = await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(and(eq(schema.characters.id, id), eq(schema.characters.isDeleted, false)))
				.limit(1)
			if (!live) throw new LibraryWriteRefusal("Character not found.")
			const before = await cardFieldsOf(db, id, Object.keys(changes) as ChangeField[])
			const name = await writeCardFields(db, id, changes)
			await afterCardWrite(id, name)
			return { label: name, result: { characterId: id }, before: { fields: before } }
		}
		case "create-lorebook": {
			const text = documentText(input.lorebook)
			const { importLorebookDocument } = await import("$lib/server/sockets/lorebooks")
			try {
				const { book } = await importLorebookDocument(person.userId, text)
				return { label: book.name, result: { lorebookId: book.id } }
			} catch (e) {
				throw new LibraryWriteRefusal(e instanceof Error ? e.message : String(e))
			}
		}
		case "attach-lorebook": {
			const lorebookId = intOf(input.lorebookId)
			const sessionId = intOf(input.sessionId)
			if (lorebookId === null) throw new LibraryWriteRefusal("That names no lorebook.")
			if (sessionId === null) throw new LibraryWriteRefusal("That names no session to read it into.")
			const readable = await personMay(db, person, "read", { kind: "lorebook", id: lorebookId })
			if (!readable.ok) throw new LibraryWriteRefusal(readable.reason)
			const writable = await personMay(db, person, "write", { kind: "session", id: sessionId })
			if (!writable.ok) throw new LibraryWriteRefusal(writable.reason)
			// A session's own notes and a starter lorebook are never read into a session.
			const [book] = await db
				.select({ name: schema.lorebooks.name, sessionId: schema.lorebooks.sessionId, kind: schema.lorebooks.kind })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, lorebookId))
				.limit(1)
			if (!book || book.sessionId != null || book.kind !== "book") throw new LibraryWriteRefusal("Lorebook not found.")
			const [session] = await db
				.select({ lorebookId: schema.sessions.lorebookId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
				.limit(1)
			await setSessionBook(db, sessionId, lorebookId)
			return {
				label: book.name,
				result: { lorebookId, sessionId },
				before: { lorebookId: session?.lorebookId ?? null }
			}
		}
	}
}

// ── Recording ──────────────────────────────────────────────────────────────

/**
 * File a library change in the session's ledger: `pending` (Review) or
 * `applied` (Full), anchored where the world's changes are, so Back and a
 * swipe take it back with the reply that made it. Returns the row's id.
 */
export async function fileLibraryChange(
	db: Db,
	ctx: { sessionId: number; updatedBy: string },
	payload: LibraryChangePayload,
	status: "pending" | "applied" | "skipped"
): Promise<number> {
	const { anchorFor } = await import("$lib/server/state/write")
	const { stateVersionOf } = await import("$lib/server/state/resolve")
	const anchor = await anchorFor(db, ctx, { kind: "session", id: ctx.sessionId })
	const [row] = await db
		.insert(schema.stateProposals)
		.values({
			sessionId: ctx.sessionId,
			messageId: anchor,
			kind: "library",
			payload: payload as unknown as Record<string, unknown>,
			status,
			proposedBy: ctx.updatedBy,
			baseVersion: await stateVersionOf(db, ctx.sessionId),
			...(status === "pending" ? {} : { decidedAt: new Date() })
		})
		.returning({ id: schema.stateProposals.id })
	return row!.id
}

// ── Back and Forward ───────────────────────────────────────────────────────

type Row = typeof schema.stateProposals.$inferSelect

async function writePayload(db: Db, row: Row, payload: LibraryChangePayload): Promise<void> {
	await db
		.update(schema.stateProposals)
		.set({ payload: payload as unknown as Record<string, unknown> })
		.where(eq(schema.stateProposals.id, row.id))
	row.payload = payload as unknown as Row["payload"]
}

/**
 * Take one applied or accepted library change back: a made character is
 * hidden (`is_deleted`), an updated one gets its fields back, an attached
 * book comes off the session (only while it is still the one attached), a
 * made lorebook is deleted (its export, `payload.document`, was kept for
 * Forward — see `exportLibraryBooksAnchoredTo`). Writes what it learned onto
 * the row's payload. Hand it the `tx` inside a transaction.
 */
export async function undoLibraryChange(db: Db, row: Row): Promise<void> {
	const p = row.payload as unknown as LibraryChangePayload
	if (!isLibraryChange(p)) return
	switch (p.op) {
		case "create-character": {
			const id = p.result?.characterId
			if (id != null) await db.update(schema.characters).set({ isDeleted: true }).where(eq(schema.characters.id, id))
			return
		}
		case "update-character": {
			const id = p.result?.characterId
			// No `afterCardWrite` here: it reads through the module handle, which a
			// transaction would deadlock. The write clears a stale embedding itself.
			if (id != null && p.before?.fields) await writeCardFields(db, id, p.before.fields)
			return
		}
		case "attach-lorebook": {
			const { lorebookId, sessionId } = p.result ?? {}
			if (lorebookId == null || sessionId == null) return
			const [s] = await db
				.select({ lorebookId: schema.sessions.lorebookId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
				.limit(1)
			if (s?.lorebookId === lorebookId) await setSessionBook(db, sessionId, p.before?.lorebookId ?? null)
			return
		}
		case "create-lorebook": {
			const id = p.result?.lorebookId
			if (id == null) return
			// Without its export Forward could not bring the book back: it stays.
			if (!p.document) {
				console.warn("[library] a made lorebook was not exported, so Back leaves it in the library:", id)
				return
			}
			const { purgeLorebook } = await import("$lib/server/lorebooks/tableRegistry")
			await purgeLorebook(db, id)
			await db.delete(schema.lorebooks).where(eq(schema.lorebooks.id, id))
			return
		}
	}
}

/**
 * Put one library change back (Forward): a hidden character shown again, the
 * changes written again, the book attached again, the book re-imported from
 * its export as `by` (a new id, written back to `result.lorebookId`).
 * `remap`: books re-imported earlier in the same Forward, old id → new.
 * Call it OUTSIDE a transaction — the book's importer takes the module handle.
 */
export async function redoLibraryChange(
	db: Db,
	row: Row,
	remap: Map<number, number> = new Map()
): Promise<void> {
	const p = row.payload as unknown as LibraryChangePayload
	if (!isLibraryChange(p)) return
	switch (p.op) {
		case "create-character": {
			const id = p.result?.characterId
			if (id != null) await db.update(schema.characters).set({ isDeleted: false }).where(eq(schema.characters.id, id))
			return
		}
		case "update-character": {
			const id = p.result?.characterId
			if (id == null) return
			const name = await writeCardFields(db, id, changesOf(p.input.changes))
			await afterCardWrite(id, name)
			return
		}
		case "attach-lorebook": {
			const { lorebookId, sessionId } = p.result ?? {}
			if (lorebookId == null || sessionId == null) return
			const now = remap.get(lorebookId) ?? lorebookId
			const [b] = await db
				.select({ id: schema.lorebooks.id })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, now))
				.limit(1)
			if (b) await setSessionBook(db, sessionId, now)
			return
		}
		case "create-lorebook": {
			const old = p.result?.lorebookId
			if (!p.document) return
			const { importLorebookDocument } = await import("$lib/server/sockets/lorebooks")
			const { book } = await importLorebookDocument(p.by, JSON.stringify(p.document))
			if (old != null) remap.set(old, book.id)
			await writePayload(db, row, { ...p, result: { ...p.result, lorebookId: book.id } })
			return
		}
	}
}

/** Redo a batch of rows, oldest first, each only if it was applied or accepted; one failing is reported, not fatal. */
export async function redoLibraryChanges(db: Db, rows: readonly Row[]): Promise<void> {
	const remap = new Map<number, number>()
	for (const row of [...rows].sort((a, b) => a.id - b.id)) {
		if (row.kind !== "library" || (row.status !== "applied" && row.status !== "accepted")) continue
		try {
			await redoLibraryChange(db, row, remap)
		} catch (e) {
			console.warn("[library] a library change could not be put back:", e)
		}
	}
}

/** The library rows in force (applied or accepted) anchored to these messages, newest first. */
async function changesInForce(db: Db, messageIds: readonly number[]): Promise<Row[]> {
	if (!messageIds.length) return []
	return await db
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.kind, "library"),
				inArray(schema.stateProposals.status, ["applied", "accepted"]),
				inArray(schema.stateProposals.messageId, messageIds as number[])
			)
		)
		.orderBy(desc(schema.stateProposals.id))
}

/**
 * Export the lorebooks that library changes anchored to these messages made,
 * onto their rows, BEFORE the retraction's transaction (the exporter reads
 * through the module handle, which a transaction would deadlock). Pass the
 * outer `db`.
 */
export async function exportLibraryBooksAnchoredTo(db: Db, messageIds: readonly number[]): Promise<void> {
	const rows = (await changesInForce(db, messageIds)).filter(
		(r) => (r.payload as unknown as LibraryChangePayload).op === "create-lorebook"
	)
	if (!rows.length) return
	const { buildLorebookExportData } = await import("$lib/server/utils/lorebookExportBuilder")
	for (const row of rows) {
		const p = row.payload as unknown as LibraryChangePayload
		const id = p.result?.lorebookId
		if (id == null) continue
		try {
			const { specBookWithGraph } = await buildLorebookExportData(id, p.by)
			await writePayload(db, row, { ...p, document: specBookWithGraph })
		} catch (e) {
			console.warn("[library] a made lorebook could not be exported before Back:", e)
		}
	}
}

/**
 * Take back the library changes anchored to these messages — newest first —
 * before their rows go, as `revertClockMovesAnchoredTo` does the clock's.
 * Each row's payload keeps what it learned (the export of a deleted book), so
 * the rows the retraction takes carry it to Forward. A change that cannot be
 * taken back (the card is gone already) is reported and skipped.
 * Returns whether anything was taken back.
 */
export async function revertLibraryChangesAnchoredTo(
	t: Db,
	messageIds: readonly number[]
): Promise<{ changed: boolean }> {
	const rows = await changesInForce(t, messageIds)
	let changed = false
	for (const row of rows) {
		try {
			await undoLibraryChange(t, row)
			changed = true
		} catch (e) {
			console.warn("[library] a library change could not be taken back:", e)
		}
	}
	return { changed }
}
