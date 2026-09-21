/**
 * The UI translation runtime (R5, phase 1b).
 *
 * ## The shape, and why it has no catalog
 *
 * `t("Language")` — the English source text *is* the key. There is no message
 * id, no extraction step and no catalog file, because every user-visible string
 * in this app is an inline literal in a `.svelte` file and there are thousands
 * of them. Authoring ids first would mean the feature ships when the last
 * string is converted; keying on the source means wrapping a literal is the
 * entire cost of translating it, one string at a time, forever.
 *
 * An unwrapped string simply renders in English. That is the property that
 * makes an incremental sweep safe: partial coverage looks like a partly
 * translated app, never a broken one.
 *
 * ## How a string gets translated
 *
 * `t()` is **synchronous** and returns its own argument when it has nothing
 * better. A miss is recorded, a request is scheduled, and when the answer
 * arrives the catalog write re-renders whoever read it. So the first ever paint
 * of a screen in a new language is English and the second is translated —
 * after which the browser cache below makes it instant, permanently.
 *
 * A string is requested **once per session**, hit or miss. Without that, a
 * source the server cannot translate — auto-translation off, or the engine
 * refused — would be re-requested on every single render, which is an infinite
 * request loop keyed to the framerate.
 *
 * ## Why localStorage and not just the server
 *
 * The server cache means a string is *translated* once, ever. The browser cache
 * means it is *fetched* once per device — so returning to the app in Spanish
 * paints Spanish on the first frame instead of flashing English while a socket
 * round trip completes. It is a rendering nicety over a durable server-side
 * truth, which is exactly the sort of thing browser storage should hold.
 */
import { DEFAULT_LANGUAGE } from "$lib/shared/i18n/languages"
import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"
import { localeMapOf, renderStatusText, type StatusText } from "@serene-pub/sdk"

const CACHE_PREFIX = "sp-i18n-"

/** Coalesces the misses of one render pass into a single request. */
const REQUEST_DEBOUNCE_MS = 60

let language = $state(DEFAULT_LANGUAGE)
let catalog = $state<Record<string, string>>({})

/**
 * Sources already asked about this session, whether or not an answer came back.
 *
 * A plain `Set`, not `SvelteSet`, and deliberately: nothing renders from it, so
 * making it reactive would only mean mutating reactive state from inside a
 * render — which is the thing `t()` must not do.
 */
const asked = new Set<string>()
let queued: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function cacheKey(code: string) {
	return `${CACHE_PREFIX}${code}`
}

function readCache(code: string): Record<string, string> {
	try {
		const raw = localStorage.getItem(cacheKey(code))
		if (!raw) return {}
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === "object" ? parsed : {}
	} catch {
		// A private window, cleared site data, or storage the browser refuses
		// outright. Translation is a nicety; losing the cache costs a round
		// trip, so there is nothing to report and nothing to recover.
		return {}
	}
}

function writeCache(code: string, entries: Record<string, string>) {
	try {
		localStorage.setItem(cacheKey(code), JSON.stringify(entries))
	} catch {
		// Quota, or storage disabled. Same reasoning as the read.
	}
}

function flush() {
	flushTimer = null
	const sources = queued
	queued = []
	if (sources.length === 0 || language === DEFAULT_LANGUAGE) return
	// Through the interest registry, so the sync naming `language:catalog`
	// reaches the server before the request does — the event is gated, and a
	// reply nobody declared is a reply the server never builds.
	//
	// The release is deliberately dropped: `applyCatalog` is one reference and
	// the registry counts subscribers by reference, so every request after the
	// first adds nothing, and the store wants catalog answers for as long as
	// the tab lives. No socket yet means the app is still starting — the
	// registry attaches the listener when one appears, and these sources stay
	// in `asked`, so the next *new* string to reach the screen carries the
	// request that fills them in. Retrying here would be a timer racing socket
	// setup.
	requestWithInterest("language:catalog", { sources }, applyCatalog)
}

function request(source: string) {
	queued.push(source)
	if (flushTimer === null) flushTimer = setTimeout(flush, REQUEST_DEBOUNCE_MS)
}

/**
 * The English source string, translated into the user's language if a
 * translation is available.
 *
 * Safe to call during render: the only state it writes is the non-reactive
 * `asked`/`queued` pair, and the catalog is only ever written from the socket
 * callback below.
 */
export function t(source: string): string {
	// English is the source language, so there is nothing to look up and
	// nothing to ask for. This is also every install's default, which is why
	// the whole mechanism costs nothing until somebody changes a setting.
	if (language === DEFAULT_LANGUAGE) return source
	const hit = catalog[source]
	if (hit !== undefined) return hit
	if (!asked.has(source)) {
		asked.add(source)
		request(source)
	}
	return source
}

/**
 * A run's status (R-19) as the person reads it, in their language.
 *
 * The text is display text with `{vars}` — a string or a locale map (R-20;
 * a bare string is `en`) — *{speaker} is typing* with
 * `speaker: "Jasmine"` — and the client is where the locale is resolved. Two
 * roads, in order: a locale the author shipped for this language is used as
 * written; otherwise the `en` TEMPLATE goes through `t()` — placeholders
 * intact, so "{speaker} is typing" is one stable source string however many
 * speakers there are — and the variables are substituted after. Empty for no
 * status, so a caller can `||` its own fallback.
 */
export function statusText(status: StatusText | null | undefined): string {
	if (!status) return ""
	// A bare string is `en` (R-20): read both spellings as the map.
	const i18n = localeMapOf(status.i18n)
	if (i18n[language] !== undefined) return renderStatusText(status, language)
	return renderStatusText({ ...status, i18n: { en: t(i18n.en) } })
}

/**
 * Point the runtime at a language.
 *
 * Called with `userSettings.effectiveLanguage` — the *resolved* answer, not the
 * user's stored choice, because the stored choice may be null meaning "follow
 * the instance default" and the renderer needs the language, not the intent.
 */
export function setLanguage(code: string) {
	if (code === language) return
	language = code
	asked.clear()
	queued = []
	catalog = code === DEFAULT_LANGUAGE ? {} : readCache(code)
	// Everything already cached counts as answered, so a returning visitor
	// asks only about what is genuinely new.
	for (const source of Object.keys(catalog)) asked.add(source)
	if (typeof document !== "undefined") {
		document.documentElement.lang = code
	}
}

/** Merge a catalog response in, and persist it for the next visit. */
export function applyCatalog(res: {
	language: string
	entries: Record<string, string>
}) {
	// A response for a language the user has since moved away from would
	// otherwise overwrite the new one's catalog with the old one's strings.
	if (res.language !== language) return
	if (Object.keys(res.entries).length === 0) return
	catalog = { ...catalog, ...res.entries }
	writeCache(language, catalog)
}

/**
 * Listen for catalog responses.
 *
 * Called by each app shell — the main `Layout` and Document View's
 * `AccessibleShell` — beside the rest of their socket wiring, and returns the
 * teardown they already expect. Registered there rather than once at socket
 * setup because a listener must not outlive the component tree that renders
 * from it.
 *
 * A fresh closure per caller, not `applyCatalog` itself: the registry counts
 * subscribers by reference, so two shells passing one reference would share a
 * single count and the first teardown would take the other's listener with it.
 */
export function registerLanguageSocket(): () => void {
	return declareInterest<"language:catalog">("language:catalog", (res) =>
		applyCatalog(res)
	)
}
