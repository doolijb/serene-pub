import { browser } from "$app/environment"
import { replaceState } from "$app/navigation"
import { page } from "$app/state"
import { untrack } from "svelte"
import {
	emptyRoute,
	fromHash,
	reduce,
	sameRoute,
	toHash,
	type LoreAction,
	type LoreRoute
} from "$lib/shared/lorebooks/loreRoute"

/**
 * The lorebook workspace's route, held once and mirrored to the URL fragment.
 *
 * Every transition the user can make goes through `navigate`, which is the one
 * place that asks whether there are unsaved changes. Arrivals — the hash the
 * workspace opens on, a deep link from another panel — go through `set`,
 * because a guard belongs to the screen being left and there is none to leave.
 * A hash changed by hand while the workspace is open is a transition, and is
 * guarded (`attachHash`).
 */
class LoreRouteStore {
	#route = $state<LoreRoute>(emptyRoute())
	#unsaved: (() => boolean) | null = null
	/** The transition a confirmation is currently open for; one at a time. */
	#pending = $state<{ resolve: (leave: boolean) => void } | null>(null)

	get route(): LoreRoute {
		return this.#route
	}

	/** True while the discard-changes confirmation is open. */
	get confirming(): boolean {
		return this.#pending !== null
	}

	/**
	 * The workspace registers whatever manager is mounted. Returns the
	 * unregister, which only clears the seam if it is still this one's.
	 *
	 * ⚠ The callback must read state, never a `$derived`: it is held here
	 * across the registering component's whole life and is called from outside
	 * it, and a derived read outside the effect that owns it is inert.
	 */
	registerUnsavedChanges(fn: () => boolean): () => void {
		this.#unsaved = fn
		return () => {
			if (this.#unsaved === fn) this.#unsaved = null
		}
	}

	hasUnsavedChanges(): boolean {
		return !!this.#unsaved?.()
	}

	/**
	 * Resolves true when the current screen can be left. The panel's own close
	 * gate shares this, so closing the panel and moving inside it ask once, in
	 * the same words.
	 */
	confirmLeave(): Promise<boolean> {
		if (!this.hasUnsavedChanges()) return Promise.resolve(true)
		if (this.#pending) return Promise.resolve(false)
		return new Promise<boolean>((resolve) => {
			this.#pending = { resolve }
		})
	}

	resolveConfirm(leave: boolean): void {
		const pending = this.#pending
		this.#pending = null
		pending?.resolve(leave)
	}

	async navigate(action: LoreAction): Promise<void> {
		return this.navigateTo(reduce(this.#route, action))
	}

	/**
	 * Goes to a route built from several actions at once, through the same
	 * guard as `navigate`.
	 *
	 * ⚠ One transition, one guard. Two `navigate` calls in a row race: both
	 * reduce the route as it stood before either landed, and while the first
	 * waits on the unsaved-changes prompt the second's route wins and the
	 * first is written over it (#81).
	 */
	async navigateTo(next: LoreRoute): Promise<void> {
		if (sameRoute(next, this.#route)) return
		if (!(await this.confirmLeave())) return
		this.#route = next
	}

	set(route: LoreRoute): void {
		if (sameRoute(route, this.#route)) return
		this.#route = route
	}

	/**
	 * Opens a tab of the inspector on whatever is already selected, or closes
	 * it when handed nothing.
	 *
	 * Unguarded, and that is the rule rather than an omission: the inspector
	 * is a tab of the screen the editor is on, not a screen being left, so
	 * asking about unsaved changes here would be asking about a draft nothing
	 * is discarding.
	 */
	openInspector(inspector?: string): void {
		const route = this.#route
		if (route.entryId == null) return
		this.set(
			reduce(route, {
				type: "openEntry",
				entryId: route.entryId,
				sceneId: route.sceneId,
				inspector
			})
		)
	}

	/**
	 * Reads the fragment on arrival, writes it on every change, and follows it
	 * when something else changes it. The write replaces the history entry
	 * rather than pushing one: the workspace has its own back, and a step per
	 * section would bury the page the panel is open over.
	 */
	attachHash(): () => void {
		if (!browser) return () => {}
		// The arrival is set: there is no screen yet to leave.
		const arrival = fromHash(location.hash)
		if (arrival) this.set(arrival)
		/**
		 * A hash changed by hand — or Back over one typed by hand — leaves the
		 * screen that is open, so it goes through the guard (plan B7). Kept
		 * here, the address is written back, since the mirror below only
		 * writes on a route change and the bar would otherwise show where the
		 * workspace is not.
		 */
		const applyHash = () => {
			const next = fromHash(location.hash)
			if (!next) return
			void this.navigateTo(next).then(() => {
				const hash = toHash(this.#route)
				if (location.hash.replace(/^#/, "") === hash.replace(/^#/, ""))
					return
				const url = new URL(location.href)
				url.hash = hash
				untrack(() => replaceState(url, { ...page.state }))
			})
		}
		window.addEventListener("hashchange", applyHash)
		const stopMirror = $effect.root(() => {
			$effect(() => {
				const hash = toHash(this.#route)
				const url = new URL(location.href)
				url.hash = hash
				// The router's replaceState reads its own page state, which would
				// make this effect a subscriber to every URL change the router
				// sees, including the popstate a hand-edited hash fires before
				// hashchange; the mirror would then write the old address back
				// over the new one. It depends on the route and nothing else.
				//
				// The entry's shallow state is carried through, never replaced
				// with `{}`: the shell keeps "this view is in Focus over a
				// page" there (`page.state.focus`), and an empty object reads
				// as Back — picking a category dropped the view out of Focus.
				if (url.href !== location.href)
					untrack(() => replaceState(url, { ...page.state }))
			})
		})
		return () => {
			window.removeEventListener("hashchange", applyHash)
			stopMirror()
		}
	}
}

export const loreRoute = new LoreRouteStore()
