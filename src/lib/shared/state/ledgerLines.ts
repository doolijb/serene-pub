/**
 * The transcript ledger: anchored rows, read as what a message changed.
 *
 * ## Why this is a reading and not a store
 *
 * Every value — an inventory too, since phase 3b — is a row anchored to the message that wrote
 * it, and the row in force is a question of ordering. So "hp 20 → 14" is not
 * stored anywhere: it is this row and the one before it, put side by side. That
 * is also what makes the ledger revertible with the message — delete the
 * message and its rows go, and the lines derived from them go with it.
 *
 * ## Absent is not zero, here as everywhere
 *
 * A change with nothing before it reads `hp → 14` rather than inventing a
 * left-hand side. `baselines` is what the session INHERITED — the world's or the
 * card's answer — and it is supplied per owner and slot, so one character's
 * starting health is never read as another's.
 */
import type { SlotValue } from "@serene-pub/sdk"
// Moved to core (R21): the state widgets and this ledger read one formatter.
import { formatSlotValue } from "@serene-pub/core-catalog/session-state"

/**
 * What a value row carries, which is the SDK's `SlotValue` and not a copy of
 * it: a `list` slot's row is an array, and a ledger that could not hold one
 * would be a line the transcript quietly dropped.
 */
export type LedgerValue = SlotValue

/** One anchored row. The wire shape (`Sockets.State.LedgerRow`), structurally. */
export interface LedgerRow {
	id: number
	kind: "value"
	messageId: number | null
	ownerKey: string
	ownerLabel: string
	updatedBy: string
	slotId?: string
	slotLabel?: string
	value?: LedgerValue
}

/** What one slot read for one owner before the session touched it. */
export interface LedgerBaseline {
	ownerKey: string
	slotId: string
	value: LedgerValue
}

export interface LedgerLine {
	/** Stable per row, so a keyed list never re-mounts a line that did not move. */
	key: string
	messageId: number | null
	ownerKey: string
	ownerLabel: string
	kind: "value"
	/** The change without the owner's name: `hp 20 → 14`, `Inventory → Rusty key ×2`. */
	text: string
	before?: LedgerValue
	after?: LedgerValue
	updatedBy: string
}

/** Rows in the order they landed: by anchor, then by the row's own id. */
const inOrder = (rows: LedgerRow[]): LedgerRow[] =>
	[...rows].sort(
		(a, b) => (a.messageId ?? -1) - (b.messageId ?? -1) || a.id - b.id
	)

const valueText = (
	label: string,
	before: LedgerValue | undefined,
	after: LedgerValue
): string =>
	before === undefined || before === null
		? `${label} → ${formatSlotValue(after)}`
		: `${label} ${formatSlotValue(before)} → ${formatSlotValue(after)}`

/**
 * The lines these rows describe, oldest first.
 *
 * Each row is one line, including two rows for the same slot on one message:
 * both are real rows, and collapsing them would hide a step somebody took.
 */
export function ledgerLines(
	rows: LedgerRow[],
	baselines: LedgerBaseline[] = []
): LedgerLine[] {
	const seen = new Map<string, LedgerValue>()
	for (const b of baselines) seen.set(`v:${b.ownerKey}:${b.slotId}`, b.value)

	const out: LedgerLine[] = []
	for (const row of inOrder(rows)) {
		const trail = `v:${row.ownerKey}:${row.slotId ?? ""}`
		const before = seen.get(trail)
		const after = (row.value ?? null) as LedgerValue
		out.push({
			key: `v${row.id}`,
			messageId: row.messageId,
			ownerKey: row.ownerKey,
			ownerLabel: row.ownerLabel,
			kind: "value",
			text: valueText(row.slotLabel ?? "", before, after),
			before,
			after,
			updatedBy: row.updatedBy
		})
		seen.set(trail, after)
	}
	return out
}

