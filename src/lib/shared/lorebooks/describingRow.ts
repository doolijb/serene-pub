/**
 * The one room rule: which listed row a name stands for.
 *
 * Every reader that finds a room by its name finds it here, so they cannot
 * disagree about which room a name means: the Lair's *Answer the door* (the
 * `here` it links a new room to, `undescribed-name@1`), `{{locationEntry}}`
 * (the room whose "From here:" block the prompt shows), the place editor's
 * **Read links from the Exits line** (the place each way out leads to), a
 * place a model names in a state change — its location, or the owner of a
 * change (`sessionPlaceNamed`, server `state/entriesOnReading.ts`, over the
 * places the session sees) — and a lore link's end a pipeline names (server
 * `host.ts resolveLoreLinkEnd`, over every entry the session sees).
 *
 * ⚠ The RULE is shared; the LISTS differ by reader. The Lair reads the
 * session's listing (switched-on places, then its other lore); the Exits
 * line reads the editor's pool (switched-on places, then switched-off ones —
 * as **Link a place** offers them — and never other lore: a way out leads
 * to a place).
 *
 * Shared, not server-side, because that last reader is the client's (places
 * plan B7). The name rule underneath — articles, punctuation, NFKC — is the
 * SDK's `sameName`, which every other reader of a name uses too.
 */

import { isSlotLoreRef, sameName } from "@serene-pub/sdk"

/** An entry's `keys` as terms: a list, a comma-separated string, or both. */
export function keyTerms(keys: unknown): string[] {
	const raw = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : []
	return raw
		.filter((k): k is string => typeof k === "string")
		.flatMap((k) => k.split(","))
		.map((k) => k.trim())
		.filter(Boolean)
}

type NamedRow = { id?: unknown; name?: unknown; keys?: unknown }

/**
 * How a row can answer to a name, strongest first: its name exactly (case and
 * surrounding space aside), its name as `sameName` reads it (a leading "the"
 * aside), then one of its key terms.
 */
const NAME_TIERS: readonly ((row: NamedRow, name: string) => boolean)[] = [
	(row, name) =>
		typeof row.name === "string" &&
		row.name.trim() !== "" &&
		row.name.trim().toLowerCase() === name.trim().toLowerCase(),
	(row, name) => sameName(row.name, name),
	(row, name) => keyTerms(row.keys).some((k) => sameName(k, name))
]

/**
 * Every row of `lists` that answers `name` as strongly as the strongest
 * does: the lists in order, and within each the tiers in order over the
 * whole list, and at the first (list, tier) any row answers, all the rows
 * that answer there, in list order. Empty when none answers.
 *
 * More than one is a tie the rule cannot break — two rooms called the same,
 * or sharing a key. `describingRow` takes the first, for a reader that only
 * shows a room (`{{locationEntry}}`); a reader that can ask the person (the
 * Exits line's links) names the others instead; a door that writes and
 * cannot ask (a state change, a lore link) refuses it (`tieSentence`, or its
 * own sentence).
 */
export function answeringRows(name: string, ...lists: unknown[]): object[] {
	for (const list of lists) {
		if (!Array.isArray(list)) continue
		const rows = list.filter(
			(e): e is NamedRow => !!e && typeof e === "object"
		)
		for (const answers of NAME_TIERS) {
			const hits = rows.filter((row) => answers(row, name))
			if (hits.length) return hits
		}
	}
	return []
}

/**
 * The row of `lists` that `name` names: the first of `answeringRows` — so a
 * room's key never beats another room's name, and "the guardroom" finds
 * "Guardroom" only when no row is called that exactly. Whether ANY row
 * answers is the same as a one-pass search; which one does is what the
 * tiers decide.
 */
export function describingRow(name: string, ...lists: unknown[]): object | null {
	return answeringRows(name, ...lists)[0] ?? null
}

/**
 * The refusal for a name more than one row answers alike (`answeringRows`
 * gave several) at a door that cannot ask the person which — a state change a
 * model names (`loreRefNamed`, the state tools' `ownerFor`). Taking the first
 * would put the change on the wrong room without a word.
 */
export function tieSentence(written: string, names: readonly string[]): string {
	const quoted = names.map((n) => `'${n}'`)
	const listed =
		quoted.length <= 2
			? quoted.join(" and ")
			: `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`
	return (
		`'${written}' answers to more than one entry in the lorebook alike (${listed}), so none ` +
		`was taken. Name the one meant exactly, or tell them apart in the lorebook.`
	)
}

/**
 * The listed room a location value stands for — the one rule the Lair's
 * Answer the door (`here`), `{{locationEntry}}` and the Exits line's links all
 * resolve it by (B6 review round). A lore reference is the listed row with
 * its id, never its title's namesake; a name is `describingRow`'s.
 *
 * The value is found in one order: the world's location, else the planner's
 * hint. `{{locationEntry}}` reads it by `worldValueOrHint` (plan A27), with
 * the plan of the turn it renders in; Answer the door's `here` reads the
 * world's location, else the knock's `vantage` — the hint the knock turn's
 * planner gave, carried on the block (SDK `lairActions.ts`,
 * `undescribed-name@1`'s `fallbackName`). The knock turn runs no voice, so
 * no prompt in that turn shows the hinted room.
 */
export function locationRowOf(value: unknown, rooms: unknown): object | null {
	if (!Array.isArray(rooms)) return null
	if (isSlotLoreRef(value))
		return (
			rooms.find(
				(e) =>
					!!e &&
					typeof e === "object" &&
					(e as { id?: unknown }).id === value.entryId
			) ?? null
		)
	const name = typeof value === "string" ? value.trim() : ""
	return name ? describingRow(name, rooms) : null
}
