/**
 * What this book holds, said in sentences.
 *
 * A readout and not a control panel: every line reports a figure the book
 * already has, so there is nothing here to switch on and nothing that changes
 * what the workspace offers. Pure, because these are the sentences a reader is
 * told and a sentence that lies about a count is a bug worth a test.
 */

import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { SCENE_KIND } from "./poolFilter"
import { CAST_KIND } from "./scopes"

export const READOUT_NOTE =
	"A readout of what is in the book, not a set of features to switch on. " +
	"Every capability is available in every lorebook. What you see in the " +
	"workspace follows what the book holds."

export interface BookReadoutInput {
	/** The server's figures, or null while they are still on their way. */
	counts: Record<string, number> | null
	/** Cast members with at least one lore entry anchored to them. */
	castWithLore: number
	relationships: number
	/** The ends of the dated story, absent when nothing is dated. */
	dated?: { earliest: string; latest: string }
	/** Scenes whose history entry has not been compiled yet. */
	scenesWaiting: number
	/** The session scenes are captured from, if one is. */
	capturedFrom?: string | null
	/** Entries filed inside another one. */
	nested: number
	/** How deep the deepest chain of them goes. */
	depth: number
	/** Every line the book has, by name: "main" first, then its branches. */
	branches: string[]
}

export interface ReadoutLine {
	id: string
	label: string
	count: number
	/** One line each, under the figure. */
	detail: string[]
}

const countOf = (counts: Record<string, number> | null, kind: string) =>
	counts?.[kind] ?? 0

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function bookReadout(input: BookReadoutInput): ReadoutLine[] {
	const { counts } = input
	const cast = countOf(counts, CAST_KIND)
	const history = countOf(counts, HISTORY_TYPE_ID)
	const scenes = countOf(counts, SCENE_KIND)
	const places = countOf(counts, "places")

	const castDetail: string[] = []
	castDetail.push(
		input.castWithLore === 0
			? "none carry lore of their own"
			: `${input.castWithLore} carry lore of their own`
	)
	castDetail.push(
		input.relationships === 0
			? "no relationships between them"
			: `${input.relationships} ${plural(
					input.relationships,
					"relationship",
					"relationships"
				)} between them`
	)

	const sceneDetail: string[] = []
	if (scenes === 0) sceneDetail.push("nothing captured yet")
	else if (input.capturedFrom)
		sceneDetail.push(`captured from ${input.capturedFrom}`)
	if (input.scenesWaiting > 0)
		sceneDetail.push(`${input.scenesWaiting} waiting to compile`)

	return [
		{
			id: "world",
			label: "World lore",
			count: countOf(counts, WORLD_LORE_TYPE_ID),
			detail: ["places, things and rules"]
		},
		{
			id: "cast",
			label: "Cast",
			count: cast,
			detail: castDetail
		},
		{
			id: "history",
			label: "History",
			count: history,
			detail: [
				input.dated
					? `dated entries, earliest ${input.dated.earliest}, ` +
						`latest ${input.dated.latest}`
					: "nothing is dated yet"
			]
		},
		{
			id: "scenes",
			label: "Scenes",
			count: scenes,
			detail: sceneDetail
		},
		{
			id: "nested",
			label: "Nested",
			count: input.nested,
			detail: [
				input.nested === 0
					? "nothing sits inside anything else"
					: `${plural(input.nested, "entry", "entries")} ` +
						`${plural(input.nested, "sits", "sit")} inside ` +
						`another, ${input.depth} ` +
						`${plural(input.depth, "level", "levels")} deep at most`
			]
		},
		{
			id: "branches",
			label: "Lines",
			count: input.branches.length,
			detail: [branchesDetail(input.branches)]
		},
		{
			id: "places",
			label: "Places",
			count: places,
			detail: places === 0 ? ["no Location entries yet"] : []
		}
	]
}

/**
 * The lines, said out loud: main alone, or main and its branches by name.
 * `main` is implicit — a book with no branches still has one line.
 */
function branchesDetail(branches: readonly string[]): string {
	const named = branches.filter((b) => b !== "main")
	if (named.length === 0) return "main only"
	return ["main", ...named].join(", ")
}

/**
 * The lore entries' nesting, as the readout states it.
 *
 * The deepest chain, not the count of parents: a reader wants to know how far
 * down the book goes before they open it.
 */
export function nestingOf(
	rows: readonly { id: number; anchorEntryId?: number | null }[]
): { nested: number; depth: number } {
	const byId = new Map(rows.map((r) => [r.id, r]))
	let nested = 0
	let depth = 0
	for (const row of rows) {
		if (row.anchorEntryId == null || !byId.has(row.anchorEntryId)) continue
		nested++
		// Walk up to the root, stopping if the anchors form a ring: an
		// unreachable row must not hang the readout.
		const seen = new Set<number>([row.id])
		let levels = 1
		let cursor = byId.get(row.anchorEntryId)
		while (cursor && !seen.has(cursor.id)) {
			seen.add(cursor.id)
			const parentId = cursor.anchorEntryId
			if (parentId == null || !byId.has(parentId)) break
			levels++
			cursor = byId.get(parentId)
		}
		if (levels > depth) depth = levels
	}
	return { nested, depth }
}
