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
	/** The run finished. A client clears its state on this or on `error`. */
	done?: boolean
	/** The run failed, with something a person can act on. */
	error?: string
	/** The run was stopped on request, as opposed to failing. */
	cancelled?: boolean
}
