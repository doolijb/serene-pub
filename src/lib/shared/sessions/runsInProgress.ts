/**
 * 🚧 **Runs that hold re-run and remove actions** (programme 0.9, owner
 * 2026-11-16: "the button would still be disabled. But have the user manually
 * stop what ever is running first"). Pure, and shared by both sides: the
 * server's door refuses with this sentence, the page greys the same buttons
 * with it, so the two cannot disagree.
 *
 * A run holds swipe, regenerate, retake, Back and delete while it is a
 * registered run of the session (`since` is set) of kind `reply`, `action` or
 * `routine`, executing or waiting for a model. A run parked at review does not
 * hold them, nor does a line-bound run (speaking one line, shown on that line
 * only). Edit, Forward, sending a line and Continue are never held here.
 *
 * R13 (2026-10-20, "a routine never makes the session busy") still rules
 * everything else: a routine never makes the session generating, never greys
 * Send, and never holds a person's line.
 */

/** The run kinds that hold re-run and remove actions while in flight. */
export const RUN_KINDS_HOLDING_RERUNS: readonly string[] = ["reply", "action", "routine"]

/** Does this run hold re-run and remove actions? */
export function runHoldsReruns(run: {
	kind: string
	since?: number | null
	lineBound?: boolean | null
	parked?: boolean | null
}): boolean {
	return (
		run.since != null &&
		RUN_KINDS_HOLDING_RERUNS.includes(run.kind) &&
		run.lineBound !== true &&
		run.parked !== true
	)
}

/** 🚧 The one sentence a held action is refused and greyed with. */
export function waitForRunSentence(name: string): string {
	return `Wait for ${name} to finish, or stop it first.`
}

/** 🚧 The words a holding run shows when it has none of its own. */
export const RUN_WORKING_WORDS = "working"

/** 🚧 The name a reply run is shown by in that sentence. */
export const REPLY_RUN_NAME = "the reply"
