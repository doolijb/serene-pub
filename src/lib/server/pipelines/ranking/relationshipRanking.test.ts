/**
 * Presence, then speaker, then recency — as an order, not as three weights that
 * happen to add up.
 *
 * The ruling (2026-09-10, Q1) is **lexicographic**: a tie the scene is present
 * for outranks one it is not, whatever either changed; among ties the scene is
 * equally present for, the speaker's own outranks a bystander's; and only then
 * does recency decide. Three weights summed are the obvious implementation and
 * the wrong one — any weighting where the lower terms can outvote the higher
 * turns "presence first" into "presence mostly", and the case that exposes it
 * is the one nobody writes a fixture for: an absent character whose tie is the
 * speaker's own and was changed a minute ago.
 *
 * So the cases below are the *crossings*, not the happy path: each fixes the
 * higher term and moves everything under it as far as it can go.
 */

import { describe, it, expect } from "vitest"
import {
	rankRelationships,
	type RelationshipRankRow
} from "$lib/server/pipelines/ranking/relationshipRanking"

const HOUR = 3_600_000
const now = 1_760_000_000_000

const row = (
	id: number,
	over: Partial<RelationshipRankRow> = {}
): RelationshipRankRow => ({
	id,
	present: false,
	touchesSpeaker: false,
	updatedAt: now,
	...over
})

const order = (rows: RelationshipRankRow[]) =>
	rankRelationships(rows).map((r) => r.id)

describe("relationship ranking", () => {
	it("puts a tie the scene is present for above one it is not", () => {
		expect(
			order([row(1), row(2, { present: true })])
		).toEqual([2, 1])
	})

	it("keeps presence above the speaker and recency combined", () => {
		// The crossing. Row 2 is present and nothing else; row 1 is the
		// speaker's own and the newest thing in the graph. Presence still wins.
		expect(
			order([
				row(1, { touchesSpeaker: true, updatedAt: now }),
				row(2, { present: true, updatedAt: now - 1000 * HOUR })
			])
		).toEqual([2, 1])
	})

	it("puts the speaker's own tie above a bystander's, presence being equal", () => {
		expect(
			order([
				row(1, { present: true }),
				row(2, { present: true, touchesSpeaker: true })
			])
		).toEqual([2, 1])
	})

	it("keeps the speaker above recency", () => {
		expect(
			order([
				row(1, { present: true, updatedAt: now }),
				row(2, {
					present: true,
					touchesSpeaker: true,
					updatedAt: now - 1000 * HOUR
				})
			])
		).toEqual([2, 1])
	})

	it("orders by recency once presence and speaker agree", () => {
		expect(
			order([
				row(1, { present: true, updatedAt: now - 2 * HOUR }),
				row(2, { present: true, updatedAt: now }),
				row(3, { present: true, updatedAt: now - HOUR })
			])
		).toEqual([2, 3, 1])
	})

	/**
	 * Two rows the graph changed in the same transaction have the same
	 * timestamp, which is the common case rather than a corner: a rebuild
	 * writes them together. An order that depended on which one the database
	 * returned first would make the receipt unreproducible.
	 */
	it("breaks a timestamp tie by row id, so a replay ranks the same", () => {
		expect(order([row(9), row(3), row(5)])).toEqual([3, 5, 9])
		expect(order([row(5), row(9), row(3)])).toEqual([3, 5, 9])
	})

	it("reports what decided, per row", () => {
		const [first] = rankRelationships([
			row(1, { present: true, touchesSpeaker: true }),
			row(2)
		])
		expect(first.rank).toEqual({
			present: true,
			touchesSpeaker: true,
			recencyRank: 1,
			of: 2
		})
	})

	/** `select` reads `position` as its tie-break, so the arm has to fill it. */
	it("numbers the rows in the order it ranked them", () => {
		expect(
			rankRelationships([row(1), row(2, { present: true })]).map(
				(r) => r.position
			)
		).toEqual([0, 1])
	})

	it("scores nothing below zero and nothing above one", () => {
		for (const r of rankRelationships([
			row(1, { present: true, touchesSpeaker: true }),
			row(2)
		])) {
			expect(r.score).toBeGreaterThan(0)
			expect(r.score).toBeLessThanOrEqual(1)
		}
	})

	it("has nothing to rank when the graph is empty", () => {
		expect(rankRelationships([])).toEqual([])
	})
})
