/**
 * Full screen: a per-viewer, per-session control (SHAPES L1), never a layout
 * declaration. One module-level state shared by Layout, Header and the
 * session page. The choice is stored per viewer per session in localStorage.
 */
import { browser } from "$app/environment"
import { SvelteMap } from "svelte/reactivity"

export interface SessionFullscreen {
	on: boolean
	/** ms, for the fade */
	since: number
}

/** Per viewer, per session. */
export const FULLSCREEN_PREF_KEY = (sessionId: number) =>
	`serene-pub:fullscreen:${sessionId}`

export const FULLSCREEN_NOTICE = "Press Esc to leave full screen."
export const FULLSCREEN_NOTICE_TOUCH = "Tap the corner to leave full screen."

type Entry = SessionFullscreen & { notice: string | null }

const states = new SvelteMap<number, Entry>()

function readStored(sessionId: number): string | null {
	if (!browser) return null
	try {
		return localStorage.getItem(FULLSCREEN_PREF_KEY(sessionId))
	} catch {
		return null
	}
}

function writeStored(sessionId: number, value: "on" | "off") {
	if (!browser) return
	try {
		localStorage.setItem(FULLSCREEN_PREF_KEY(sessionId), value)
	} catch {
		/* storage unavailable: the in-memory state still holds */
	}
}

function entryOf(sessionId: number): Entry {
	const have = states.get(sessionId)
	if (have) return have
	// First read of an id loads storage. Writing during a derived read is
	// avoided by returning the loaded value without caching when called
	// from a reactive read; caching happens on the first change.
	return {
		on: readStored(sessionId) === "on",
		since: 0,
		notice: null,
	}
}

function set(sessionId: number, patch: Partial<Entry>) {
	const cur = entryOf(sessionId)
	states.set(sessionId, { ...cur, ...patch, since: Date.now() })
}

export function useSessionFullscreen(sessionId: number) {
	const control = {
		get on() {
			return entryOf(sessionId).on
		},
		/** FULLSCREEN_NOTICE while a proposal's entry is still to be shown, else null. */
		get notice() {
			return entryOf(sessionId).notice
		},
		enter(opts?: { display?: boolean }) {
			set(sessionId, { on: true })
			writeStored(sessionId, "on")
			if (opts?.display && browser) {
				try {
					document.documentElement.requestFullscreen?.()?.catch(() => {})
				} catch {
					/* optional second step */
				}
			}
		},
		exit() {
			set(sessionId, { on: false })
			writeStored(sessionId, "off")
			if (browser) {
				try {
					if (document.fullscreenElement) {
						document.exitFullscreen?.()?.catch(() => {})
					}
				} catch {
					/* ignore */
				}
			}
		},
		toggle() {
			// Through `control`, never `this`: a caller may hold the method alone.
			if (entryOf(sessionId).on) control.exit()
			else control.enter()
		},
		/** A genre's proposal: enters ONLY with no stored choice; true when it entered. */
		propose(): boolean {
			if (readStored(sessionId) !== null) return false
			const keyboard =
				browser && !!window.matchMedia?.("(pointer: fine)").matches
			set(sessionId, {
				on: true,
				notice: keyboard ? FULLSCREEN_NOTICE : FULLSCREEN_NOTICE_TOUCH
			})
			writeStored(sessionId, "on")
			return true
		},
		/** The notice has been shown; it never shows again. */
		clearNotice() {
			if (entryOf(sessionId).notice === null) return
			set(sessionId, { notice: null })
		},
	}
	return control
}
