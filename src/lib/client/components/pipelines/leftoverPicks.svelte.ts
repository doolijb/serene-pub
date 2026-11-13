/**
 * Leftover picks for one pipeline panel (variable layouts, W4): the
 * per-step layout choices the upgrade could not fold away, and the two things
 * an administrator can do with them — *Remove this pick* (drop one) and *Move
 * into the template* (name them in the step's template).
 *
 * Call during the panel's initialisation: the interest declarations are
 * `$effect`s. Every key is BARE — none of these events is scoped — so every
 * answer and `:error` first checks its echo is this view's: the server
 * echoes `slug`, `sessionId` and `presetId` as sent, and this view sends no
 * `presetId`, so one echoed means another view's.
 *
 * The echo does not say which step's press it answers. Presses are answered
 * in the order they were sent, so each answer or `:error` that is this
 * view's belongs to the oldest press still pending, and an `:error` with
 * nothing pending belongs to no one here. Refusals are kept for the component to show in words; this
 * never toasts (the shell's catch-all keeps these `:error`s quiet).
 */
import { SvelteMap } from "svelte/reactivity"
import { useInterest } from "$lib/client/sockets/interest.svelte"
import { useTypedSocket } from "$lib/client/sockets/typedSocket"

type Step = Sockets.Pipelines.LeftoverPicks.Step
type Pick = Sockets.Pipelines.LeftoverPicks.Pick

export interface LeftoverStepState {
	refusal?: string
	/** The refusal was "has no reference yet": say whose name to file it under. */
	needsOwner: boolean
	/** Picks the last successful move left in place, and why. */
	kept: { key: string; why: string }[]
	/** An action on this step is awaiting its answer. */
	busy: boolean
}

interface Opts {
	slug: () => string
	sessionId: () => number | undefined
	enabled: () => boolean
	/** After a successful move: the template changed, so the host re-reads the view. */
	onMoved?: () => void
}

export const leftoverStepKey = (step: Pick | Step) =>
	`${step.stepKey}\u0000${step.slot}`

export function useLeftoverPicks(opts: Opts) {
	const socket = useTypedSocket()
	let steps = $state<Step[]>([])
	const states = new SvelteMap<string, Omit<LeftoverStepState, "busy">>()
	/** Step keys of presses sent and not yet answered, oldest first. */
	let pending = $state<string[]>([])

	const patch = (
		key: string,
		next: Partial<Omit<LeftoverStepState, "busy">>
	) => {
		states.set(key, {
			needsOwner: false,
			kept: [],
			...states.get(key),
			...next
		})
	}
	const settleOldest = () => {
		const key = pending[0]
		pending = pending.slice(1)
		return key
	}

	/** Whether an answer or refusal echoes this view's request. */
	const mine = (
		res:
			| { slug?: string; sessionId?: number; presetId?: number }
			| undefined
	) =>
		res?.slug === opts.slug() &&
		res.sessionId === opts.sessionId() &&
		res.presetId == null

	const onList = (res: Sockets.Pipelines.LeftoverPicks.Response) => {
		if (!mine(res)) return
		steps = res.steps ?? []
	}
	const onCleared = (res: Sockets.Pipelines.ClearLeftoverPick.Response) => {
		if (!mine(res)) return
		steps = res.steps ?? []
		settleOldest()
	}
	const onMovedAnswer = (
		res: Sockets.Pipelines.MoveLeftoversIntoTemplate.Response
	) => {
		if (!mine(res)) return
		steps = res.steps ?? []
		const key = settleOldest()
		if (key)
			patch(key, {
				refusal: undefined,
				needsOwner: false,
				kept: res.kept ?? []
			})
		opts.onMoved?.()
	}
	const onRefused = (
		res: Sockets.Pipelines.MoveLeftoversIntoTemplate.Refusal
	) => {
		if (!mine(res) || !pending.length) return
		const key = settleOldest()
		const error = res?.error
		if (key && error)
			patch(key, {
				refusal: error,
				needsOwner: res.code === "needs-owner-slug",
				kept: []
			})
	}

	useInterest<"pipelines:leftoverPicks">("pipelines:leftoverPicks", onList)
	useInterest<"pipelines:clearLeftoverPick">(
		"pipelines:clearLeftoverPick",
		onCleared
	)
	useInterest<"pipelines:moveLeftoversIntoTemplate">(
		"pipelines:moveLeftoversIntoTemplate",
		onMovedAnswer
	)
	useInterest<"pipelines:leftoverPicks:error">(
		"pipelines:leftoverPicks:error",
		onRefused
	)
	useInterest<"pipelines:clearLeftoverPick:error">(
		"pipelines:clearLeftoverPick:error",
		onRefused
	)
	useInterest<"pipelines:moveLeftoversIntoTemplate:error">(
		"pipelines:moveLeftoversIntoTemplate:error",
		onRefused
	)

	return {
		get steps() {
			return steps
		},
		refresh() {
			if (!opts.enabled()) return
			socket.emit("pipelines:leftoverPicks", {
				slug: opts.slug(),
				sessionId: opts.sessionId()
			})
		},
		clear(step: Step, pick: Pick) {
			const key = leftoverStepKey(step)
			if (pending.includes(key)) return
			patch(key, { refusal: undefined, needsOwner: false })
			pending = [...pending, key]
			socket.emit("pipelines:clearLeftoverPick", {
				slug: opts.slug(),
				scope: pick.scope,
				stepKey: pick.stepKey,
				slot: pick.slot,
				key: pick.key,
				sessionId: opts.sessionId()
			})
		},
		move(step: Step, ownerSlug?: string) {
			const key = leftoverStepKey(step)
			if (pending.includes(key)) return
			patch(key, { refusal: undefined, needsOwner: false, kept: [] })
			pending = [...pending, key]
			socket.emit("pipelines:moveLeftoversIntoTemplate", {
				slug: opts.slug(),
				stepKey: step.stepKey,
				slot: step.slot,
				...(ownerSlug ? { ownerSlug } : {}),
				sessionId: opts.sessionId()
			})
		},
		/** A step's refusal, owner prompt, kept lines and busy flag. */
		stateOf(step: Step): LeftoverStepState {
			const key = leftoverStepKey(step)
			return {
				needsOwner: false,
				kept: [],
				...states.get(key),
				busy: pending.includes(key)
			}
		}
	}
}
