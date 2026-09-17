/**
 * The pure half of the docs **playground** (NOMENCLATURE §27): what a compiled
 * playground block says, and what the host owes the frame in what order.
 *
 * The DOM half is `docsPlayground.ts`. Everything that can be decided without a
 * document lives here so it can be tested without one — the parse, the height
 * clamp, and the little state machine that keeps `load` from being posted
 * before the frame has said it exists.
 *
 * ## The sandbox stance
 *
 * The frame is `sandbox="allow-scripts"` and never `allow-same-origin` — the
 * same stance `PluginFrame.svelte` takes for plugin surfaces (20 §12). That
 * makes the frame an *opaque origin*, which has two consequences this module
 * exists to record:
 *
 * - `event.origin` inside a message from it is the literal string `"null"`, and
 *   an opaque origin matches no `targetOrigin`, so the host must post with
 *   `"*"`. That is safe only because the host checks
 *   `event.source === iframe.contentWindow` — window identity, not a string.
 * - The frame document is served from `static/`, which the app serves with no
 *   CSP header of its own (a nested browsing context loaded over http(s) does
 *   not inherit its parent's policy), so it may `new Function(...)` the code it
 *   was handed. Nothing in this app grants it anything else.
 *
 * ## Protocol v1
 *
 * frame → host: `playground:ready`, `playground:height`, `playground:state`
 * host → frame: `playground:load` (after ready), `playground:theme`
 */

/** Which of the two themes the frame should paint itself in. */
export type PlaygroundTheme = "light" | "dark"

/** The frame document, served from `static/docs/playground/` (see build-docs.js). */
export const PLAYGROUND_FRAME_SRC = "/docs/playground/index.html"

/**
 * The height bounds a frame-reported height is clamped into.
 *
 * The frame measures its own content and asks; the host decides. A floor keeps
 * a frame that reports before it has laid anything out from collapsing to a
 * sliver, and a ceiling keeps a runaway output (a loop that logs) from taking
 * the page away from the reader — `.doc-graph` caps itself at 32rem for the
 * same reason, and the frame scrolls inside itself past this.
 */
export const FRAME_MIN_HEIGHT = 160
export const FRAME_MAX_HEIGHT = 720

/** What one compiled playground block carries. */
export interface PlaygroundBlock {
	/** The fence's language, `ts` when the block did not say. */
	lang: string
	/** The code as it was written, entities resolved. */
	code: string
}

export interface PlaygroundLoadMessage {
	t: "playground:load"
	v: 1
	lang: string
	code: string
	theme: PlaygroundTheme
	autorun?: boolean
}

export interface PlaygroundThemeMessage {
	t: "playground:theme"
	theme: PlaygroundTheme
}

export type HostMessage = PlaygroundLoadMessage | PlaygroundThemeMessage

/** What one message from the frame asks the host to do. */
export interface FrameSignal {
	/** Messages to post to the frame now, in order. Usually empty. */
	post: HostMessage[]
	/** A clamped height to apply to the iframe element. */
	height?: number
	/** The frame's run state, when this message carried one. */
	running?: boolean
	/** True on the message that made the frame ready. */
	ready?: boolean
}

/**
 * `<script type="text/plain">` is a raw-text element: the HTML parser does not
 * resolve entities inside it, so the compiler's escaping survives into
 * `textContent` verbatim and has to be undone here. Without this, every `<` in
 * a generic (`Array<string>`) reaches the frame as `&lt;`.
 *
 * The five named entities `escapeHtml` produces, plus the two numeric spellings
 * of an apostrophe. `&amp;` is resolved LAST so `&amp;lt;` — an escaped literal
 * `&lt;` in the source — comes back as `&lt;` rather than as `<`.
 */
function decodeEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;/g, "'")
		.replace(/&#x0*27;/gi, "'")
		.replace(/&amp;/g, "&")
}

