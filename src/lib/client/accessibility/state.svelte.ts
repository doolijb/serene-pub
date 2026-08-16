/**
 * Shared state for the accessible "Document View" — a fully separate route
 * tree/layout at /document-view, kept entirely independent of the main app's
 * Layout.svelte, panelsCtx, and app.css. See the plan doc for the full
 * rationale. Every helper here is a thin wrapper around localStorage/
 * sessionStorage so the calling components stay simple and testable.
 *
 * Storage keys, all namespaced under "serene-pub:a11y-*":
 *   a11y-mode          (localStorage)  "true" once the user has ever
 *                       triggered Document View — persists across sessions.
 *   a11y-paused         (sessionStorage) "true" while the user has chosen to
 *                       temporarily browse the standard site — suppresses the
 *                       auto-redirect-on-reload guard for this tab only,
 *                       without touching the persistent a11y-mode flag.
 *   a11y-dark           (localStorage)  "true" | "false" — Document View's
 *                       own dark-mode preference, independent of the main
 *                       app's theme system.
 *   a11y-font-scale     (localStorage)  a small integer index into
 *                       FONT_SCALE_STEPS.
 */

import { env } from "$env/dynamic/public"

/**
 * Shared, live reactive flags — read/written by both the root layout (which
 * decides Layout vs AccessibleShell) and src/routes/document-view/+layout.svelte
 * (which activates it for the current load if someone lands on a
 * /document-view/* URL directly, e.g. a bookmarked or shared link, without
 * ever pressing the shortcut). Must be a shared singleton, not a `$state`
 * re-declared separately in each component — otherwise the two layouts can't
 * see each other's writes and the root layout would keep rendering the wrong
 * shell.
 *
 * `enabled` and `persisted` are deliberately separate. Merely arriving at a
 * /document-view/* URL sets `enabled` only: it renders Document View for this
 * visit but records nothing, so the next load returns to the standard site.
 * `persisted` tracks the localStorage preference and is set only by the
 * explicit entry points (home-page button, settings button, Ctrl+Shift+Y).
 * They were one flag before, which meant a shared link, a bookmark, or the
 * `/document-view/help` link inside the in-app docs silently made Document
 * View that browser's permanent default.
 */
class AccessibilityModeStore {
	enabled = $state(false)
	persisted = $state(false)
}
export const accessibilityModeStore = new AccessibilityModeStore()

/** Reactive mirror of the sessionStorage "paused" flag (see pause()/resume()
 * below) — a plain isPaused() read is invisible to Svelte's reactivity, so
 * the root layout's shell-selection branch (AccessibleShell vs Layout) needs
 * this rune to actually re-render when "Browse Standard Site" is clicked. */
class PausedStore {
	paused = $state(false)
}
export const pausedStore = new PausedStore()

/**
 * Shared aria-live announcer — AccessibleShell renders exactly one
 * `role="status" aria-live="polite"` region bound to this, and any page can
 * call announce() to speak through it (font-size changes, "URL saved"
 * confirmations, subprocess status, validation errors, ...). Route-change
 * announcements are deliberately NOT handled here: SvelteKit already
 * announces navigations itself via its own built-in `#svelte-announcer`
 * live region, so a second region repeating the same page title would just
 * double-speak every navigation (one polite, one assertive — the assertive
 * one can even cut the polite one off mid-sentence).
 */
class AnnouncerStore {
	message = $state("")
}
export const announcerStore = new AnnouncerStore()

/**
 * Setting the exact same string twice in a row wouldn't otherwise
 * re-announce (the DOM text node doesn't change, so nothing tells the
 * screen reader to re-read it) — clearing first, then setting on the next
 * frame, guarantees a real text change every time even for a repeated
 * message like two "Saved." confirmations in a row.
 */
export function announce(message: string): void {
	announcerStore.message = ""
	if (typeof window === "undefined") {
		announcerStore.message = message
		return
	}
	requestAnimationFrame(() => {
		announcerStore.message = message
	})
}

const MODE_KEY = "serene-pub:a11y-mode"
const PAUSED_KEY = "serene-pub:a11y-paused"
const DARK_KEY = "serene-pub:a11y-dark"
const FONT_SCALE_KEY = "serene-pub:a11y-font-scale"

function hasStorage(): boolean {
	return typeof window !== "undefined" && !!window.localStorage
}

/**
 * Deployment-wide default for whether Document View starts enabled — set
 * via the PUBLIC_DOCUMENT_VIEW_DEFAULT env var (eg. for an install that's
 * primarily used by vision-impaired users). Only ever applies before this
 * browser has a stored preference of its own; once a preference exists
 * (self-set or persisted by isAccessibilityEnabled() below on first load),
 * it always wins over the env var, including if the env var changes later.
 */
function isDocumentViewDefaultEnabled(): boolean {
	return env.PUBLIC_DOCUMENT_VIEW_DEFAULT === "true"
}

export function isAccessibilityEnabled(): boolean {
	if (!hasStorage()) return isDocumentViewDefaultEnabled()
	const stored = localStorage.getItem(MODE_KEY)
	if (stored !== null) return stored === "true"
	// First load for this browser — persist the deployment default so it
	// behaves exactly as if the user had triggered it themselves, and stays
	// consistent for this browser even if the env var is changed later.
	const fallback = isDocumentViewDefaultEnabled()
	if (fallback) localStorage.setItem(MODE_KEY, "true")
	return fallback
}

/**
 * Turn Document View on for this load *without* recording a preference. For
 * arrivals that aren't a choice — a shared link, a bookmark, a typed URL, or
 * the /document-view/help link inside the in-app docs. The next load goes back
 * to the standard site unless the user opts in properly.
 */
