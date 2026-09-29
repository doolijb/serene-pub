/**
 * 🚧 `set-attribute-value` (R21): a core state widget sets one owner's value
 * for one slot, at the session layer — the viewer's own edit, applied at once
 * through the page's state store (`state:set`), exactly as the page's own
 * edits write. Core's widgets only (the askers table, `./askers.ts`).
 *
 * What this answer adds over the store's own write:
 *  - an owner outside the session layers is refused here: a widget writes
 *    the SESSION's deviation (the world's, or a cast member's), never the
 *    card, the cast link or the book the session inherits from;
 *  - the owner must be one of THIS session's, and carry the slot;
 *  - the refusal is the asking widget's own (R77): the write owns its error,
 *    so it rejects this request and never appears in the store-wide error
 *    every state widget shows.
 *
 * Resolves once written; the new value arrives as a `session_state` push,
 * never in the reply.
 */
import { isSlotLoreRef, type WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["set-attribute-value"]["params"]
type Value = Params["value"]

/** The session layers a widget may write — the world's, a cast member's and 🚧 a place's (phase 4). */
const SESSION_LAYERS = new Set(["session", "session_cast", "session_location"])

/** What this answer needs of the page's state store (`SessionStateHandle`). */
export interface AttributeWriter {
	readonly sessionId: number | null
	readonly loaded: boolean
	readonly owners: { values(): Iterable<Sockets.State.StateOwnerRow> }
	set(
		owner: Sockets.State.Owner,
		slotId: string,
		value: Value,
		opts?: { ownError?: boolean }
	): Promise<void>
}

const isScalar = (v: unknown): boolean =>
	v === null ||
	typeof v === "string" ||
	typeof v === "boolean" ||
	(typeof v === "number" && Number.isFinite(v))

/** A scalar, or a list written whole — its items words or lore references (`{ entryId }`). */
const isValue = (v: unknown): v is Value =>
	isScalar(v) ||
	(Array.isArray(v) && v.every((item) => isScalar(item) || isSlotLoreRef(item)))

/**
 * Answer one `set-attribute-value` for the page's session `sessionId`.
 * Rejects, in words, with anything a widget could have got wrong.
 */
export async function answerSetAttributeValue(
	params: unknown,
	store: AttributeWriter,
	sessionId: number | null
): Promise<void> {
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	const owner = p.owner as { kind?: unknown; id?: unknown } | undefined
	if (!owner || typeof owner !== "object" || typeof owner.kind !== "string")
		throw new Error("set-attribute-value needs an owner")
	if (!SESSION_LAYERS.has(owner.kind))
		throw new Error(
			`set-attribute-value writes at the session layer only — '${owner.kind}' is not the session, one of its cast or one of its places`
		)
	if (typeof owner.id !== "number" || !Number.isInteger(owner.id))
		throw new Error("set-attribute-value needs the owner's id")
	if (typeof p.slotId !== "string" || !p.slotId) throw new Error("set-attribute-value needs a slotId")
	if (!isValue(p.value))
		throw new Error("set-attribute-value takes a number, text, true/false, a list of items, or null to clear")
	if (sessionId == null || store.sessionId !== sessionId || !store.loaded)
		throw new Error("this session's stats have not loaded yet")
	const row = [...store.owners.values()].find((o) => o.kind === owner.kind && o.id === owner.id)
	if (!row) throw new Error("that owner is not in this session")
	if (!Object.hasOwn(row.configs ?? {}, p.slotId))
		throw new Error(`'${p.slotId}' is not a slot ${row.label} carries`)
	await store.set({ kind: owner.kind as "session" | "session_cast" | "session_location", id: owner.id }, p.slotId, p.value, {
		ownError: true
	})
}
