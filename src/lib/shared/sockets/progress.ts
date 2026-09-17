/**
 * What a long-running job reports while it runs.
 *
 * One shape, not one per feature. The codebase already had two conventions for
 * this — an `X:progress`/`X:complete`/`X:error` triple for scene processing and
 * graph builds, and a full-state `{downloaded, total, isDone}` for downloads —
 * and a third for image generation would have made three, each with its own
 * client store and its own idea of what "done" means.
 *
 * `runId` is what makes cancellation possible: a progress event a client cannot
 * name is one it cannot stop.
 */

import type { ConnectionIdentity } from "$lib/shared/connections/identity"
import type { StatusText } from "@serene-pub/sdk"

export interface RunProgress {
	/** Identifies the run, for cancelling it and for keying client state. */
	runId: string
	sessionId?: number
	/** Which spec is running, when a pipeline is what started this. */
	specId?: string
	/** Which node inside it, so a multi-step run reads as steps rather than one bar. */
	nodeKey?: string
	/** What to call this on screen. */
	label?: string
	/**
	 * Where it has got to, in the job's own vocabulary ("queued", "sampling",
	 * "decoding"). Free text rather than an enum because a stage is a fact about
	 * one kind of work, and a union big enough to cover every kind would be a
	 * union nothing could switch on usefully.
	 */
	stage?: string
	/**
	 * What the run says it is doing (R-19): the last status a node set —
	 * *{speaker} is typing*, *summarising part 2 of 5* — as a locale map with
	 * its variables filled; the client resolves the language. Shown in place
	 * of the stage-count text when present. Absent on a frame that carries no
	 * change of status; a status once sent stands until the next.
	 */
	status?: StatusText | null
	/** 0–100. Absent means the job cannot say — show an indeterminate bar, not 0%. */
	percent?: number
	step?: number
	steps?: number
	etaSec?: number
	/**
	 * A partial result, for jobs that can show their work — a half-denoised image.
	 * Transient by construction: it travels to the screen and is never stored.
	 */
	preview?: { base64: string; mime: string }
	message?: string
	/**
	 * Which connection this step is about.
	 *
	 * A FIELD, because the sentence beside it must not name one: an image model
	 * is a path on the administrator's disk, and this event fans out to everyone
	 * watching the session. `withoutConnectionIdentity` removes the key at every
	 * egress, so an administrator's client can render "Loading sd-1.5" and
	 * nobody else's is even told there is a connection.
	 */
	connection?: ConnectionIdentity
	/** The run finished. A client clears its state on this or on `error`. */
	done?: boolean
	/** The run failed, with something a person can act on. */
	error?: string
	/** The run was stopped on request, as opposed to failing. */
	cancelled?: boolean
	/**
	 * How the run ended, precisely — the terminal frame's own word for what
	 * `done` alone cannot say (a run that halted or errored also sets
	 * `done: true`, and a checkmark on either is a defect: "Progress card
	 * says 'Respond finished' on an errored run"). `ok` — finished and wrote
	 * its result. `halt` — stopped at a node that said stop, legibly (`error`
	 * carries why, `haltNodeKey` where). `err` — failed (`error` carries the
	 * reason, when one is safe to show). `cancelled` — a person or an admin
	 * stopped it.
	 *
	 * Present only on the terminal frame, from the two callers that build
	 * one today (the reply road, an action's `triggerFunction` run). A
	 * future `pipelines:progress` emitter that has not set it yet still
	 * reaches a sane reading — a client falls back to `done` + `error` +
	 * `cancelled` as three flags when this is absent. Image generation is
	 * NOT such a caller: it is a different wire event (`images:progress`),
	 * read by a different component, and never reaches this fallback at all.
	 */
	outcome?: "ok" | "halt" | "err" | "cancelled"
	/** Which node halted the run, when `outcome` is `"halt"`. */
	haltNodeKey?: string
}
