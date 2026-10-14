/**
 * One **job** — a transform the pub needs a default pair for — as the index
 * shows it: the status strip for chat, a tile for each of the others.
 *
 * Its own module because two components need the type and a Svelte component
 * cannot export one from its instance script. The tiles are built in
 * `ConnectionIndexView` out of the readiness rows and the defaults summary.
 *
 * A tile's colour is a `ConnectionState`, the one scale
 * (`connectionRowStatus.ts`), with one reading of its own: an optional job
 * with nothing registered is `idle`, not `unfinished`. Off is a perfectly good
 * answer for every job but chat, and nine gold tiles on a fresh install would
 * be nine false alarms. Chat's strip keeps `unfinished` — it blocks play.
 */
import type { ConnectionState } from "./connectionRowStatus"

export interface JobTile {
	/** The transform id, e.g. `text->image`. */
	capability: string
	label: string
	/** One line, from the SDK's transform table — never written here. */
	tagline?: string
	/** What is registered, or null while nothing is. */
	modelName?: string | null
	/** Set, and something is wrong with it. */
	problem?: string | null
	/** A `@lucide/svelte` export name. */
	icon?: string
	/** On the one scale; absent, `jobTileState` reads it off the fields above. */
	state?: ConnectionState
}

import { capabilityTagline } from "@serene-pub/sdk"
import type { DefaultsSummaryEntry } from "./defaultsSummary"
import { chatChoice, type ChatSource, type ReadinessRow } from "./readiness"

/**
 * A tile's state: its own when it carries one, else from what it says —
 * a problem is `broken`, a model with none is `ready`, nothing is `idle`.
 */
export function jobTileState(tile: JobTile): ConnectionState {
	if (tile.state) return tile.state
	if (tile.problem) return "broken"
	return tile.modelName ? "ready" : "idle"
}

/**
 * What the status strip says about chat.
 *
 * ⚠ `problem` is only ever set for a pair that IS registered and cannot run —
 * a model the host stopped listing, files not downloaded, a crashed process.
 * An UNSET chat default is not a problem, it is a thing to do, and the strip
 * says so in its own words rather than borrowing a failure's.
 */
export interface ChatFacts {
	/**
	 * The strip's dot and headline, on the one scale: `ready`, `busy` while
	 * its model downloads, `broken` when it cannot run, `unfinished` while
	 * nothing is registered.
	 */
	state: ConnectionState
	modelName: string | null
	connectionName: string | null
	problem: string | null
	/** Whether a pair is registered at all — Set up vs Fix. */
	set: boolean
	/**
	 * Unset, and some connection here already serves chat: the button is
	 * **Choose a model** and opens chat's job view, never the Set up chat
	 * flow (`chatChoice`). False while set, or while nothing serves chat.
	 */
	choose: boolean
	/** The second line while unset — "OpenRouter lists 503 models · pick one". */
	choiceSentence: string | null
}

export function chatFacts(
	entries: readonly DefaultsSummaryEntry[],
	rows: readonly ReadinessRow[],
	connections: readonly ChatSource[] = []
): ChatFacts {
	const entry = entries.find((e) => e.capability === "text->text")
	const row = rows.find((r) => r.capability === "text->text")
	const set = !!row?.set
	const choice = set ? null : chatChoice(connections)
	return {
		state: row?.state ?? "unfinished",
		modelName: entry?.model?.name ?? null,
		connectionName: entry?.connection?.name ?? null,
		problem: row && row.set && row.state !== "ready" ? row.sentence : null,
		set,
		choose: !!choice?.choose,
		choiceSentence: choice?.sentence ?? null
	}
}

/**
 * Every job EXCEPT chat, as tiles, in the sections' order then the SDK's.
 *
 * The four modalities that have a section come first because those are the ones
 * a person can act on from here; the rest follow in `TRANSFORMS` order and are
 * just as real, they are simply rarer.
 *
 * ⚠ Chat is not in here. It has the status strip, because it is the one job
 * that blocks play, and ranking it beside Speech as a peer scores a fresh
 * install "3 of 10 ready".
 */
export function buildJobTiles(
	entries: readonly DefaultsSummaryEntry[],
	rows: readonly ReadinessRow[],
	sectionOrder: readonly string[]
): JobTile[] {
	const rank = (capability: string) => {
		const i = sectionOrder.indexOf(capability)
		return i === -1 ? sectionOrder.length : i
	}
	return entries
		.filter((e) => e.capability !== "text->text")
		.map((entry) => {
			const row = rows.find((r) => r.capability === entry.capability)
			return {
				capability: entry.capability,
				label: entry.label,
				tagline: capabilityTagline(entry.capability as any),
				modelName: entry.model?.name ?? null,
				problem:
					row && row.set && row.state !== "ready" ? row.sentence : null,
				icon: row?.icon,
				// An optional job with nothing registered is idle (see above).
				state: row?.set ? row.state : ("idle" as const)
			}
		})
		.sort((a, b) => rank(a.capability) - rank(b.capability))
}
