/**
 * `core:task/undescribed-name@1` — is a room name already described, and where
 * (lair pass R7, 2026-09-28; owner ruling 2: *ask the person to describe the
 * next room, unless it is already described in prose or the lorebook*).
 *
 * ⚠ **Beside `bindings.ts` rather than inside it**, for the reason
 * `bindings.state.ts` states: that file is thousands of lines and more than
 * one lane appends to it at a time. `coreBindings()` spreads this part in.
 *
 * Pure: no `ctx`, no reads. The rows arrive on ports — a
 * `core:query/lorebook-entries@1` listing and a `core:query/session-history@1`
 * read — so hidden rows and rows still being written are already gone (the
 * host's `session_messages` read drops both). The name rule is the SDK's
 * (`sameName`, `passageNaming`), so this check and every other reader agree on
 * when two names are one.
 *
 * Lookups, in order; the first hit wins:
 *  1. an entry whose `name` or any comma-split `keys` term is the same name —
 *     `locationEntries` before `entries`, by the one room rule
 *     (`describingRow`, `$lib/shared/lorebooks/describingRow` — shared since
 *     B7, whose Exits-line links find their rooms by it too);
 *  2. among the newest `window` rows of the `channels` named, the newest row
 *     written by a person, an envoy or a speakerless reply (never a
 *     character) holding a paragraph that names the name and has at least
 *     `minWords` other words;
 *  3. otherwise the name is undescribed.
 *
 * **`path` and a lore reference** (places plan B6, 2026-09-29): the name may
 * sit inside `name` at a dotted `path` (the SDK's `readPath` — the Lair reads
 * `world.location` off a session-state document to find the room the party
 * stand in), and a value with an `entryId` (a location set to a place entry)
 * is the listed entry with that id, never a namesake found by its title.
 *
 * **`fallbackName`** (plan A27, 2026-09-30): when the value at `path` names
 * nothing — no words, no lore reference — the fallback is read in its place,
 * whole and by the same rules. The Lair wires the knock's `vantage` (the room
 * its planner said the party stood in), so its `here` takes the world's
 * location, else the planner's hint — the order `worldValueOrHint` reads a
 * play turn's location in.
 */

import type { Bindings } from "@serene-pub/sdk"
import {
	isSlotLoreRef,
	ok,
	parseChannel,
	passageNaming,
	readPath,
	reads
} from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import { describingRow } from "$lib/shared/lorebooks/describingRow"
import type { NodeInput } from "./bindingTypes"

/** The declared defaults, applied here too: a parameter is a control, not a promise. */
export const UNDESCRIBED_DEFAULTS = {
	channels: ["main"] as string[],
	window: 40,
	minWords: 12,
	path: ""
}

/** What the task answers. `describedBy` is empty when nothing describes the name. */
export interface UndescribedAnswer {
	undescribed: string
	describedBy: "entry" | "prose" | ""
	entryId: number | null
	passage: string
}

/** The entry of `lists` that `name` names (`describingRow`), by id. */
export function describingEntry(
	name: string,
	...lists: unknown[]
): { id: number | null } | null {
	const row = describingRow(name, ...lists) as { id?: unknown } | null
	return row ? { id: typeof row.id === "number" ? row.id : null } : null
}

/** The id of the first row of `lists` whose `id` is `entryId`, or null. */
function listedEntry(entryId: number, ...lists: unknown[]): number | null {
	for (const list of lists) {
		if (!Array.isArray(list)) continue
		for (const e of list)
			if (e && typeof e === "object" && (e as { id?: unknown }).id === entryId)
				return entryId
	}
	return null
}

/**
 * Whether a row's author may describe a room: a person (a `user` row), an
 * envoy (`speaker` `envoy:<slug>`), or a speakerless reply (no character, no
 * speaker: the pipeline's own voice, e.g. a stored narrator row). Never a
 * character — a delver's line naming a door is not a description.
 */
export function describesAsAuthor(row: {
	role?: unknown
	characterId?: unknown
	speaker?: unknown
}): boolean {
	if (row.role === "user") return true
	const speaker = typeof row.speaker === "string" ? row.speaker : ""
	if (speaker.startsWith("envoy:")) return true
	if (speaker) return false
	return row.characterId == null
}

