/**
 * The schedule tick: `core:event/schedule-tick@1`, emitted once an hour.
 *
 * The SDK points scheduled work here (`SCHEDULED_WORK_PATH`): a lifecycle
 * callback may not call a Provider or trigger a pipeline, so a plugin that
 * wants to do something on a cadence subscribes an event listener to this
 * event — which also puts it on the consent screen as an `event:` permission.
 *
 * One cadence, `hourly`: the event's payload is `{ cadence, scheduledFor,
 * scope }` — the cadence that elapsed, the instant it was due (ISO 8601), and
 * `pub`, because the tick belongs to no session or user. A listener that
 * wants daily work keeps the last day it ran in its own storage and compares;
 * that state is the plugin's, and the tick keeps none.
 *
 * Delivered through the one event registry (`eventHost`), so it reaches only
 * enabled plugins that subscribe and whose `event:` permission an admin left
 * granted, with the registry's fan-out budget and isolation. An hour with no
 * subscriber emits nothing. Started by `bootstrapPlugins` and stopped by
 * `shutdownPlugins`; the timer never holds the process open.
 */
import { SCHEDULED_WORK_PATH } from "@serene-pub/sdk"

export const SCHEDULE_TICK_EVENT = SCHEDULED_WORK_PATH.instead
export const SCHEDULE_TICK_INTERVAL_MS = 60 * 60 * 1000

/** What a subscriber is sent as the event's payload. */
export interface ScheduleTickPayload {
	cadence: "hourly"
	/** The instant the tick was due, ISO 8601. */
	scheduledFor: string
	scope: "pub"
}

export interface ScheduleTickDeps {
	/** How many subscribers the event has right now. */
	subscribers: () => number
	/** Deliver one occurrence; never rejects (the registry's `notify`). */
	notify: (payload: ScheduleTickPayload, nowMs: number) => Promise<unknown>
	intervalMs?: number
	now?: () => number
}

/** Start the tick. Returns the stop function; calling it twice is harmless. */
export function startScheduleTick(deps: ScheduleTickDeps): () => void {
	const intervalMs = deps.intervalMs ?? SCHEDULE_TICK_INTERVAL_MS
	const now = deps.now ?? Date.now
	// Due on the interval's grid, so "the 14:00 tick" means the same instant
	// on every instance and across a restart.
	let due = Math.ceil(now() / intervalMs) * intervalMs
	let timer: ReturnType<typeof setTimeout> | undefined
	let stopped = false
	const arm = () => {
		if (stopped) return
		timer = setTimeout(fire, Math.max(0, due - now()))
		timer.unref?.()
	}
	const fire = async () => {
		const scheduledFor = due
		due += intervalMs
		try {
			if (deps.subscribers() > 0)
				await deps.notify(
					{ cadence: "hourly", scheduledFor: new Date(scheduledFor).toISOString(), scope: "pub" },
					scheduledFor
				)
		} catch (e) {
			console.warn("[plugins] schedule tick failed:", e)
		}
		arm()
	}
	arm()
	return () => {
		stopped = true
		if (timer) clearTimeout(timer)
	}
}