export function activateForSession(): void {
	accessibilityModeStore.enabled = true
}

/** The explicit opt-in: home-page button, settings button, Ctrl+Shift+Y. */
export function enableAccessibility(): void {
	accessibilityModeStore.enabled = true
	accessibilityModeStore.persisted = true
	if (!hasStorage()) return
	localStorage.setItem(MODE_KEY, "true")
	resume()
}

/** The explicit opt-out — both "Exit Document View" actions and Ctrl+Shift+Y
 * from inside Document View. Distinct from "Browse Standard Site" (pause()),
 * which is meant to last only for the tab.
 *
 * resume() matters here: without it a paused session left `a11y-paused` behind
 * in sessionStorage after the preference was gone, and the only reason that
 * wasn't visible is that enableAccessibility() happens to clear it later. */
export function disableAccessibility(): void {
	accessibilityModeStore.enabled = false
	accessibilityModeStore.persisted = false
	if (!hasStorage()) return
	// Store "false" rather than removing the key. isAccessibilityEnabled()
	// reads an *absent* key as "this browser has never chosen" and falls back
	// to PUBLIC_DOCUMENT_VIEW_DEFAULT — so removing it meant that on any
	// deployment setting that variable, turning Document View off lasted
	// exactly until the next load, and the docs' promise that a user's own
	// choice "always wins, even if the environment variable changes later"
	// was not true in the off direction. An explicit "false" is that choice.
	localStorage.setItem(MODE_KEY, "false")
	resume()
}

export function isPaused(): boolean {
	if (typeof window === "undefined" || !window.sessionStorage) return false
	return sessionStorage.getItem(PAUSED_KEY) === "true"
}

/** "Browse Standard Site": suppress the redirect-on-reload guard for this
 * tab without clearing the persistent a11y-mode flag. */
export function pause(): void {
	pausedStore.paused = true
	if (typeof window === "undefined" || !window.sessionStorage) return
	sessionStorage.setItem(PAUSED_KEY, "true")
}

export function resume(): void {
	pausedStore.paused = false
	if (typeof window === "undefined" || !window.sessionStorage) return
	sessionStorage.removeItem(PAUSED_KEY)
}

export function isDarkMode(): boolean {
	if (!hasStorage()) return true
	const stored = localStorage.getItem(DARK_KEY)
	return stored === null ? true : stored === "true"
}

export function setDarkMode(enabled: boolean): void {
	if (!hasStorage()) return
	localStorage.setItem(DARK_KEY, String(enabled))
}

/** Discrete steps rather than a free slider — simpler to operate with
 * keyboard/switch-access, and each step is a clearly announced, predictable
 * size rather than a continuously-variable value. */
export const FONT_SCALE_STEPS = [1, 1.15, 1.3, 1.5, 1.75, 2] as const
export const DEFAULT_FONT_SCALE_INDEX = 1

export function getFontScaleIndex(): number {
	if (!hasStorage()) return DEFAULT_FONT_SCALE_INDEX
	const stored = Number(localStorage.getItem(FONT_SCALE_KEY))
	if (
		!Number.isInteger(stored) ||
		stored < 0 ||
		stored >= FONT_SCALE_STEPS.length
	) {
		return DEFAULT_FONT_SCALE_INDEX
	}
	return stored
}

export function setFontScaleIndex(index: number): void {
	if (!hasStorage()) return
	const clamped = Math.max(0, Math.min(FONT_SCALE_STEPS.length - 1, index))
	localStorage.setItem(FONT_SCALE_KEY, String(clamped))
}

/**
 * Explicit route table mapping a "standard" path to its Document View
 * equivalent. Anything not listed here (including routes that simply don't
 * have an accessible page yet, like /import) falls back to the Document View
 * home — landing somewhere useful beats leaving the user on a page their
 * assistive tech can't work with.
 */
export function mapToAccessibleRoute(pathname: string): string {
	if (
		pathname === "/document-view" ||
		pathname.startsWith("/document-view/")
	) {
		return pathname
	}
	if (pathname === "/") return "/document-view"

	const chatMatch = pathname.match(/^\/chats\/(\d+)\/?$/)
	if (chatMatch) return `/document-view/chats/${chatMatch[1]}`

	if (pathname === "/library/characters") return "/document-view/characters"
	if (pathname === "/library/personas") return "/document-view/personas"

	if (pathname === "/docs") return "/document-view/docs"
	const docMatch = pathname.match(/^\/docs\/([a-z0-9-]+)\/?$/i)
	if (docMatch) return `/document-view/docs/${docMatch[1]}`

	return "/document-view"
}

/**
 * The reverse of mapToAccessibleRoute — used by "Browse Standard Site" and
 * "Turn Off Document View" so leaving Document View lands on the equivalent
 * standard page when one exists (eg. the same open chat), falling back to
 * the standard home ("/") for anything that only exists as a sidebar panel
 * in the standard UI (characters/personas' own lists, connections, manager
 * pages, settings, chat creation/editing) rather than a dedicated route.
 */
export function mapToStandardRoute(pathname: string): string {
	if (!pathname.startsWith("/document-view")) return pathname
	if (pathname === "/document-view") return "/"

	const chatMatch = pathname.match(
		/^\/document-view\/chats\/(\d+)(?:\/edit)?\/?$/
	)
	if (chatMatch) return `/chats/${chatMatch[1]}`

	if (pathname === "/document-view/characters/browse")
		return "/library/characters"
	if (pathname === "/document-view/personas/browse")
		return "/library/personas"

	if (pathname === "/document-view/docs") return "/docs"
	const docMatch = pathname.match(/^\/document-view\/docs\/([a-z0-9-]+)\/?$/i)
	if (docMatch) return `/docs/${docMatch[1]}`

	return "/"
}
