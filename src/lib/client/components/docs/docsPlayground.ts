/**
 * The **playground** upgrade (NOMENCLATURE §27): a Svelte action over a
 * `.docs-article` that turns every compiled playground block into a block the
 * reader can run, and leaves everything else exactly as the compiler wrote it.
 *
 * ## Why an action over the article, and not a component
 *
 * The article body is compiled HTML injected with `{@html}`. Nothing inside it
 * is a component and nothing can be — there is no place to put one. So the
 * affordance is *attached*, the same way serenepub.com attaches its lightbox to
 * compiled figures: one action over the container, a `MutationObserver` for
 * when the body is swapped (Help navigates in place), and DOM built by hand.
 *
 * ## Nothing loads until it is asked for
 *
 * The upgrade inserts a toolbar and a button. That is all it costs a reader who
 * never presses one: no iframe, no request, no frame document. The frame is
 * created on the first press, and from then on it stays mounted — "Show code"
 * hides it rather than removing it, so a reader who flips back to the code and
 * forward again finds their session where they left it.
 *
 * ## The sandbox contract
 *
 * `sandbox="allow-scripts"`, never `allow-same-origin`. See
 * `docsPlaygroundProtocol.ts` for what that buys and what it forces (posting
 * with `"*"`, and authenticating a message by window identity instead).
 */
import type { Action } from "svelte/action"
import {
	FRAME_MIN_HEIGHT,
	PLAYGROUND_FRAME_SRC,
	PlaygroundProtocol,
	parsePlaygroundBlock,
	type PlaygroundBlock,
	type PlaygroundTheme
} from "./docsPlaygroundProtocol"

export interface DocsPlaygroundOptions {
	/**
	 * The host's current theme, read fresh each time it is needed rather than
	 * passed as a value — the action outlives any one render, and a stale
	 * closure would send the frame the theme the page had when it mounted.
	 */
	theme: () => PlaygroundTheme
}

const RUN_LABEL = "Run in playground"
const CODE_LABEL = "Show code"

/** One upgraded block: its two faces and the conversation behind one of them. */
interface Block {
	el: HTMLElement
	pre: HTMLElement
	button: HTMLButtonElement
	source: PlaygroundBlock
	frame: HTMLIFrameElement | null
	protocol: PlaygroundProtocol | null
	showing: "code" | "playground"
}

export const docsPlayground: Action<HTMLElement, DocsPlaygroundOptions> = (
	article,
	options
) => {
	let opts = options
	const blocks = new Set<Block>()

	function post(block: Block, messages: readonly unknown[]) {
		if (!messages.length) return
		const target = block.frame?.contentWindow
		if (!target) return
		// `"*"` is forced, not lax: an opaque origin matches no targetOrigin.
		// What makes this safe is that only the document inside this exact
		// frame is `contentWindow`, and only messages from it are accepted.
		for (const message of messages) target.postMessage(message, "*")
	}

	function mountFrame(block: Block) {
		const theme = opts.theme()
		const protocol = new PlaygroundProtocol(theme)
		const frame = document.createElement("iframe")
		frame.src = PLAYGROUND_FRAME_SRC
		frame.title = "Playground"
		frame.className = "doc-playground-frame"
		frame.setAttribute("sandbox", "allow-scripts")
		frame.setAttribute("loading", "lazy")
		// A starting height, so the card does not jump from nothing to a frame
		// the instant the first `height` message lands.
		frame.style.height = `${FRAME_MIN_HEIGHT}px`
		block.frame = frame
		block.protocol = protocol
		// Held until the frame says `ready`; `receive` posts it then.
		protocol.load(block.source)
		block.pre.before(frame)
	}

	function show(block: Block, face: "code" | "playground") {
		if (face === "playground" && !block.frame) mountFrame(block)
		block.showing = face
		block.el.dataset.playgroundShowing = face
		block.pre.hidden = face === "playground"
		if (block.frame) block.frame.hidden = face === "code"
		block.button.textContent =
			face === "playground" ? CODE_LABEL : RUN_LABEL
		block.button.setAttribute(
			"aria-pressed",
			face === "playground" ? "true" : "false"
		)
	}

	function upgrade() {
		for (const el of article.querySelectorAll<HTMLElement>(
			".doc-playground"
		)) {
			if (el.dataset.playgroundUpgraded) continue
			const source = parsePlaygroundBlock(el)
			// No source script: a build from before the compiler carried one.
			// The block stays a plain code block and gets no button.
			if (!source) continue
			const pre = el.querySelector("pre")
			if (!pre) continue
			el.dataset.playgroundUpgraded = "true"

			const toolbar = document.createElement("div")
			toolbar.className = "doc-playground-toolbar"
			const button = document.createElement("button")
			button.type = "button"
			button.className = "btn btn-sm preset-tonal-primary"
			button.textContent = RUN_LABEL
			button.setAttribute("aria-pressed", "false")
			toolbar.append(button)
			pre.before(toolbar)

			const block: Block = {
				el,
				pre,
				button,
				source,
				frame: null,
				protocol: null,
				showing: "code"
			}
			el.dataset.playgroundShowing = "code"
			button.addEventListener("click", () =>
				show(block, block.showing === "code" ? "playground" : "code")
			)
			blocks.add(block)
		}
	}

	function onMessage(event: MessageEvent) {
		// Window identity is the authentication — not `event.origin`, which an
		// opaque origin reports as the string "null" and which any document
		// could be made to report.
		for (const block of blocks) {
			if (!block.frame || !block.protocol) continue
			if (event.source !== block.frame.contentWindow) continue
			const signal = block.protocol.receive(event.data)
			post(block, signal.post)
			if (signal.height !== undefined) {
				block.frame.style.height = `${signal.height}px`
			}
			if (signal.running !== undefined) {
				block.el.dataset.playgroundRunning = String(signal.running)
			}
			return
		}
	}

	function onTheme() {
		const theme = opts.theme()
		for (const block of blocks) {
			if (!block.protocol) continue
			post(block, block.protocol.setTheme(theme))
		}
	}

	upgrade()

	/**
	 * The body is replaced wholesale when Help navigates, and the action's own
	 * parameter does not change with it — so the DOM is what is watched, not a
	 * prop. `subtree` because a playground block need not be a direct child of
	 * the article. The callback is idempotent (an upgraded block is marked and
	 * skipped), so the mutations this action makes itself cost one extra no-op
	 * pass and cannot loop.
	 */
	const bodyObserver = new MutationObserver(() => upgrade())
	bodyObserver.observe(article, { childList: true, subtree: true })

	/**
	 * The app puts the theme on `<html data-mode>` (docs.css switches on the
	 * same attribute). A media query would ignore the reader's own choice.
	 */
	const themeObserver = new MutationObserver(onTheme)
	themeObserver.observe(document.documentElement, {
		attributeFilter: ["data-mode"]
	})

	window.addEventListener("message", onMessage)

	return {
		update(next: DocsPlaygroundOptions) {
			opts = next
			upgrade()
		},
		destroy() {
			window.removeEventListener("message", onMessage)
			bodyObserver.disconnect()
			themeObserver.disconnect()
			blocks.clear()
		}
	}
}

/** The app's theme, as the frame spells it. */
export function documentTheme(): PlaygroundTheme {
	return document.documentElement.dataset.mode === "dark" ? "dark" : "light"
}
