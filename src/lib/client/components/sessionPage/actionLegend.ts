/**
 * The action legend (owner request 2026-09-28): "a way to see from a legend
 * what they do". One list of every action this session offers the person
 * right now — the server's resolved listing (`sessions:actions`), so present-
 * when, audience and enabled-when are already applied — grouped by where a
 * person meets it, each with its description, its slash command and what it
 * asks for before it fires (R3). A greyed action is listed with its reason,
 * never dropped: the legend explains, it does not filter.
 *
 * Pure: the page hands in the venues and the same verdict its chips, extra
 * tab and message menu read, so the legend cannot disagree with the button
 * it describes.
 */
import { actionIdentity } from "$lib/shared/actions/identity"
import type { ListedCollects } from "$lib/shared/actions/collects"

type ListedAction = Sockets.Sessions.Actions.Action

/** The listing as the page holds it — venue kind → primary + overflow. */
export type LegendVenues = Record<string, { primary: ListedAction[]; overflow: ListedAction[] }>

/** The venues the legend explains, in the order a person meets them. */
export const LEGEND_VENUES = [
	{ venue: "composer", title: "In the composer" },
	{ venue: "extra", title: "Turn controls" },
	{ venue: "message", title: "On a message" }
] as const

export type LegendVenue = (typeof LEGEND_VENUES)[number]["venue"]

/**
 * The venues the `/` palette reaches. A message-venue action is pressed on a
 * row, so its slash name calls nothing from the composer and is not shown.
 */
const SLASH_VENUES: ReadonlySet<LegendVenue> = new Set(["composer", "extra"])

export interface LegendEntry {
	/** `<spec slug>#<key>` — the row's key. */
	identity: string
	name: string
	description?: string
	icon?: string
	/** What the icon says standing alone — the declaration's `iconAlt`, else the name. */
	iconAlt: string
	/** The slash command, without its `/`, where the palette reaches the action. */
	slash?: string
	/** What a press asks for in the collect modal (lair pass R3). */
	collects?: ListedCollects
	disabled: boolean
	reason?: string
}

export interface LegendSection {
	venue: LegendVenue
	title: string
	entries: LegendEntry[]
}

/** The page's verdict on one listed action at one venue: the chips' own. */
export type LegendVerdict = (
	action: ListedAction,
	venue: LegendVenue
) => { disabled: boolean; reason?: string }

/** Every section with something in it, each action once per section. */
export function legendSections(venues: LegendVenues, verdict: LegendVerdict): LegendSection[] {
	const out: LegendSection[] = []
	for (const { venue, title } of LEGEND_VENUES) {
		const listed = venues[venue]
		if (!listed) continue
		const seen = new Set<string>()
		const entries: LegendEntry[] = []
		for (const a of [...listed.primary, ...listed.overflow]) {
			const identity = actionIdentity(a)
			if (seen.has(identity)) continue
			seen.add(identity)
			const state = verdict(a, venue)
			entries.push({
				identity,
				name: a.name,
				...(a.description ? { description: a.description } : {}),
				...(a.icon ? { icon: a.icon } : {}),
				iconAlt: a.iconAlt || a.name,
				...(SLASH_VENUES.has(venue) && a.slash ? { slash: a.slash } : {}),
				...(a.collects ? { collects: a.collects } : {}),
				disabled: state.disabled,
				...(state.disabled && state.reason ? { reason: state.reason } : {})
			})
		}
		if (entries.length) out.push({ venue, title, entries })
	}
	return out
}