/** Whether a row's channel is one `channels` names (a bare slug is every lane of it). */
function onChannels(rowChannel: unknown, channels: string[]): boolean {
	const row = parseChannel(rowChannel)
	return channels.some((c) => {
		const want = parseChannel(c)
		return row.slug === want.slug && (!want.explicit || row.lane === want.lane)
	})
}

/** The rows a `messages` port carried, flattened one level, ascending by id, deduplicated. */
function rowsOf(messages: unknown): any[] {
	if (!Array.isArray(messages)) return []
	const flat = messages.flatMap((m) => (Array.isArray(m) ? m : [m]))
	const seen = new Set<number>()
	const out: any[] = []
	for (const m of flat) {
		if (!m || typeof m !== "object") continue
		const id = (m as { id?: unknown }).id
		// A row with no stored id (the composer's uncommitted draft is `-1`)
		// is not something anyone wrote yet.
		if (typeof id !== "number" || id < 0 || seen.has(id)) continue
		if ((m as { isHidden?: unknown }).isHidden === true) continue
		seen.add(id)
		out.push(m)
	}
	return out.sort((a, b) => a.id - b.id)
}

/** The newest qualifying row's describing paragraph, or `null`. */
export function describingPassage(
	name: string,
	messages: unknown,
	opts: { channels: string[]; window: number; minWords: number }
): string | null {
	const recent = rowsOf(messages)
		.filter((r) => onChannels(r.channel, opts.channels))
		.slice(-opts.window)
	for (let i = recent.length - 1; i >= 0; i--) {
		const row = recent[i]
		if (!describesAsAuthor(row)) continue
		const passage = passageNaming(row.content, name, opts.minWords)
		if (passage) return passage
	}
	return null
}

/** A whole number from a parameter, or the default. */
function wholeOr(value: unknown, fallback: number, min: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(min, Math.floor(value))
		: fallback
}

/** The whole check, over plain values. */
export function undescribedAnswer(input: {
	name?: unknown
	fallbackName?: unknown
	locationEntries?: unknown
	entries?: unknown
	messages?: unknown
	params?: {
		channels?: unknown
		window?: unknown
		minWords?: unknown
		path?: unknown
	}
}): UndescribedAnswer {
	const none: UndescribedAnswer = {
		undescribed: "",
		describedBy: "",
		entryId: null,
		passage: ""
	}
	const path =
		typeof input.params?.path === "string"
			? input.params.path.trim()
			: UNDESCRIBED_DEFAULTS.path
	const held = readPath(input.name, path || undefined)
	const names = (v: unknown) =>
		isSlotLoreRef(v) || (typeof v === "string" && v.trim() !== "")
	const value = names(held) ? held : input.fallbackName
	// A lore reference is its entry, by id — or nothing, when no listing
	// holds it. Never its title's namesake (B6).
	if (isSlotLoreRef(value)) {
		const listed = listedEntry(value.entryId, input.locationEntries, input.entries)
		return listed ? { ...none, describedBy: "entry", entryId: listed } : none
	}
	const name = typeof value === "string" ? value.trim() : ""
	if (!name) return none

	const entry = describingEntry(name, input.locationEntries, input.entries)
	if (entry) return { ...none, describedBy: "entry", entryId: entry.id }

	const p = input.params ?? {}
	const channels = Array.isArray(p.channels)
		? p.channels.filter((c): c is string => typeof c === "string" && c.trim() !== "")
		: UNDESCRIBED_DEFAULTS.channels
	const passage = describingPassage(name, input.messages, {
		channels: channels.length ? channels : UNDESCRIBED_DEFAULTS.channels,
		window: wholeOr(p.window, UNDESCRIBED_DEFAULTS.window, 1),
		minWords: wholeOr(p.minWords, UNDESCRIBED_DEFAULTS.minWords, 0)
	})
	if (passage) return { ...none, describedBy: "prose", passage }

	return { ...none, undescribed: name }
}

export function undescribedNameBindings(): Bindings {
	return {
		"core:task/undescribed-name@1": reads<typeof C.undescribedName>(
			async (input: NodeInput<typeof C.undescribedName>) => {
				const answer = undescribedAnswer(input ?? {})
				return ok({ main: answer.undescribed, ...answer })
			},
			{
				ports: ["name", "fallbackName", "locationEntries", "entries", "messages"],
				params: ["channels", "window", "minWords", "path"]
			}
		)
	}
}
