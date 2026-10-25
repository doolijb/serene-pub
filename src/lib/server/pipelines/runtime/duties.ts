/**
 * 🚧 **Duties** (PLAN-layering §4, R5, R37; 2026-10-20) — what a duties step
 * (`core:task/reply-duties@1`, `reckoning-duties@1`, `sweep-duties@1`)
 * publishes: each duty's switch, at the routine's mode. Pure; the bindings
 * and the host doors that read a routine's duties (`routines/sessionRoutines.ts`)
 * share it.
 */
import * as C from "@serene-pub/contracts"

/**
 * 🚧 The mode keys a duties step publishes, by contract — the names the
 * steps that read them use (`reckon.ts`, the reply's retrieval junction).
 * A param not listed here publishes under its kebab-case name.
 */
const DUTY_MODE_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	// 🚧 `changes` (D7, 2026-10-23): *Replies carry changes* — the reply's junction reads `reply-changes`.
	[C.replyDuties.id]: { lore: "lore-retrieval", scene: "scene-reading", changes: "reply-changes" }
}

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** 🚧 The duties contracts core binds — their ids, from the contracts (never spelled). */
const DUTIES_CONTRACTS: ReadonlySet<string> = new Set([C.replyDuties.id, C.reckoningDuties.id, C.sweepDuties.id])

/** 🚧 Is this definition (`<id>@<version>`) a duties step? */
export const isDutiesContract = (definition: string): boolean => DUTIES_CONTRACTS.has(definition)

/**
 * 🚧 **What a reply that carries changes takes over** (PLAN-genres-seams S2,
 * ★B, 2026-10-23), by the duties contract that cedes: while the session's
 * reply carries changes at Full (*Replies carry changes*, the reply's
 * `changes` duty), the reckoning's *Keep the sheets* and *Track conditions*
 * read Off — the reply already filed what the scene changed, and the
 * reckoning reading the same lines would count it twice. *Move the clock*,
 * *Describe new places* and *End what runs out* stay. Keyed by param, as the
 * contract declares them.
 */
export const CEDES_TO_REPLY_CHANGES: Readonly<Record<string, readonly string[]>> = {
	[C.reckoningDuties.id]: ["attributes", "conditions"]
}

/** 🚧 Why a ceded duty reads Off — on the duties step's output, so the receipt says it (S2). */
export const CEDED_TO_REPLY_CHANGES = "off: replies carry changes"

/**
 * 🚧 What the host knows of the session beside a duties step's own params
 * (S2): the mode the session's reply carries changes at — `full` while its
 * `changes` duty is on (an event registration carries no mode, R37), `off`
 * otherwise or unknown.
 */
export interface DutyFacts {
	replyChanges?: "full" | "review" | "off"
}

/**
 * 🚧 A duties step's output (lane 3's contract, PLAN-layering §4): each duty's
 * key → `off` when its switch is off, else the routine's mode (`full` when
 * the step is not on a routine, or the routine names none). `any` is true
 * when some duty is on and the routine itself is not Off.
 *
 * 🚧 With `facts` (S2): a duty that cedes to a reply carrying changes
 * (`CEDES_TO_REPLY_CHANGES`) reads Off while `facts.replyChanges` is
 * `full`, and `main.ceded` says why, by the mode key (`{ attributes: "off:
 * replies carry changes" }`). The host's doors (`sessionDutiesOf` — the
 * ruleset handler's expiry) read the duties as set, never ceded: what runs
 * out still runs out.
 */
export function dutyModes(
	contract: string,
	params: unknown,
	routine: unknown,
	facts: DutyFacts = {}
): {
	main: { modes: Record<string, "full" | "review" | "off">; any: boolean; ceded?: Record<string, string> }
	modes: Record<string, "full" | "review" | "off">
	any: boolean
} {
	const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>
	const rawMode = (routine as { mode?: unknown } | null | undefined)?.mode
	const on: "full" | "review" | "off" =
		rawMode === "review" || rawMode === "off" ? rawMode : "full"
	const names = DUTY_MODE_KEYS[contract] ?? {}
	const cedes = facts.replyChanges === "full" ? new Set(CEDES_TO_REPLY_CHANGES[contract] ?? []) : new Set<string>()
	const modes: Record<string, "full" | "review" | "off"> = {}
	const ceded: Record<string, string> = {}
	for (const [key, value] of Object.entries(p)) {
		const named = names[key] ?? kebab(key)
		if (value === true && cedes.has(key)) {
			modes[named] = "off"
			ceded[named] = CEDED_TO_REPLY_CHANGES
		} else modes[named] = value === true ? on : "off"
	}
	const any = on !== "off" && Object.values(modes).some((m) => m !== "off")
	const said = Object.keys(ceded).length ? { ceded } : {}
	return { main: { modes, any, ...said }, modes, any }
}
