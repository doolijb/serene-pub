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
import {
	choiceOptionText,
	formatSlotValue,
	shownValueText,
	slotKind,
	storyTimePartsOf,
	type LedgerStoryTime,
	type StoryTimeParts
} from "@serene-pub/core-catalog/session-state"
import { parseStoryTime, slotValueForStorage, slotWordsFor } from "@serene-pub/sdk"
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
	/** 🚧 A bounded number's maximum in force for this owner, when it has one: "Health 10 (full)". */
	max?: number
}

/** 🚧 A clock row's move: the step, and where the clock went — or why it did not. */
export interface LedgerClockMove {
	by: number
	unit: string
	cause?: "action" | "keeper" | "tick" | null
	fromLabel?: string | null
	toLabel?: string | null
	/**
	 * 🚧 Where the clock stood and now stands, as parts (named through the
	 * book's calendar) — what a widget copy's `timeFormat` spells. Beside the
	 * labels, never instead: a host or widget that predates them reads the labels.
	 */
	from?: StoryTimeParts | null
	to?: StoryTimeParts | null
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
	/**
	 * 🚧 The story times `text` spells, as parts — a story-time stat's move
	 * or a clock move — so a Messages copy with a `timeFormat` spells them
	 * its own way (`ledgerLineTextAs`). Absent on every other line.
	 */
	storyTime?: LedgerStoryTime
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

/**
 * What the ledger knows of a slot's shape: its kind and field, off the
 * session's slot descriptors (`Sockets.State.SlotDescriptor`).
 */
export type LedgerSlotOf = (
	slotId: string
) => Parameters<typeof slotKind>[0] | undefined

/**
 * A value as the line says it. A story-time-shaped slot (a crawl's clock,
 * `core:stat-shape/story-time@1`) is spelled the way its shape says —
 * `formatStoryTime`, free-form here — never the stored `1-01-01 16:30`;
 * every other value as `formatSlotValue` says.
 */
const valueWords = (
	slot: Parameters<typeof slotKind>[0] | undefined,
	value: LedgerValue
): string =>
	slot && value !== null && slotKind(slot) === "story-time"
		? shownValueText(slot, value, (source) => source)
		: // 🚧 A choice by its option's words (P4-7, the 100-turn walk #23:
			// "Fate alive → taken-out"): the label its field gives the value.
			slot && typeof value === "string" && slotKind(slot) === "choice"
			? choiceOptionText(slot, value)
			: formatSlotValue(value)

/**
 * 🚧 A number that fell to nothing and rose again under one message
 * (PLAN-dc-after-walk3 R1-5, the walk's N15: death's door read "Health 10 →
 * 0 · Health 0 → 1"): said as what happened — "survives at death's door on
 * 1 health", the slot's own words for nothing (its lowest band, `upTo: 0`);
 * a slot with no such words, "Health 10 → 0 → 1". Null for any other change.
 */
function throughFloor(
	label: string,
	before: LedgerValue | undefined,
	between: readonly LedgerValue[],
	after: LedgerValue,
	slot: Parameters<typeof slotKind>[0] | undefined,
	words: boolean
): string | null {
	if (typeof after !== "number" || after <= 0) return null
	if (!between.some((v) => v === 0)) return null
	const floor = wordsOf(slot)?.find((b) => b.upTo <= 0)?.label
	if (floor) return words ? `survives ${floor.toLowerCase()}` : `survives ${floor.toLowerCase()} on ${after} ${label.toLowerCase()}`
	return `${label} ${typeof before === "number" ? `${before} → ` : ""}0 → ${after}`
}

/** 🚧 A slot's words bands, as its descriptor carries them (a table that keeps no numbers). */
const wordsOf = (slot: Parameters<typeof slotKind>[0] | undefined) => {
	const words = (slot as { words?: unknown } | undefined)?.words
	return Array.isArray(words) ? (words as { upTo: number; label: string }[]) : undefined
}

const valueText = (
	label: string,
	before: LedgerValue | undefined,
	after: LedgerValue,
	slot?: Parameters<typeof slotKind>[0],
	words = false
): string => {
	// 🚧 A table that keeps no numbers (P2-6): a number moves in words.
	if (words && typeof after === "number") {
		if (typeof before !== "number") return `${label} is set`
		return `${label} ${after < before ? "falls" : after > before ? "rises" : "holds"}`
	}
	if (before === undefined || before === null) return `${label} → ${valueWords(slot, after)}`
	// 🚧 A value cleared (PLAN-dc-after-walk3 R1-4, the walk's NEW-8: "Death
	// saves 2 passes, 2 failures →"): no arrow to nothing.
	if (after === null || (typeof after === "string" && !after.trim())) return `${label} cleared`
	const change = listChangeWords(before, after)
	if (change !== null) return `${label} ${change}`
	return `${label} ${valueWords(slot, before)} → ${valueWords(slot, after)}`
}

/** An item as the list reads it, without its count: `Potion of healing`. */
const itemWords = (item: unknown): string => {
	if (item && typeof item === "object" && !Array.isArray(item)) {
		const { count: _count, ...rest } = item as Record<string, unknown>
		return formatSlotValue([rest])
	}
	return formatSlotValue([item])
}

/** What makes two list items one: what is stored, count and read-in name aside. */
const itemIdentity = (item: unknown): string => {
	const stored = slotValueForStorage((item ?? null) as LedgerValue) as unknown
	if (stored && typeof stored === "object" && !Array.isArray(stored)) {
		const { count: _count, name, ...rest } = stored as Record<string, unknown>
		// A reference or a piece is its target (its name is read in); any
		// other item is its name.
		const targeted = "entryId" in rest || "pieceId" in rest
		return JSON.stringify(targeted ? rest : { ...rest, name })
	}
	return JSON.stringify(stored)
}

const itemCount = (item: unknown): number => {
	const c = item && typeof item === "object" ? (item as { count?: unknown }).count : undefined
	return typeof c === "number" && Number.isFinite(c) ? c : 1
}

/**
 * 🚧 A list's change as what moved, not the whole list twice (DC walk 6:
 * "Weapons Longsword → Longsword, Handaxe"): `+ Handaxe`, `− Potion`, and a
 * held count's move `Potion of healing ×1 → ×2`, joined with commas. Null
 * when either side is not a list, or nothing in it moved. Pure.
 */
export function listChangeWords(before: LedgerValue | undefined, after: LedgerValue): string | null {
	if (!Array.isArray(before) || !Array.isArray(after)) return null
	const tally = (items: unknown[]) => {
		const out = new Map<string, { item: unknown; count: number }>()
		for (const item of items) {
			const id = itemIdentity(item)
			const held = out.get(id)
			if (held) held.count += itemCount(item)
			else out.set(id, { item, count: itemCount(item) })
		}
		return out
	}
	const was = tally(before)
	const now = tally(after)
	// 🚧 A piece changed in place (P4-7, the 100-turn walk #23): one gone and
	// one come under the same name is that piece, its numbers moved — "Level
	// 1: 2 → 1 left", never "− Level 1, + Level 1".
	// `paired`: the new side's words; the old side's id maps to "" (said already).
	const goneIds = [...was.keys()].filter((id) => !now.has(id))
	const paired = new Map<string, string>()
	for (const [id, { item }] of now) {
		if (was.has(id)) continue
		const name = itemWords(item)
		const gid = goneIds.find((g) => !paired.has(g) && itemWords(was.get(g)!.item) === name)
		if (gid === undefined) continue
		const moved = inPlaceWords(was.get(gid)!.item, item)
		if (!moved) continue
		paired.set(gid, "")
		paired.set(id, `${name}: ${moved}`)
	}
	const parts: string[] = []
	for (const [id, { item, count }] of now) {
		const old = was.get(id)
		if (paired.get(id)) parts.push(paired.get(id)!)
		else if (!old) parts.push(`+ ${itemWords(item)}${count > 1 ? ` ×${count}` : ""}`)
		else if (old.count !== count) parts.push(`${itemWords(item)} ×${old.count} → ×${count}`)
	}
	for (const [id, { item, count }] of was)
		if (!now.has(id) && !paired.has(id)) parts.push(`− ${itemWords(item)}${count > 1 ? ` ×${count}` : ""}`)
	return parts.length ? parts.join(", ") : null
}

/** A piece's own numbers — on the item, under its `props`, or its `overrides`. */
const pieceNumbers = (item: unknown): Record<string, number> => {
	const out: Record<string, number> = {}
	if (!item || typeof item !== "object" || Array.isArray(item)) return out
	const layers = [item, (item as { props?: unknown }).props, (item as { overrides?: unknown }).overrides]
	for (const layer of layers)
		if (layer && typeof layer === "object" && !Array.isArray(layer))
			for (const [k, v] of Object.entries(layer as Record<string, unknown>))
				if (k !== "count" && typeof v === "number" && Number.isFinite(v)) out[k] = v
	return out
}

/**
 * 🚧 What moved in a piece changed in place: a pool's `max` and `used` as
 * what is left (`2 → 1 left` — a spell slot spent, one given back), else
 * each number that moved (`uses 2 → 1`). Null when no number moved — a
 * change the line cannot say better than the item's words.
 */
function inPlaceWords(before: unknown, after: unknown): string | null {
	// 🚧 A way that opened, a door that locked (PLAN-dc-after-walk2 Q2-1): its
	// state in words, "locked → open" — never "− Door, + Door".
	const stateOf = (item: unknown) =>
		item && typeof item === "object" && !Array.isArray(item) && typeof (item as { state?: unknown }).state === "string"
			? ((item as { state: string }).state || "open")
			: null
	const was = stateOf(before)
	const now = stateOf(after)
	if (was !== null && now !== null && was !== now) return `${was} → ${now}`
	const a = pieceNumbers(before)
	const b = pieceNumbers(after)
	if (a.max !== undefined && a.used !== undefined && b.max !== undefined && b.used !== undefined && a.max === b.max) {
		const left = (n: Record<string, number>) => Math.max(0, n.max! - n.used!)
		return left(a) === left(b) ? null : `${left(a)} → ${left(b)} left`
	}
	const moved = [...new Set([...Object.keys(a), ...Object.keys(b)])]
		.filter((k) => a[k] !== undefined && b[k] !== undefined && a[k] !== b[k])
		.map((k) => `${k} ${a[k]} → ${b[k]}`)
	return moved.length ? moved.join(", ") : null
}

/** Two values the same once stored: a reference's read-in `name` and key order aside. */
const sameStored = (a: LedgerValue, b: LedgerValue): boolean =>
	JSON.stringify(slotValueForStorage(a ?? null)) === JSON.stringify(slotValueForStorage(b ?? null))

/**
 * The lines these rows describe, oldest first.
 *
 * Each row is one line, including two rows for the same slot on one message:
 * both are real rows, and collapsing them would hide a step somebody took —
 * except a row that wrote the value already in force, which changed nothing.
 */
export function ledgerLines(
	rows: LedgerRow[],
	baselines: LedgerBaseline[] = [],
	/** The slot's shape, where known — a story time is spelled, not printed raw. */
	slotOf?: LedgerSlotOf,
	/** 🚧 `words`: the session keeps no numbers — a number's line reads in words (P2-6). */
	opts: { words?: boolean } = {}
): LedgerLine[] {
	const seen = new Map<string, LedgerValue>()
	for (const b of baselines) seen.set(`v:${b.ownerKey}:${b.slotId}`, b.value)
	/** 🚧 Trails whose value so far is only what the session inherited — no row of its own yet. */
	const inherited = new Set<string>(baselines.map((b) => `v:${b.ownerKey}:${b.slotId}`))

	const out: LedgerLine[] = []
	const ordered = inOrder(rows)
	/** Rows already read into an earlier line of the same message and field (below). */
	const merged = new Set<number>()
	for (let i = 0; i < ordered.length; i++) {
		if (merged.has(i)) continue
		let row = ordered[i]!
		if (row.kind === "clock") {
			if (!row.clock) continue
			out.push({
				key: `c${row.id}`,
				messageId: row.messageId,
				ownerKey: row.ownerKey,
				ownerLabel: row.ownerLabel,
				kind: "clock",
				text: clockMoveText(row.clock),
				updatedBy: row.updatedBy,
				...clockStoryTime(row.clock)
			})
			continue
		}
		const trail = `v:${row.ownerKey}:${row.slotId ?? ""}`
		const before = seen.get(trail)
		const fromInherited = inherited.has(trail) || before === undefined
		// 🚧 A list written twice in a row under one message — a piece taken
		// out and put back changed (a spell slot spent, a door opened) — is
		// ONE change (PLAN-dc-after-walk2 Q3-1): "Spell slots Level 1: 2 → 1
		// left", never "− Level 1" then "+ Level 1". 🚧 And any value written
		// again and again in a row under one message (PLAN-dc-after-walk3
		// R1-4, the walk's NEW-8: five casts read "Spell points 4 → 3 · 3 →
		// 2 · 2 → 1 · 1 → 0"): one line, from where it stood to where it ended.
		// Not only in a row: every write of the field under the message, one
		// line where the first stood (death's door's "Health 10 → 0 · Health 0
		// → 1" had the seat's other changes between them).
		const between: LedgerValue[] = []
		for (let j = i + 1; j < ordered.length; j++) {
			const next = ordered[j]!
			if (next.messageId !== row.messageId) break
			if (next.kind !== "value" || next.ownerKey !== row.ownerKey || next.slotId !== row.slotId || Array.isArray(next.value) !== Array.isArray(row.value)) continue
			between.push((row.value ?? null) as LedgerValue)
			row = next
			merged.add(j)
		}
		const after = (row.value ?? null) as LedgerValue
		const slot = row.slotId ? slotOf?.(row.slotId) : undefined
		// A write that left the value where it was changes nothing to read:
		// no `The Sunken Gate → The Sunken Gate`. A reference is compared by
		// what is stored (its entry and count), never its read-in name.
		// The value in force stays the one already read (and named).
		if (before !== undefined && sameStored(before, after)) continue
		// 🚧 A place's list read for the first time is the world as it stood,
		// not a change (Q3-1: the world's first ways out "gained" again the
		// first time a turn listed them).
		const firstAtPlace = before === undefined && Array.isArray(after) && row.ownerKey.startsWith("location:")
		seen.set(trail, after)
		inherited.delete(trail)
		if (firstAtPlace) continue
		out.push({
			key: `v${row.id}`,
			messageId: row.messageId,
			ownerKey: row.ownerKey,
			ownerLabel: row.ownerLabel,
			kind: "value",
			text:
				// 🚧 A number's first value in this session, filled to its maximum
				// over what it inherited (Q3-1: a new character's "Health 20 →
				// 10"): what it is now — "Health 10 (full)"; at a table of words
				// (R1-4, the walk's NEW-8: a Story hero's creation read "Health
				// falls"), its words at full — "Health Unhurt".
				fromInherited && typeof after === "number" && typeof row.max === "number" && after === row.max
					? opts.words === true
						? `${row.slotLabel ?? ""} ${slotWordsFor(wordsOf(slot), after, row.max) ?? "full"}`
						: `${row.slotLabel ?? ""} ${valueWords(slot, after)} (full)`
					: (throughFloor(row.slotLabel ?? "", before, between, after, slot, opts.words === true) ??
						valueText(row.slotLabel ?? "", before, after, slot, opts.words === true)),
			before,
			after,
			updatedBy: row.updatedBy,
			...valueStoryTime(row.slotLabel ?? "", before, after, slot)
		})
	}
	return out
}

/** A stored story-time value as parts, or `null`. */
const timeParts = (value: LedgerValue | undefined): StoryTimeParts | null => {
	const time = value === undefined || value === null ? null : parseStoryTime(value)
	return time ? storyTimePartsOf(time) : null
}

/**
 * 🚧 A story-time stat's line as parts (`storyTime`), beside its words —
 * only when the slot is story-time-shaped and the new value reads as one.
 */
function valueStoryTime(
	label: string,
	before: LedgerValue | undefined,
	after: LedgerValue,
	slot: Parameters<typeof slotKind>[0] | undefined
): { storyTime?: LedgerStoryTime } {
	if (!slot || slotKind(slot) !== "story-time") return {}
	const to = timeParts(after)
	return to ? { storyTime: { kind: "value", label, before: timeParts(before), after: to } } : {}
}

/** 🚧 A clock move's line as parts (`storyTime`): a move that landed, with both ends sent. */
function clockStoryTime(move: LedgerClockMove): { storyTime?: LedgerStoryTime } {
	if (move.skipped || !move.from || !move.to) return {}
	const span = clockSpanWords(move.by, move.unit)
	const head = move.by < 0 ? `Time goes back: ${span}` : `Time passes: ${span}`
	return { storyTime: { kind: "clock", head, from: move.from, to: move.to } }
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
	// 🚧 An offer (Give to…, owner ruling ★4): who offers what to whom, in
	// the words it was made with — nothing has moved yet.
	const offer = payload.offer as
		| { fromLabel?: unknown; toLabel?: unknown; itemName?: unknown; count?: unknown }
		| undefined
	if (offer && typeof offer === "object") {
		const n = typeof offer.count === "number" && offer.count > 1 ? ` ×${offer.count}` : ""
		const words = (v: unknown, or: string) => (typeof v === "string" && v.trim() ? v.trim() : or)
		return `${words(offer.fromLabel, "Someone")} offers ${words(offer.itemName, "something")}${n} to ${words(offer.toLabel, "someone")}`
	}
	// 🚧 A held field change (ties on the graph, T2): one side of a tie set
	// by the game master, named by the host as it filed it.
	const held = payload.heldField as { field?: unknown; value?: unknown } | undefined
	if (held && typeof held === "object") {
		const words = (v: unknown, or: string) => (typeof v === "string" && v.trim() ? v.trim() : or)
		return `${words(payload.ownerLabel, "Someone")} → ${words(payload.towardsLabel, "someone")}: ${words(payload.fieldLabel, String(held.field ?? "it"))} → ${String(held.value)}`
	}
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