/**
 * Read one compiled `.doc-playground` element, or answer `null`.
 *
 * `null` means "this block is static": either it is a build from before the
 * compiler carried the source (the highlighted `<pre>` is all there is), or the
 * source is empty. A static block gets no button — the reader is never offered
 * a control the page cannot honour.
 */
export function parsePlaygroundBlock(el: Element): PlaygroundBlock | null {
	const source = el.querySelector("script.doc-playground-source")
	if (!source) return null
	const code = decodeEntities(source.textContent ?? "")
	if (!code.trim()) return null
	const lang = el.getAttribute("data-lang")?.trim()
	return { lang: lang || "ts", code }
}

/**
 * Clamp a height the frame reported, or `null` if it reported nonsense.
 *
 * The frame is untrusted input like any other postMessage payload: a string, a
 * `NaN` or an `Infinity` must not reach `style.height`.
 */
export function clampFrameHeight(px: unknown): number | null {
	if (typeof px !== "number" || !Number.isFinite(px)) return null
	return Math.min(
		FRAME_MAX_HEIGHT,
		Math.max(FRAME_MIN_HEIGHT, Math.round(px))
	)
}

/**
 * The host's side of one frame's conversation.
 *
 * Its whole job is ordering: a `load` posted before the frame's script has run
 * is dropped on the floor, and the frame has no way to ask for it again. So the
 * load is *held* until `playground:ready` arrives, and a theme flip in the
 * meantime rewrites the held load rather than queueing a second message the
 * frame would receive before the first.
 *
 * It is a plain class, not a rune: the DOM action owns all the state Svelte
 * needs to see (which button label, which element is hidden), and this is the
 * part that must stay testable without a component.
 */
export class PlaygroundProtocol {
	#ready = false
	#load: PlaygroundLoadMessage | null = null
	#theme: PlaygroundTheme
	#running = false

	constructor(theme: PlaygroundTheme) {
		this.#theme = theme
	}

	/** Whether the frame has announced itself. */
	get ready(): boolean {
		return this.#ready
	}

	/** The theme the frame has been told about (or will be, on ready). */
	get theme(): PlaygroundTheme {
		return this.#theme
	}

	/** The frame's last reported run state. */
	get running(): boolean {
		return this.#running
	}

	/**
	 * Hand the frame its code. Returns what to post now — nothing at all until
	 * the frame is ready, at which point `receive` returns it instead.
	 */
	load(block: PlaygroundBlock, autorun?: boolean): HostMessage[] {
		this.#load = {
			t: "playground:load",
			v: 1,
			lang: block.lang,
			code: block.code,
			theme: this.#theme,
			...(autorun === undefined ? {} : { autorun })
		}
		return this.#ready ? [this.#load] : []
	}

	/** The host's theme flipped. A no-op when it did not actually change. */
	setTheme(theme: PlaygroundTheme): HostMessage[] {
		if (theme === this.#theme) return []
		this.#theme = theme
		// A held load carries the theme itself, so an unready frame needs no
		// second message — and must not get one, since it would arrive before
		// the load it is meant to correct.
		if (this.#load) this.#load = { ...this.#load, theme }
		return this.#ready ? [{ t: "playground:theme", theme }] : []
	}

	/**
	 * One message from the frame. Everything is validated: the caller has
	 * already proved the message came from this exact window, but not that its
	 * contents are anything in particular.
	 */
	receive(data: unknown): FrameSignal {
		if (!data || typeof data !== "object") return { post: [] }
		const msg = data as Record<string, unknown>
		switch (msg.t) {
			case "playground:ready": {
				this.#ready = true
				// Always re-posted, so a frame that reloaded its document (and
				// therefore lost its code) is handed it again rather than
				// sitting empty.
				return { post: this.#load ? [this.#load] : [], ready: true }
			}
			case "playground:height": {
				const height = clampFrameHeight(msg.px)
				return height === null ? { post: [] } : { post: [], height }
			}
			case "playground:state": {
				this.#running = msg.running === true
				return { post: [], running: this.#running }
			}
			default:
				return { post: [] }
		}
	}
}
