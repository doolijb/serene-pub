/**
 * The transcript ledger: anchored rows, read as what a message changed.
 *
 * ## Why this is a reading and not a store
 *
 * Every value and every possession is a row anchored to the message that wrote
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
import { formatSlotValue } from "./barMath"

/**
 * What a value row carries, which is the SDK's `SlotValue` and not a copy of
 * it: a `list` slot's row is an array, and a ledger that could not hold one
 * would be a line the transcript quietly dropped.
 */
export type LedgerValue = SlotValue

/** One anchored row. The wire shape (`Sockets.State.LedgerRow`), structurally. */
export interface LedgerRow {
	id: number
	kind: "value" | "possession"
	messageId: number | null
	ownerKey: string
	ownerLabel: string
	updatedBy: string
	/** Value rows. */
	slotId?: string
	slotLabel?: string
	value?: LedgerValue
	/** Possession rows. */
	entryId?: number
	itemName?: string
	/** How many this row leaves the owner holding. */
	quantity?: number
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
	kind: "value" | "possession"
	/** The change without the owner's name: `hp 20 → 14`, `+rusty key`. */
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
 * A possession is a quantity, so the line says which of three things happened:
 * it arrived, it left, or there is a different number of it.
 */
function possessionText(name: string, before: number, after: number): string {
	if (before <= 0 && after > 0)
		return after > 1 ? `+${name} ×${after}` : `+${name}`
	if (after <= 0) return `-${name}`
	return `${name} ×${before} → ×${after}`
}

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
	const seen = new Map<string, LedgerValue | number>()
	for (const b of baselines) seen.set(`v:${b.ownerKey}:${b.slotId}`, b.value)

	const out: LedgerLine[] = []
	for (const row of inOrder(rows)) {
		if (row.kind === "value") {
			const trail = `v:${row.ownerKey}:${row.slotId ?? ""}`
			const before = seen.get(trail) as LedgerValue | undefined
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
			continue
		}
		const trail = `p:${row.ownerKey}:${row.entryId ?? 0}`
		const before = (seen.get(trail) as number | undefined) ?? 0
		const after = row.quantity ?? 0
		out.push({
			key: `p${row.id}`,
			messageId: row.messageId,
			ownerKey: row.ownerKey,
			ownerLabel: row.ownerLabel,
			kind: "possession",
			text: possessionText(row.itemName ?? "", before, after),
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
	kind: "value" | "possession"
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

	if (proposal.kind === "value") {
		const slotId = typeof payload.slotId === "string" ? payload.slotId : ""
		if (!slotId) return "a change this session cannot describe"
		const label = names.slotLabel?.(slotId) ?? slotId
		return `${prefix}${label} → ${formatSlotValue(payload.value as LedgerValue)}`
	}

	const entryId = typeof payload.entryId === "number" ? payload.entryId : 0
	if (!entryId) return "a change this session cannot describe"
	const name = names.itemName?.(entryId) ?? "an item"
	const delta = typeof payload.delta === "number" ? payload.delta : 0
	if (delta < 0)
		return `${prefix}-${name}${delta < -1 ? ` ×${Math.abs(delta)}` : ""}`
	return `${prefix}+${name}${delta > 1 ? ` ×${delta}` : ""}`
}
