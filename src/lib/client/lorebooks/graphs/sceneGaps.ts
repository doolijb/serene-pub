/**
 * Scenes the graph is silent about.
 *
 * A scene records who was in it; an edge records what passed between two of
 * them. Where a scene has a cast and the graph names nothing between any pair
 * of it, the story happened and the book did not keep it — which is a prompt
 * to the writer, not a fault to repair automatically.
 *
 * Scene cast is binding ids, so this is a question about cast members only: an
 * entry is never in a scene's cast, and a pair with an entry on one side is not
 * something a scene could have named.
 */

import type { EndpointLike } from "./graphModel"

/** A scene, as little of it as the gap count needs. */
export interface SceneCastRow {
	id: number
	name?: string | null
	participantCharacters: number[]
}

/** An edge, as little of it as the pairing needs. */
export interface PairEdgeLike {
	id: number
	from: EndpointLike
	to: EndpointLike
}

/** Unordered: a pair is the same pair whichever way an edge points. */
export const castPairKey = (a: number, b: number): string =>
	`${Math.min(a, b)}-${Math.max(a, b)}`

/** Every pair of members the graph already names something between. */
export function edgedCastPairs(
	relationships: readonly PairEdgeLike[]
): Set<string> {
	const pairs = new Set<string>()
	for (const rel of relationships) {
		if (rel.from.kind !== "cast" || rel.to.kind !== "cast") continue
		pairs.add(castPairKey(rel.from.bindingId, rel.to.bindingId))
	}
	return pairs
}

/** Every unordered pair among a scene's cast. */
function pairsOf(participants: readonly number[]): [number, number][] {
	const unique = [...new Set(participants)]
	const out: [number, number][] = []
	for (let i = 0; i < unique.length; i++)
		for (let j = i + 1; j < unique.length; j++)
			out.push([unique[i], unique[j]])
	return out
}

/**
 * Scenes whose cast the graph names nothing about.
 *
 * A scene with nobody to pair is left out rather than counted: one person in a
 * room names nothing because there is nothing to name.
 */
export function scenesNamingNone(
	scenes: readonly SceneCastRow[],
	edged: ReadonlySet<string>
): number {
	let count = 0
	for (const scene of scenes) {
		const pairs = pairsOf(scene.participantCharacters)
		if (pairs.length === 0) continue
		if (pairs.every(([a, b]) => !edged.has(castPairKey(a, b)))) count++
	}
	return count
}

/** Somebody the open member shares a room with, and where. */
export interface UnnamedPair {
	otherId: number
	sceneIds: number[]
}

/** Who the open member has been in a room with and nothing was written down. */
export function unnamedPairsFor(
	castId: number,
	scenes: readonly SceneCastRow[],
	edged: ReadonlySet<string>
): UnnamedPair[] {
	const byOther = new Map<number, number[]>()
	for (const scene of scenes) {
		if (!scene.participantCharacters.includes(castId)) continue
		for (const other of new Set(scene.participantCharacters)) {
			if (other === castId) continue
			if (edged.has(castPairKey(castId, other))) continue
			const list = byOther.get(other) ?? []
			list.push(scene.id)
			byOther.set(other, list)
		}
	}
	return [...byOther.entries()].map(([otherId, sceneIds]) => ({
		otherId,
		sceneIds
	}))
}

/** How many times over, said the way a reader counts. */
function times(count: number): string {
	if (count <= 1) return ""
	return count === 2 ? " twice" : ` ${count} times`
}

/** The ask: read the scene, and name what passed between them. */
export function notDrawnSentence(
	a: string,
	b: string,
	sceneCount: number
): string {
	return `A scene puts ${a} and ${b} in the same room${times(
		sceneCount
	)} without naming what passed between them. Read it and name one`
}
