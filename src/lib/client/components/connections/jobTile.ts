/**
 * One capability, as the index and the full-page overview both show it.
 *
 * Its own module because two components need the type and a Svelte component
 * cannot export one from its instance script. Nothing here is logic: the tiles
 * are built in `ConnectionIndexView` out of the readiness rows and the defaults
 * summary, which both have their own tests.
 */
export interface JobTile {
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
}

import { capabilityTagline } from "@serene-pub/sdk"
import type { DefaultsSummaryEntry } from "./defaultsSummary"
import type { ReadinessRow } from "./readiness"

/**
 * What the status strip says about chat.
 *
 * ⚠ `problem` is only ever set for a pair that IS registered and cannot run —
 * a model the host stopped listing, files not downloaded, a crashed process.
 * An UNSET chat default is not a problem, it is a thing to do, and the strip
 * says so in its own words rather than borrowing a failure's.
 */
export interface ChatFacts {
	modelName: string | null
	connectionName: string | null
	problem: string | null
	/** Whether a pair is registered at all — Set up vs Fix. */
	set: boolean
}

export function chatFacts(
	entries: readonly DefaultsSummaryEntry[],
	rows: readonly ReadinessRow[]
): ChatFacts {
	const entry = entries.find((e) => e.capability === "text->text")
	const row = rows.find((r) => r.capability === "text->text")
	return {
		modelName: entry?.model?.name ?? null,
		connectionName: entry?.connection?.name ?? null,
		problem: row && row.set && row.state !== "ok" ? row.sentence : null,
		set: !!row?.set
	}
}

/**
 * Every transform EXCEPT chat, as tiles, in the sections' order then the SDK's.
 *
 * The four modalities that have a section come first because those are the ones
 * a person can act on from here; the rest follow in `TRANSFORMS` order and are
 * just as real, they are simply rarer.
 *
 * ⚠ Chat is not in here. It has the status strip, because it is the one
 * capability that blocks play and ranking it beside Speech as a peer is what
 * made the old readiness card score a fresh install "3 of 10 ready".
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
					row && row.set && row.state !== "ok" ? row.sentence : null,
				icon: row?.icon
			}
		})
		.sort((a, b) => rank(a.capability) - rank(b.capability))
}
