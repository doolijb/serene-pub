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
 *     `locationEntries` before `entries`;
 *  2. among the newest `window` rows of the `channels` named, the newest row
 *     written by a person, an envoy or a speakerless reply (never a
 *     character) holding a paragraph that names the name and has at least
 *     `minWords` other words;
 *  3. otherwise the name is undescribed.
 */

import type { Bindings } from "@serene-pub/sdk"
import {
	ok,
	parseChannel,
	passageNaming,
	reads,
	sameName
} from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { NodeInput } from "./bindingTypes"

/** The declared defaults, applied here too: a parameter is a control, not a promise. */
export const UNDESCRIBED_DEFAULTS = {
	channels: ["main"] as string[],
	window: 40,
	minWords: 12
}

/** What the task answers. `describedBy` is empty when nothing describes the name. */
export interface UndescribedAnswer {
	undescribed: string
	describedBy: "entry" | "prose" | ""
	entryId: number | null
	passage: string
}

/** An entry's `keys` as terms: a list, a comma-separated string, or both. */
export function keyTerms(keys: unknown): string[] {
	const raw = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : []
	return raw
		.filter((k): k is string => typeof k === "string")
		.flatMap((k) => k.split(","))
		.map((k) => k.trim())
		.filter(Boolean)
}

/** The first entry of `lists` (in order) whose name or a key term is `name`. */
export function describingEntry(
	name: string,
	...lists: unknown[]
): { id: number | null } | null {
	for (const list of lists) {
		if (!Array.isArray(list)) continue
		for (const e of list) {
			if (!e || typeof e !== "object") continue
			const row = e as { id?: unknown; name?: unknown; keys?: unknown }
			if (
				sameName(row.name, name) ||
				keyTerms(row.keys).some((k) => sameName(k, name))
			)
				return { id: typeof row.id === "number" ? row.id : null }
		}
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
	locationEntries?: unknown
	entries?: unknown
	messages?: unknown
	params?: { channels?: unknown; window?: unknown; minWords?: unknown }
}): UndescribedAnswer {
	const none: UndescribedAnswer = {
		undescribed: "",
		describedBy: "",
		entryId: null,
		passage: ""
	}
	const name = typeof input.name === "string" ? input.name.trim() : ""
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
				ports: ["name", "locationEntries", "entries", "messages"],
				params: ["channels", "window", "minWords"]
			}
		)
	}
}
