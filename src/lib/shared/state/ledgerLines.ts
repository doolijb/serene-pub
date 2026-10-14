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
import { clockSpanWords } from "$lib/shared/lorebooks/storyDate"

/**
 * What a value row carries, which is the SDK's `SlotValue` and not a copy of
 * it: a `list` slot's row is an array, and a ledger that could not hold one
 * would be a line the transcript quietly dropped.
 */
export type LedgerValue = SlotValue

/** One anchored row. The wire shape (`Sockets.State.LedgerRow`), structurally. */
export interface LedgerRow {
	id: number
	/** 🚧 `clock`: a move of the session's story clock (live scenes §15 G5). */
	kind: "value" | "clock"
	messageId: number | null
	ownerKey: string
	ownerLabel: string
	updatedBy: string
	slotId?: string
	slotLabel?: string
	value?: LedgerValue
	clock?: LedgerClockMove
}

/** 🚧 A clock row's move: the step, and where the clock went — or why it did not. */
export interface LedgerClockMove {
	by: number
	unit: string
	cause?: "action" | "keeper" | "tick" | null
	fromLabel?: string | null
	toLabel?: string | null
	skipped?: string | null
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
	kind: "value" | "clock"
	/**
	 * The change without the owner's name: `hp 20 → 14`, `Inventory → Rusty key ×2`,
	 * 🚧 `Time passes: 3 hours (Day 4, 14:00 → Day 4, 17:00)`.
	 */
	text: string
	before?: LedgerValue
	after?: LedgerValue
	updatedBy: string
}

/**
 * Rows in the order they landed: by anchor, then by the row's own id — a
 * message's clock moves after its values, since the two count their ids in
 * different tables.
 */
const inOrder = (rows: LedgerRow[]): LedgerRow[] =>
	[...rows].sort(
		(a, b) =>
			(a.messageId ?? -1) - (b.messageId ?? -1) ||
			Number(a.kind === "clock") - Number(b.kind === "clock") ||
			a.id - b.id
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
		if (row.kind === "clock") {
			if (!row.clock) continue
			out.push({
				key: `c${row.id}`,
				messageId: row.messageId,
				ownerKey: row.ownerKey,
				ownerLabel: row.ownerLabel,
				kind: "clock",
				text: clockMoveText(row.clock),
				updatedBy: row.updatedBy
			})
			continue
		}
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
 * 🚧 A clock move's line (live scenes §15 G5): "Time passes: 3 hours (Day 4,
 * 14:00 → Day 4, 17:00)", "Time goes back: 1 day (…)", or — a move the
 * story had no clock for (G7) — the step and why it did not happen.
 */
export function clockMoveText(move: LedgerClockMove): string {
	const span = clockSpanWords(move.by, move.unit)
	const head = move.by < 0 ? `Time goes back: ${span}` : `Time passes: ${span}`
	if (move.skipped) return `${head}, not on the clock. ${move.skipped}`
	return move.fromLabel && move.toLabel
		? `${head} (${move.fromLabel} → ${move.toLabel})`
		: head
}

/**
 * Lines indexed by the message they are anchored to.
 *
 * A line anchored to no message is in no message's ledger: it is state that was
 * true before anything was said, and the transcript has nowhere honest to hang
 * it. 🚧 Except a clock move (`ledgerHeadLines`): time a person moved before
 * anything was said is the conversation's **ledger head**.
 */
export function linesByMessage(lines: LedgerLine[]): Map<number, LedgerLine[]> {
	const out = new Map<number, LedgerLine[]>()
	for (const line of lines) {
		if (line.messageId == null) continue
		out.set(line.messageId, [...(out.get(line.messageId) ?? []), line])
	}
	return out
}

/**
 * 🚧 The conversation's **ledger head** (live scenes §15 G13): the clock moves
 * anchored to no message — a *Time passes…* pressed, or a reply's tick skipped,
 * before the session had a single line (once it has one, even a greeting, a
 * move files under its newest). Drawn above the first message: they happened
 * before anything was said, and `inOrder` already sorts them first. Values
 * anchored to no message stay out — a never-spoken character's change waits
 * for their first line, and a world value set before anything was said is the
 * session's starting state, not an event.
 */
export function ledgerHeadLines(lines: LedgerLine[]): LedgerLine[] {
	return lines.filter((line) => line.messageId == null && line.kind === "clock")
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

/** A held change, as `state:proposals` publishes it. 🚧 `clock`: a clock proposal (live scenes ★3). */
export interface ProposalLike {
	kind: "value" | "clock"
	payload: Record<string, unknown>
}

/**
 * 🚧 A **clock proposal**'s line (live scenes §6, ★3): what accepting it
 * would do to the session's story clock — "Time passes: 3 hours". Null when
 * the payload is not one.
 */
export function describeClockProposal(proposal: ProposalLike): string | null {
	const payload = proposal.payload ?? {}
	if (proposal.kind !== "clock" && payload.kind !== "clock") return null
	const by = payload.by
	const unit = typeof payload.unit === "string" ? payload.unit : ""
	if (typeof by !== "number" || !Number.isInteger(by) || by <= 0 || !unit)
		return "a clock move this session cannot describe"
	return `Time passes: ${clockSpanWords(by, unit)}`
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
	const clock = describeClockProposal(proposal)
	if (clock !== null) return clock
	const payload = proposal.payload ?? {}
	const owner = payload.owner as { kind: string; id: number } | undefined
	// A change to the book comes named by the server (`ownerLabel`, plan A22):
	// the session's own owners are all a surface can name.
	const who = owner
		? (names.ownerLabel?.(owner) ??
			(typeof payload.ownerLabel === "string" ? payload.ownerLabel : undefined))
		: undefined
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
