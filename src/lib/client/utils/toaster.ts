/**
 * The app's one toast store, configured (STYLE-GUIDE §6.21; PLAN-0-5-polish-
 * parity L4.4, 2026-10-24).
 *
 * Skeleton's `createToaster()` is zag's store, whose defaults are 5s for an
 * error or a warning and 2s for a success. A refusal read in 5s is often
 * not read at all, and a success that vanishes in 2s is a flicker; so every
 * toast gets the durations below unless its caller names one. The store's
 * own `duration` option is one number for every type, which is why the
 * typed helpers are wrapped instead of configured.
 *
 * New code raises toasts through `notify` (`./notify`), which adds the rules
 * that decide WHETHER to toast at all — a source key so repeats replace one
 * another, `silent` for a state the control already shows, `fromPoll` for a
 * background ask nobody pressed for. This module only decides for how long.
 *
 * ⚠ The wrapper keeps the store's shape (it is spread, and zag's methods are
 * closures, not `this` calls), so `<Toast.Group {toaster}>` and every
 * existing `toaster.error(...)` keep working unchanged.
 */
import { createToaster } from "@skeletonlabs/skeleton-svelte"

/** How long a toast stays, by type, unless its caller says otherwise. */
export const TOAST_DURATION_MS = {
	error: 8000,
	warning: 8000,
	success: 4000,
	info: 4000
} as const

type TimedType = keyof typeof TOAST_DURATION_MS

const store = createToaster()

type Store = typeof store
type ToastOptions = Parameters<Store["create"]>[0]

function isTimed(type: unknown): type is TimedType {
	return typeof type === "string" && type in TOAST_DURATION_MS
}

function timed(type: TimedType, data: ToastOptions): ToastOptions {
	return {
		...data,
		type,
		duration: data.duration ?? TOAST_DURATION_MS[type]
	}
}

export const toaster: Store = {
	...store,
	create: (data) =>
		store.create(isTimed(data.type) ? timed(data.type, data) : data),
	error: (data) => {
		store.create(timed("error", data))
	},
	warning: (data) => {
		store.create(timed("warning", data))
	},
	success: (data) => {
		store.create(timed("success", data))
	},
	info: (data) => {
		store.create(timed("info", data))
	}
}
