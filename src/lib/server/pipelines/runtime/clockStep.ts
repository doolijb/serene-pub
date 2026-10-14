/**
 * 🚧 `core:task/clock-step@1` (PROPOSAL-live-scenes §6, lane D, 2026-10-13):
 * how far the story clock moves, decided — pure, no read, never the clock.
 *
 *  - *Time passes…* hands it the press's collected `step` (`input.clockStep`,
 *    already checked by the fire door), which wins over the parameters.
 *  - Chat's reply hands it nothing and reads its own parameters — **By** (0,
 *    the default, moves nothing) and **Unit** — the session setting *Each
 *    reply advances the clock by …*; `unless` (the row a regenerate, swipe
 *    or extend re-drives) keeps a re-driven reply from ticking twice.
 *
 * `moves` is what the *Advance story clock* outlet's junction reads, so a
 * step of nothing is never written and never refused.
 */
import type { Bindings } from "@serene-pub/sdk"
import { STORY_TIME_UNITS, ok, reads, type StoryTimeUnit } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { NodeInput } from "./bindingTypes"

/** What the step publishes. */
export interface ClockStepDecision {
	moves: boolean
	by: number
	unit: StoryTimeUnit
}

const whole = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v)
const unitOf = (v: unknown): StoryTimeUnit | null =>
	(STORY_TIME_UNITS as readonly unknown[]).includes(v) ? (v as StoryTimeUnit) : null

/**
 * The step decided: a collected `{ by, unit }` that reads wins; else the
 * parameters (`by` default 0, `unit` default minutes). `unless` truthy, or a
 * `by` of 0, moves nothing.
 */
export function clockStepOf(
	step: unknown,
	params: unknown,
	unless?: unknown
): ClockStepDecision {
	const p = (params ?? {}) as { by?: unknown; unit?: unknown }
	const s = (step ?? null) as { by?: unknown; unit?: unknown } | null
	const collected =
		s && typeof s === "object" && whole(s.by) && unitOf(s.unit) ? s : null
	const by = collected ? (collected.by as number) : whole(p.by) ? p.by : 0
	const unit = (collected ? unitOf(collected.unit) : unitOf(p.unit)) ?? "minutes"
	const held = Array.isArray(unless)
		? unless.length > 0
		: unless !== undefined && unless !== null && unless !== false && unless !== 0 && unless !== ""
	return { moves: !held && by !== 0, by, unit }
}

export function clockStepBindings(): Bindings {
	return {
		"core:task/clock-step@1": reads<typeof C.clockStep>(
			async (input: NodeInput<typeof C.clockStep>) => {
				const decided = clockStepOf(
					input?.step,
					(input as { params?: unknown })?.params,
					input?.unless
				)
				return ok({ main: decided, ...decided })
			},
			{ ports: ["step", "unless"], params: ["by", "unit"] }
		)
	}
}