/**
 * Lines indexed by the message they are anchored to.
 *
 * A line anchored to no message is in no message's ledger: it is state that was
 * true before anything was said, and the transcript has nowhere honest to hang
 * it.
 */
export function linesByMessage(lines: LedgerLine[]): Map<number, LedgerLine[]> {
	const out = new Map<number, LedgerLine[]>()
	for (const line of lines) {
		if (line.messageId == null) continue
		out.set(line.messageId, [...(out.get(line.messageId) ?? []), line])
	}
	return out
}

export interface LedgerOwnerGroup {
	ownerKey: string
	ownerLabel: string
	lines: LedgerLine[]
}

/** One run of lines per owner, in the order each owner first appears. */
export function groupLinesByOwner(lines: LedgerLine[]): LedgerOwnerGroup[] {
	const out: LedgerOwnerGroup[] = []
	for (const line of lines) {
		const group = out.find((g) => g.ownerKey === line.ownerKey)
		if (group) group.lines.push(line)
		else
			out.push({
				ownerKey: line.ownerKey,
				ownerLabel: line.ownerLabel,
				lines: [line]
			})
	}
	return out
}

/** A held change, as `state:proposals` publishes it. */
export interface ProposalLike {
	kind: "value"
	payload: Record<string, unknown>
}

/** How a surface names the parts of a payload; each may decline to know. */
export interface ProposalNames {
	ownerLabel?: (owner: { kind: string; id: number }) => string | undefined
	slotLabel?: (slotId: string) => string | undefined
	itemName?: (entryId: number) => string | undefined
}

/**
 * A proposal in the ledger's own vocabulary, in the future tense the gate needs:
 * it says what WOULD happen, because nothing has.
 *
 * A payload this session cannot name says so rather than rendering a blank with
 * two buttons under it — accepting a change you cannot read is the one thing the
 * gate exists to prevent.
 */
export function describeProposal(
	proposal: ProposalLike,
	names: ProposalNames
): string {
	const payload = proposal.payload ?? {}
	const owner = payload.owner as { kind: string; id: number } | undefined
	const who = owner ? names.ownerLabel?.(owner) : undefined
	const prefix = who ? `${who} ` : ""

	const slotId = typeof payload.slotId === "string" ? payload.slotId : ""
	if (!slotId) return "a change this session cannot describe"
	const label = names.slotLabel?.(slotId) ?? slotId
	// A list change (an item moving, since phase 3b) says what goes in or
	// comes out, never the whole list it would leave.
	const op = payload.op
	if ((op === "add" || op === "remove") && Array.isArray(payload.items)) {
		const sign = op === "add" ? "+" : "-"
		const items = (payload.items as unknown[]).map((item) => {
			if (item && typeof item === "object" && typeof (item as { entryId?: unknown }).entryId === "number") {
				const ref = item as { entryId: number; count?: number; name?: string }
				const name = names.itemName?.(ref.entryId) ?? ref.name ?? "an item"
				return `${sign}${name}${(ref.count ?? 1) > 1 ? ` ×${ref.count}` : ""}`
			}
			return `${sign}${String(item)}`
		})
		return `${prefix}${label} ${items.join(", ")}`
	}
	return `${prefix}${label} → ${formatSlotValue(namedValue(payload.value as LedgerValue, names))}`
}

/**
 * A value with every lore reference given its title — the surface's name when
 * it has one, else the one the host filled in on the way out — so a place or an
 * item reads as the widget reads it, never `entry N`. A copy; the payload is
 * the row's.
 */
function namedValue(value: LedgerValue, names: ProposalNames): LedgerValue {
	const named = (item: unknown): unknown => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return item
		const ref = item as { entryId?: unknown; name?: string }
		if (typeof ref.entryId !== "number") return item
		const name = names.itemName?.(ref.entryId) ?? ref.name
		return name ? { ...ref, name } : item
	}
	return (Array.isArray(value) ? value.map(named) : named(value)) as LedgerValue
}
