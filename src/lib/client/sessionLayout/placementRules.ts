/**
 * Free placement's OPEN owner question QE (layout plan M.7), answered with
 * the plan's RECOMMENDED default and kept here so it flips in one line.
 * Brief 7a, 2026-09-29. (QF, an empty middle, is settled: the middle is never
 * empty — `arrangeOps.MIDDLE_EMPTY`. The primary is a place any panel can be
 * moved into, and nothing locks the conversation in it — PLAN-session-panels
 * 2026-10-14 §10.)
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
 */
import { primaryLogOf } from "./channelClaims"

/** QE: `true` = (1) the conversation is the stage; `false` = (2) literal. */
export const STAGE_FOLLOWS_CONVERSATION = true



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
 *
 * With NO conversation placed (R-B, owner review 2026-10-14 — a layout may
 * hold none) the stage is the primary panel, whatever it holds (`middle` is
 * its tabs); with nothing in the middle either, the first panel drawn in a
 * side — so the phone and Stage only never draw an empty page.
 */
export function stageOf(o: StageInput): StagePick | null {
	const log = STAGE_FOLLOWS_CONVERSATION
		? primaryLogPick(o)
		: (() => {
				const id = primaryLogOf(o.middle, o.claims, o.primaryId)
				return id ? { id, zone: "middle" as const } : null
			})()
	if (log) return log
	// A conversation placed in a side is still the log under (2): it is not
	// the stage, and the middle is drawn as it is.
	if (!STAGE_FOLLOWS_CONVERSATION && primaryLogPick(o)) return null
	if (o.middle[0]) return { id: o.middle[0], zone: "middle" }
	if (o.left[0]) return { id: o.left[0], zone: "left" }
	if (o.right[0]) return { id: o.right[0], zone: "right" }
	return null
}

/**
 * The layout's primary log and the zone holding it, wherever it sits —
 * whatever QE says. QE decides what the phone and Stage only DRAW; this is
 * where the log IS, which the desktop needs either way: a side holding it
 * neither tucks nor folds to an icon (`SessionLayout`'s `logSide`).
 */
export function primaryLogPick(o: StageInput): StagePick | null {
	const id = primaryLogOf([...o.middle, ...o.left, ...o.right], o.claims, o.primaryId)
	if (!id) return null
	const zone: StageZone = o.middle.includes(id)
		? "middle"
		: o.left.includes(id)
			? "left"
			: "right"
	return { id, zone }
}

