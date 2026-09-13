/**
 * The cast board's sentences.
 *
 * A row says who someone is and how much the book holds about them; the
 * heading says how big the cast is and what is waiting to be reviewed. Every
 * clause is a figure somebody counted, so a clause with nothing behind it is
 * left out rather than written as a zero.
 */

import type { CastKind } from "../castPool"

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

export interface CastRowFacts {
	aliases: readonly string[]
	kind: CastKind
	/** Where they stand in the world: active, deceased, missing, departed. */
	state: string
	loreCount: number
	relationshipCount: number
	/** The newest run of the attached session put them in the prompt. */
	readIn: boolean
}

/**
 * One member, in one line under their name.
 *
 * The state is the one clause that is always said, so a member the book holds
 * nothing else about still reads as a sentence rather than as a blank.
 */
export function castRowSentence(facts: CastRowFacts): string {
	const parts: string[] = [...facts.aliases]
	parts.push(facts.state.trim() || "active")
	if (facts.kind === "persona") parts.push("your persona")
	if (facts.loreCount > 0)
		parts.push(plural(facts.loreCount, "lore entry", "lore entries"))
	if (facts.relationshipCount > 0)
		parts.push(
			plural(facts.relationshipCount, "relationship", "relationships")
		)
	if (facts.readIn) parts.push("read in")
	return parts.join(" · ")
}

export interface CastHeaderFacts {
	members: number
	suggested: number
	duplicates: number
}

/** The board, said out loud above it. */
export function castHeaderLine(facts: CastHeaderFacts): string {
	const parts = [`Cast · ${plural(facts.members, "member", "members")}`]
	const review: string[] = []
	if (facts.suggested > 0) review.push(`${facts.suggested} suggested`)
	if (facts.duplicates > 0)
		review.push(
			plural(
				facts.duplicates,
				"possible duplicate",
				"possible duplicates"
			)
		)
	if (review.length) parts.push(review.join(", "))
	return parts.join(" · ")
}

export interface ReviewFacts {
	/** Names the story used that resolve to nobody. */
	suggestions: readonly string[]
	/** Pairs that may be one person. */
	duplicates: readonly (readonly [string, string])[]
}

/** What is outstanding, by name, so a decision needs no hunting. */
export function reviewLine(facts: ReviewFacts): string {
	const parts: string[] = []
	if (facts.suggestions.length) {
		parts.push(
			plural(facts.suggestions.length, "suggestion", "suggestions")
		)
		parts.push(facts.suggestions.join(", "))
	}
	if (facts.duplicates.length) {
		parts.push(plural(facts.duplicates.length, "duplicate", "duplicates"))
		parts.push(facts.duplicates.map(([a, b]) => `${a} / ${b}`).join(", "))
	}
	return parts.join(" · ")
}

/**
 * How much of a member's web has happened by the moment being read.
 *
 * Nothing is said at now, where every edge has happened: a line that always
 * reads "5 of 5" teaches nobody anything.
 */
export function relationshipsAtMomentLine(
	inStory: number,
	total: number
): string {
	if (inStory >= total) return ""
	return `Relationships at this point ${inStory} of ${total}`
}

/** The rest of a list the board only shows the head of. */
export function moreLine(hidden: number): string {
	return hidden > 0 ? `${hidden} more · show all` : ""
}

export interface CastReadInFacts {
	fired: boolean
	/** Where the run ranked them, when it recorded one. */
	rank?: number
}

/** What the newest run of the attached session did with this member. */
export function castReadInLine(facts: CastReadInFacts): string {
	if (!facts.fired) return ""
	return facts.rank == null ? "Read in" : `Read in · rank ${facts.rank}`
}
