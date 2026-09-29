/**
 * Free placement's two OPEN owner questions (layout plan M.7, QE and QF),
 * answered with the plan's RECOMMENDED defaults and kept here, together, so
 * either flips in one line. Brief 7a, 2026-09-29.
 *
 * ⚠ Provisional until the owner rules. Flip a constant below and the page
 * follows; the tests in ./placementRules.test.ts say which way each is set.
 *
 * **QE — when the conversation is not in the middle, what do the phone and
 * Stage only show?** Recommended (1): *the conversation is the stage.* The
 * phone's centre and Stage only draw the first primary log full width,
 * wherever the desktop placed it; on the phone the middle's other widgets join
 * the panels menu ("Middle"), and the log's own side does not list it.
 * (2) *Literal:* both draw the middle, and a conversation placed in a side is
 * reached through the panels menu — Stage only hides it with the sides.
 *
 * **QF — may the middle be left empty?** Recommended (1): *no — Done refuses*
 * with {@link EMPTY_MIDDLE_REFUSAL}, on the phone editor too. (2) would draw
 * blank space between the rails; (3), a collapsing middle, is a larger change
 * than this plan and is not offered here.
 */
import { primaryLogOf } from "./channelClaims"

/** QE: `true` = (1) the conversation is the stage; `false` = (2) literal. */
export const STAGE_FOLLOWS_CONVERSATION = true

/** QF: `true` = (1) Done refuses an empty middle; `false` = (2) it may stay empty. */
export const REFUSE_EMPTY_MIDDLE = true

/** QF (1)'s refusal, word for word from the plan. */
export const EMPTY_MIDDLE_REFUSAL = "Put a widget in the middle, or move one back."

export type StageZone = "left" | "middle" | "right"

/** Where the stage is: the widget instance drawn as the stage, and its zone. */
export interface StagePick {
	id: string
	zone: StageZone
}

export interface StageInput {
	/** Each zone's placed ids, in reading order (by row, then by column). */
	middle: readonly string[]
	left: readonly string[]
	right: readonly string[]
	/** Placed conversation copy → the channel it claims (./channelClaims). */
	claims: ReadonlyMap<string, string>
	/** The genre's primary widget: `messages`, or an R71 genre's own. */
	primaryId: string
}

/**
 * The stage for the phone and Stage only (QE), or null when nothing is drawn
 * as one — which leaves the middle exactly as it is drawn, hiding nothing.
 *
 * Under (1) it is the layout's primary log (`primaryLogOf`: the first
 * unclaimed instance of the primary in reading order, else the first
 * instance), in whichever zone holds it. Under (2) it is that log only when
 * the middle holds it; a log in a side is not the stage.
 */
export function stageOf(o: StageInput): StagePick | null {
	if (!STAGE_FOLLOWS_CONVERSATION) {
		const id = primaryLogOf(o.middle, o.claims, o.primaryId)
		return id ? { id, zone: "middle" } : null
	}
	const id = primaryLogOf([...o.middle, ...o.left, ...o.right], o.claims, o.primaryId)
	if (!id) return null
	const zone: StageZone = o.middle.includes(id)
		? "middle"
		: o.left.includes(id)
			? "left"
			: "right"
	return { id, zone }
}

/**
 * QF: what Done says when the middle it would commit places nothing, or null
 * when Done may go ahead. `middle` is the middle's membership as Done would
 * commit it (the arrangement's middle frame, else the grid's middle).
 */
export function emptyMiddleRefusal(middle: readonly string[]): string | null {
	if (!REFUSE_EMPTY_MIDDLE) return null
	return middle.length ? null : EMPTY_MIDDLE_REFUSAL
}
