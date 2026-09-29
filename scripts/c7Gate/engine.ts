/**
 * The gate's engine (PLAN-r21-core-widgets §4): what every spec shares — the
 * instance (the fake model, what the run changes and puts back), driving the
 * page (`open`, `ask` through the app's own socket, `steady` retries over a
 * dev-server reload), the console policy, reading one widget's subtree
 * (`readShape`, axe, Tab order), and golden record/compare. A spec
 * (`specs/*.ts`) builds its own fixture on top and says what its widget must
 * do; `gate.ts` runs them in turn.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createRequire } from "node:module"
import type { Browser, Page } from "playwright"
// The model and its rate live in one place, so a standalone run and the gate agree.
// @ts-expect-error a plain .mjs beside this file
import { REPLY_SHAPE, TOKENS, fakeModelServer } from "./fakeModel.mjs"

export const URL_BASE = process.env.GATE_URL ?? "http://localhost:5234"
/** A fixture session to judge; the gate builds its own when none is named. */
export let SESSION = Number(process.env.GATE_SESSION ?? "0")
/** The conversation's fixture, once built (`SESSION` is read live by every importer). */
export const setSession = (id: number) => void (SESSION = id)
/** Every fixture's name starts so — and only such a session may be named. */
export const FIXTURE_NAME = "C7 gate fixture"
export const GOLDENS = new URL("./goldens/", import.meta.url)
/** Bumped whenever what a golden holds changes; an older recording is refused, never half-read. */
export const GOLDEN_FORMAT = 2
/**
 * The properties compared, on every element and every drawn ::before/::after:
 * those the conversation's styles (styles/widgets.css §conversation, messageLayouts.css) and
 * the packs (corePresets.ts) set that a person sees — logical ones through
 * their physical longhands. A property outside this list is not compared; add
 * one when a style starts to set it. Left out on purpose: `transition-*` and
 * `animation-*` describe motion, not the look — a finished one is compared
 * through the properties it moved (the snapshot waits them out).
 */
export const STYLE_PROPS = [
	"display", "position", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height",
	"top", "right", "bottom", "left", "z-index",
	"margin-top", "margin-right", "margin-bottom", "margin-left",
	"padding-top", "padding-right", "padding-bottom", "padding-left",
	"border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
	"border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
	"border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
	"border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
	"box-shadow", "outline-style", "outline-width", "outline-color", "outline-offset",
	"font-family", "font-size", "font-weight", "line-height", "font-style", "font-variant-numeric", "letter-spacing", "text-transform",
	"text-align", "white-space", "text-decoration-line", "text-underline-offset", "text-overflow", "vertical-align", "list-style-type",
	"color", "background-color", "background-image", "object-fit",
	"gap", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "order",
	"align-items", "align-self", "justify-content", "justify-self",
	"grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-area",
	"overflow-x", "overflow-y", "resize", "transform", "filter", "backdrop-filter",
	"cursor", "pointer-events", "opacity", "visibility"
]
/**
 * How the page places the conversation's root in its cell — a flex or grid
 * item's own sizing and order — left out on the root alone. Natively the root
 * is that item (WidgetHost restates `.stage-cell > * { flex: 1 }` one level
 * down, through a `display: contents` style scope); as a remote the remote's
 * box sits in the cell instead, and the root is a block child of that box,
 * where these are inert (`flex: 1 1 0%` against `0 1 auto`, both drawn
 * 1104×944 at the same place). What the placement produces — the root's size
 * and position — stays compared.
 */
export const PLACEMENT_PROPS = ["flex-grow", "flex-shrink", "flex-basis", "order", "align-self", "justify-self", "grid-area"]
/** Attributes whose value names an element by id (as the receiver's policy lists them, plus `href="#…"`). */
export const IDREFS = [
	"for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-activedescendant",
	"aria-owns", "aria-errormessage", "aria-details", "aria-flowto", "list", "form", "popovertarget"
]
/**
 * The host element attributes the host reads with `flag()` (hostElements/
 * spElement.svelte.ts), where absent and "false" are both off. The two copies
 * say off differently — Svelte writes `open="false"`, the remote drops the
 * attribute (booleans are present-or-absent on the wire) — and the host shows
 * one state for both, so both are recorded as the host reads them. A skin
 * keyed on `[open]` would still show, in the computed styles.
 */
export const HOST_FLAGS = ["open", "disabled", "checked", "multiple", "streaming"]
/**
 * What every copy's clock reads while it is measured. The clock beside a name
 * is the message's own time of day — the server's timestamp, formatted in
 * whichever realm draws the widget (the worker, for the remote) — so no page
 * clock reaches it and its width would follow the hour. Measured holding this
 * one sample instead, every width stays compared; the real text is compared
 * as text.
 */
export const CLOCK_SAMPLE = "00:00\u202fAM"
/** A whole fake reply: its counter, then w0 … w119 (fakeModel.mjs). A page function's `new RegExp` reads it. */
export const REPLY = `^r\\d+ ${Array.from({ length: TOKENS }, (_, i) => `w${i}`).join(" ")}$`
/**
 * The look the goldens were recorded in: a fresh instance's user settings
 * (`userSettings.theme` / `darkMode`, schema.ts). They colour every element
 * the snapshot reads, so the run holds them and puts back what was there.
 */
export const FRESH_LOOK = { theme: "lamplight", darkMode: true }
/**
 * The gate connection's capability overrides that decide its wire mode and
 * the Continue notice the goldens hold ("This connection is sent as Chat
 * messages …", `continueWireRefusal`). A fresh connection has none of them:
 * an OpenAI-compatible type declares both wires on and `continue_reply` on,
 * and the tie-break answers chat (connectionAdapters/manifest.ts, wireMode.ts).
 * The run clears them and puts back what was there.
 */
export const WIRE_KEYS = ["wire_chat", "wire_completion", "continue_reply"]

/**
 * Where each copy lives — the one place the gate says it. The remote loads
 * with `REMOTE_QUERY` and is found inside its box; at the cutover (the remote
 * is the only page) `REMOTE_QUERY` becomes "" and nothing else here moves —
 * but then the two views are one page (`ONE_PAGE`), and the judge must be
 * the goldens (see the header, and the refusals below).
 */
// Cut over 2026-09-25 (C7.4): the native copy is gone and the remote is the
// page — judged against the goldens the native copy recorded (02:51).
export const REMOTE_QUERY = ""
export const REMOTE_BOX = '[data-sp-owner="core"]'
export type View = { name: "native" | "remote"; remote: boolean; url: string; scope: string }
export const view = (remote: boolean): View => ({
	name: remote ? "remote" : "native",
	remote,
	url: `${URL_BASE}/sessions/${SESSION}${remote ? REMOTE_QUERY : ""}`,
	/** Prefixed to every selector inside the conversation. */
	scope: remote ? `${REMOTE_BOX} ` : ""
})
/**
 * Both views load one URL: the native scope ("") then finds the remote's own
 * conversation, and a "native" reading is the remote read twice.
 */
export const ONE_PAGE = view(false).url === view(true).url

/**
 * `native`: judge the remote against the native copy, live — the default
 * while there is one. `golden`: against what was recorded — the default,
 * and the only judge, once there is not (`ONE_PAGE`).
 */
export const AGAINST = process.env.GATE_AGAINST ?? (ONE_PAGE ? "golden" : "native")
/** Record the answers `GATE_AGAINST=golden` reads: the native copy's, or — re-baselining after the cutover — the remote's own. */
export const RECORD = process.env.GATE_RECORD === "1"
/** After the cutover, the explicit consent to record the remote itself as the goldens. */
export const REBASELINE = process.env.GATE_REBASELINE === "1"
{
	const refuse = (why: string) => {
		console.error(`C7 gate: refused — ${why}`)
		process.exit(2)
	}
	if (AGAINST !== "native" && AGAINST !== "golden") refuse(`GATE_AGAINST is "${AGAINST}"; it is "native" or "golden"`)
	if (ONE_PAGE && AGAINST === "native")
		refuse(
			`the native and remote views are one page (REMOTE_QUERY is "", the cutover): the "native" copy read there is the remote itself, ` +
				`so the gate would compare the remote with itself and always pass. Judge against the goldens: GATE_AGAINST=golden (the default here).`
		)
	if (ONE_PAGE && RECORD && !REBASELINE)
		refuse(
			`after the cutover there is no native copy to record: GATE_RECORD=1 would save the remote as the reference it is judged by. ` +
				`To re-baseline on purpose — a change to the look you mean to keep — add GATE_REBASELINE=1: it records the REMOTE ITSELF as the new goldens.`
		)
	if (REBASELINE && !ONE_PAGE)
		refuse(`GATE_REBASELINE=1 records the remote itself, which only means something once the native copy is gone; while there are two pages, GATE_RECORD=1 records the native copy`)
	if (REBASELINE && !RECORD) refuse(`GATE_REBASELINE=1 goes with GATE_RECORD=1 — it says what the recording is, it does not record`)
	if (RECORD && !ONE_PAGE && AGAINST === "golden")
		refuse(`GATE_RECORD=1 records the native copy, which GATE_AGAINST=golden does not read: judge against native to record`)
	if (ONE_PAGE && SESSION)
		refuse(
			`GATE_SESSION=${SESSION} names a fixture an earlier run built — and wrote into (stream lines, the flows' exchange, an edit, a swipe). ` +
				`After the cutover the goldens are the only judge, and they hold a fresh fixture's six messages: a reused one differs in every pack ` +
				`whatever the remote does. Leave GATE_SESSION unset and the gate builds its own.`
		)
}
/** Re-baselining: the remote's answers are what is recorded (and the old goldens, where readable, are what they are judged against). */
export const RECORDS_REMOTE = ONE_PAGE && RECORD && REBASELINE

export type Snapshot = {
	format: number
	tree: string[]
	/** Per element, keyed by its tree line: attributes, its own text (`#text`), and `#shown: "no"` when it is not drawn. */
	attrs: Array<{ path: string; attrs: Record<string, string> }>
	/** Per element, keyed by its tree line: STYLE_PROPS, a drawn pseudo's as `::before <prop>`, and `#scroll` for one that scrolls. */
	styles: Array<{ path: string; style: Record<string, string> }>
	/** What shows through behind the conversation: the first painted background above it. */
	backdrop: string
	/** The conversation's ancestors up to the page, inside out, that scroll: how far each stands from its bottom ("none" when none scrolls). */
	scrollAbove: string
	axe: string[]
	/** Rules axe could not decide, per node count, with the reason it gave. */
	axeUndecided: Array<{ rule: string; nodes: number; why: string }>
	tabs: string[]
}

const require = createRequire(import.meta.url)
export const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8")
export const problems: string[] = []
/**
 * The problems that say the remote is wrong on its own terms, whatever it is
 * judged against: a console line, a stopped remote, a failed flow, an answer
 * it could not give, a conversation that did not open on its newest line or
 * does not show its own records. A re-baseline never records over one. Read
 * through `problems`, so one dropped with a reloaded step (`steady`) is gone.
 */
export const absolute = new Set<string>()
export const failAbsolute = (line: string) => {
	problems.push(line)
	absolute.add(line)
}
/** Re-baselining: what the new recording allows more of than the old — printed, since it becomes what every later run accepts. */
export const rises: string[] = []
export const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0]

/* ── the page ─────────────────────────────────────────────────────────── */

/**
 * Loads the gate asked for; any other `load` during a step is the dev server
 * reloading the page (`steady`). `remote` says whose page it is, for the
 * console (`heard`): set at commit, so a line the page before it said as it
 * unloaded stays that page's. After the cutover every session page is the
 * remote's — its conversation is the remote — whichever step loads it (a pin
 * switched live, the fixture's first replies, the restore).
 */
let ownLoads = 0
let onRemote = false
export const isSessionPage = (url: string) => {
	try {
		return /^\/sessions\/\d+\/?$/.test(new URL(url).pathname)
	} catch {
		return false
	}
}
export async function open(page: Page, url: string, remote = false) {
	ownLoads++
	await page.goto(url, { waitUntil: "commit" })
	onRemote = remote || (ONE_PAGE && isSessionPage(url))
	await page.waitForLoadState("load")
}
export async function reopen(page: Page) {
	ownLoads++
	await page.reload({ waitUntil: "commit" })
	await page.waitForLoadState("load")
}

/** `load` comes before the app boots: SvelteKit's inline bootstrap imports Vite's client (which defines the dev globals app modules read) async. */
export const booted = (page: Page) =>
	page.waitForFunction(() => typeof (globalThis as { __SVELTEKIT_APP_VERSION__?: unknown }).__SVELTEKIT_APP_VERSION__ === "string", null, { timeout: 60_000 })

/** The host's overlay beside the conversation's box — the remote stopped — or null. */
export const fatalOf = (page: Page) =>
	page.evaluate((box) => {
		const boxes = [...document.querySelectorAll(box)]
		const mine = boxes.find((b) => b.querySelector('[data-widget-part~="messages.root"]')) ?? boxes[0]
		const alert = mine?.parentElement?.querySelector(":scope > [role=alert]")
		return alert ? (alert.textContent ?? "").replace(/\s+/g, " ").trim() || "(no text)" : null
	}, REMOTE_BOX)

/**
 * The conversation is on screen — or, for the remote, the host's overlay is:
 * a remote that stopped before it drew is named, not waited out.
 */
export async function ready(page: Page, v: View, inner = "") {
	await page.waitForFunction(
		({ sel, box }) =>
			!!document.querySelector(sel) ||
			(!!box && [...document.querySelectorAll(box)].some((b) => b.parentElement?.querySelector(":scope > [role=alert]"))),
		{ sel: `${v.scope}[data-widget-part~="messages.root"]${inner}`, box: v.remote ? REMOTE_BOX : "" },
		{ timeout: 60_000 }
	)
	const fatal = v.remote ? await fatalOf(page) : null
	if (fatal !== null) throw new Error(`the remote stopped before it drew — the host's overlay says "${fatal}"`)
}

/**
 * A native copy is never the remote: the conversation a native reading finds
 * first must not sit in the remote's box. Where it does, the "native" answers
 * would be the remote's own, and the gate would pass by comparing the remote
 * with itself (`ONE_PAGE` refuses that up front; this refuses it on the page).
 */
export async function mustBeNative(page: Page, v: View) {
	if (v.remote) return
	const inBox = await page.evaluate(
		({ sel, box }) => !!document.querySelector(sel)?.closest(box),
		{ sel: `${v.scope}[data-widget-part~="messages.root"]`, box: REMOTE_BOX }
	)
	if (inBox)
		throw new Error(
			`the "native" conversation on ${v.url} is inside the remote's box (${REMOTE_BOX}): it is the remote itself, and the gate will not compare the remote with itself`
		)
}

/**
 * A remote that stopped leaves the host's overlay over a box that may still
 * hold a whole, matching copy: whatever its snapshot says, that is a failure.
 */
export async function noteFatal(page: Page, v: View, what: string) {
	if (!v.remote) return
	const fatal = await fatalOf(page)
	if (fatal !== null) failAbsolute(`${what}: the remote stopped — the host's overlay says "${fatal}"`)
}

/**
 * Ask the app's own socket, from the page (admin keys go out once the shell
 * knows the user). `refusable`: a refusal arrives on `error`, not on the
 * request's own name. `where`: the reply must carry these values — a
 * per-user event can answer another page's ask; a key may be a dotted path
 * (`session.id`).
 */
export async function ask<T = any>(
	page: Page,
	event: string,
	params: unknown,
	o: {
		refusable?: boolean
		where?: Record<string, unknown>
		avatar?: { color: string; letter: string }
		/** A reply scoped on this value (`interestKey(event, scope)`): a bare name never hears it. */
		scope?: string | number
		/** A drawn image sent as a binary attachment under `field` (a sprite's `imageFile`). */
		file?: { field: string; color: string; letter: string }
	} = {}
): Promise<T> {
	return page.evaluate(
		async ({ event, params, refusable, where, avatar, scope, file }) => {
			const live = (globalThis as unknown as { __gateImport: (path: string) => Promise<any> }).__gateImport
			const ts = await live("/src/lib/client/sockets/typedSocket.ts")
			const ir = await live("/src/lib/client/sockets/interest.svelte.ts")
			// The socket connects after the shell mounts; a fresh page may not have one yet.
			for (let i = 0; i < 300 && !ts.typedSocketOrNull()?.connected; i++) await new Promise((r) => setTimeout(r, 100))
			const s = ts.typedSocketOrNull()
			if (!s?.connected) throw new Error("the app's socket never connected")
			return new Promise<any>((res, rej) => {
				const offs: Array<() => void> = []
				const done = (f: () => void) => (clearTimeout(t), offs.forEach((off) => off()), f())
				const t = setTimeout(() => done(() => rej(new Error(`timeout ${event}`))), 15000)
				offs.push(
					ir.declareInterest(scope == null ? event : `${event}#${scope}`, (d: any) => {
						if (!where || Object.entries(where).every(([k, v]) => k.split(".").reduce((o: any, p) => o?.[p], d) === v)) done(() => res(d))
					})
				)
				if (refusable) offs.push(ir.declareInterest("error", (d: any) => done(() => rej(new Error(`${event} refused: ${d?.error}`)))))
				// Most refusals arrive on the request's own `:error` sibling.
				if (refusable) offs.push(ir.declareInterest(`${event}:error`, (d: any) => done(() => rej(new Error(`${event} refused: ${d?.error}`)))))
				ir.flushInterestSync?.()
				setTimeout(async () => {
					// A face drawn here: the bytes cannot cross `evaluate` as JSON, and the
					// socket carries them as a binary attachment (`avatarFile`).
					const drawn = avatar ? { field: "avatarFile", ...avatar } : file
					if (drawn) {
						const c = new OffscreenCanvas(96, 96)
						const g = c.getContext("2d")!
						g.fillStyle = drawn.color
						g.fillRect(0, 0, 96, 96)
						g.fillStyle = "#fff"
						g.font = "bold 56px sans-serif"
						g.textAlign = "center"
						g.textBaseline = "middle"
						g.fillText(drawn.letter, 48, 52)
						const png = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer())
						s.emit(event, { ...(params as object), [drawn.field]: png })
					} else s.emit(event, params)
				}, 120)
			})
		},
		{ event, params, refusable: !!o.refusable, where: o.where ?? null, avatar: o.avatar ?? null, scope: o.scope ?? null, file: o.file ?? null }
	) as Promise<T>
}

/* ── the console ──────────────────────────────────────────────────────── */

/** Every warning, error and uncaught exception, with the step, whose page said it, and where (a failed load names the resource). */
export type Heard = { step: string; remote: boolean; kind: string; text: string; worker: boolean; url: string }
export const heard: Heard[] = []
export let stepName = "setup"
/** What the remote's host (ComponentMount, the receiver's policy, uiWorkers) and its worker say — never excused. */
export const remoteVoice = (h: Heard) => h.worker || /^Remote "|^UI worker for /.test(h.text)
/**
 * The page shell's own resources: the session page itself (and its route
 * data), and the modules and styles the dev server serves the app — the same
 * code in both copies. Never anything of the remote's: its worker
 * (`/ui-worker`, a `?worker` module), its bundle (`/core-ui/`,
 * `/plugin-ui/`), its host's modules (`components/host/`), or what its box
 * shows (an image, any other media).
 */
export function shellResource(url: string) {
	let u: URL
	try {
		u = new URL(url)
	} catch {
		return false
	}
	if (u.origin !== new URL(URL_BASE).origin || /worker|\/components\/host\//i.test(u.pathname + u.search)) return false
	return (
		/^\/sessions\/\d+(?:\/__data\.json)?$/.test(u.pathname) ||
		/^\/(?:@vite|@id)\//.test(u.pathname) ||
		/^\/(?:src|node_modules|@fs|\.svelte-kit|_app)\/[^?]*\.(?:[cm]?[jt]s|svelte|css|json)$/.test(u.pathname)
	)
}
/**
 * Lines a remote's page may say that are nothing to do with the remote —
 * each with why, printed whenever one is heard. A line not listed fails, and
 * the remote's own voice (`remoteVoice`) is never excused.
 */
export const CONSOLE_EXCUSED: Array<{ pattern: RegExp; url?: (url: string) => boolean; why: string }> = [
	{
		pattern: /^Failed to load resource: the server responded with a status of 5\d\d\b/,
		url: shellResource,
		why:
			"the dev server answered one of the page shell's own loads (the page, its data, a module or style of the app) with a server error — " +
			"busy recompiling for another session's edit. That shell is the same code in both copies and the remote loads none of it itself; " +
			"a server error on anything the remote loads (its worker, its bundle, what its box shows) is not excused"
	}
]
export const excusedBy = (h: Heard) =>
	remoteVoice(h) ? undefined : CONSOLE_EXCUSED.find(({ pattern, url }) => pattern.test(h.text) && (!url || url(h.url)))
/** Judged: every line of the remote's page — and the remote's own voice, whichever page heard it. */
export const judgedLine = (h: Heard) => h.remote || remoteVoice(h)

export function judgeConsole() {
	const tally = (hs: Heard[], where = false) => {
		const out = new Map<string, number>()
		for (const h of hs) {
			const key = `${h.step}: ${h.kind}${h.worker ? " (worker)" : ""}: ${h.text.split("\n")[0]!.slice(0, 240)}${where && h.url ? ` (${h.url})` : ""}`
			out.set(key, (out.get(key) ?? 0) + 1)
		}
		return [...out].map(([k, n]) => (n > 1 ? `${k} (×${n})` : k))
	}
	// After the cutover there is no native copy: a line not judged was heard
	// on a page that is not a session's (the fixture's, the restore's).
	const unjudged = heard.filter((h) => !judgedLine(h))
	if (unjudged.length)
		console.log(
			`[console] ${ONE_PAGE ? "lines heard off the session's page, where no conversation is drawn" : "the native copy's own lines"} (not judged):\n    ${tally(unjudged).join("\n    ")}`
		)
	for (const entry of CONSOLE_EXCUSED) {
		const hit = heard.filter((h) => h.remote && excusedBy(h) === entry)
		if (hit.length) console.log(`[console] excused on the remote's page — ${entry.why}:\n    ${tally(hit, true).join("\n    ")}`)
	}
	const judged = heard.filter((h) => judgedLine(h) && !excusedBy(h))
	for (const line of tally(judged, true)) failAbsolute(`[console] ${line}`)
}

/* ── one widget's subtree ─────────────────────────────────────────────── */

/**
 * Everything the gate reads off one widget's subtree (`sel`): its tree, every
 * element's attributes and own text, the computed STYLE_PROPS (its root's
 * placement left out), where each scroller stands, and what shows behind it.
 * Written for the conversation first (the clock sample, `sp-scroll`'s own
 * drawing); inert for a widget that has neither.
 */
export async function readShape(page: Page, sel: string) {
	return page.evaluate(
		({ sel, props, placement, idrefs, hostFlags, clock }) => {
			const root = document.querySelector(sel) as HTMLElement
			const tree: string[] = []
			const nodes: Array<[Element, string]> = []
			// A host element's `children` are what the widget placed there,
			// wherever the host seated them; the host's own drawing is the
			// host's in either copy, and is compared through what it was given.
			const walk = (el: Element, path: string) => {
				const cls = (el.getAttribute("class") ?? "")
					.split(/\s+/)
					.filter((c) => c && !/^s-[\w-]+$/.test(c))
					.sort()
					.join(".")
				const line = `${path} ${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`
				tree.push(line)
				nodes.push([el, line])
				let i = 0
				for (const c of el.children) walk(c, `${path}/${i++}`)
			}
			walk(root, "0")

			// Ids by what they name. A reference reads as the path of the
			// element it names, so a prefix both ends share (the remote box's)
			// or a generated id compares by relationship, not spelling. An id
			// itself is spelled out unless it is generated (Svelte's
			// `$props.id()`: c<n>/s<n>) or only named from inside — an id the
			// page reaches from outside (`#message-12`) must read the same.
			const lineOf = new Map(nodes)
			const refs = new Set(idrefs)
			const flags = new Set(hostFlags)
			const generated = /(^|[^A-Za-z0-9])[cs]\d+(?=$|[^A-Za-z0-9])/
			const spell = (id: string) => (generated.test(id) ? "<generated>" : id)
			const named = new Set<Element>()
			const ref = (token: string) => {
				const target = document.getElementById(token)
				if (!target) return `@missing:${spell(token)}`
				const line = lineOf.get(target)
				if (!line) return `@page:${spell(token)}`
				named.add(target)
				return `@${line.split(" ")[0]}`
			}
			const attrs = nodes.map(([el, line]) => {
				const out: Record<string, string> = {}
				const host = el.tagName.startsWith("SP-")
				for (const a of el.attributes) {
					if (a.name === "class") continue
					let v = a.value
					if (host && flags.has(a.name)) {
						if (v === "false") continue
						v = "(on)"
					} else if (refs.has(a.name)) v = v.split(/\s+/).filter(Boolean).map(ref).join(" ")
					else if (a.name === "href" && v.startsWith("#")) v = ref(v.slice(1))
					// A media file's uuid is the run's own; its shape and revision are compared.
					else if ((a.name === "src" || a.name === "href") && v.startsWith("/media/"))
						v = v.replace(/^\/media\/[0-9a-f-]{36}/i, "/media/<uuid>")
					else if (a.name === "style")
						v = v
							.split(";")
							.map((d) => d.trim().replace(/\s*:\s*/, ": "))
							.filter(Boolean)
							.sort()
							.join("; ")
					out[a.name] = v
				}
				const own = [...el.childNodes]
					.filter((n) => n.nodeType === Node.TEXT_NODE)
					.map((n) => (n as Text).data)
					.join("")
					.replace(/\s+/g, " ")
					.trim()
				if (own) out["#text"] = own
				// A logical child the host left in its park is placed but not drawn.
				if ((el as Element & { checkVisibility?: () => boolean }).checkVisibility?.() === false) out["#shown"] = "no"
				return { path: line, attrs: out }
			})
			for (const [i, [el]] of nodes.entries())
				if (el.id && (generated.test(el.id) || named.has(el))) attrs[i]!.attrs.id = generated.test(el.id) ? "<generated>" : "<named inside>"
			for (const a of attrs) a.attrs = Object.fromEntries(Object.entries(a.attrs).sort(([x], [y]) => (x < y ? -1 : 1)))

			// Measured holding the clock sample (see CLOCK_SAMPLE), put back before returning.
			const clocks = [...root.querySelectorAll('[data-widget-part~="messages.message-time"]')]
				.map((el) => el.firstChild)
				.filter((n): n is Text => n instanceof Text)
			const real = clocks.map((n) => n.data)
			const px = (v: string) => v.replace(/-?\d+(?:\.\d+)?px/g, (m) => `${Math.round(parseFloat(m))}px`)
			/**
			 * Where a scroller stands, or null when it does not scroll: it can
			 * (its overflow lets a person scroll it; the page unless its root
			 * hides overflow) and has somewhere to go. Read by distance from the
			 * bottom, where a conversation opens: its newest line.
			 */
			const scrollOf = (el: Element) => {
				const page = el === document.scrollingElement
				const oy = getComputedStyle(el).overflowY
				const can = page ? oy !== "hidden" && oy !== "clip" : oy === "auto" || oy === "scroll" || oy === "overlay"
				const room = el.scrollHeight - el.clientHeight
				return can && room > 1 ? `scrolls, ${Math.round(room - el.scrollTop)}px from the bottom` : null
			}
			/**
			 * What scrolls in an sp element's OWN drawing — `sp-scroll`'s region,
			 * the log's one scroller, is the host's, and the walk (which reads a
			 * host element's logical children) never meets it. Its elements are
			 * the host's descendants whose nearest walked ancestor is the host.
			 */
			const walked = new Set(nodes.map(([el]) => el))
			const hostScrolls = (host: Element) =>
				[...host.querySelectorAll("*")]
					.filter((d) => {
						if (walked.has(d)) return false
						let a = d.parentElement
						while (a && !walked.has(a)) a = a.parentElement
						return a === host
					})
					.map(scrollOf)
					.filter(Boolean)
			const styles: Array<{ path: string; style: Record<string, string> }> = []
			try {
				for (const n of clocks) n.data = clock
				for (const [el, line] of nodes) {
					const cs = getComputedStyle(el)
					const style: Record<string, string> = {}
					const placed = el === root ? new Set(placement) : null
					for (const p of props) if (!placed?.has(p)) style[p] = px(cs.getPropertyValue(p))
					for (const pseudo of ["::before", "::after"]) {
						const ps = getComputedStyle(el, pseudo)
						const content = ps.getPropertyValue("content")
						// `none`/`normal`: no box is drawn, so nothing else of it
						// is; a drawn one (Cameo's card is the message's `::before`) is
						// read in full, like any element.
						if (content === "none" || content === "normal") continue
						style[`${pseudo} content`] = content
						for (const p of props) style[`${pseudo} ${p}`] = px(ps.getPropertyValue(p))
					}
					const scroll = [scrollOf(el), ...(el.tagName.startsWith("SP-") ? hostScrolls(el).map((s) => `its own drawing ${s}`) : [])]
						.filter(Boolean)
						.join(" / ")
					if (scroll) style["#scroll"] = scroll
					styles.push({ path: line, style })
				}
			} finally {
				clocks.forEach((n, i) => (n.data = real[i]!))
			}
			// The scrollers above it — for the remote, its box and the box's
			// ancestors — up to the page. Only the ones that scroll are named,
			// so the two copies' different wrappers do not count.
			const above: string[] = []
			for (let e = root.parentElement; e; e = e.parentElement) {
				const s = scrollOf(e)
				if (s) above.push(`${e === document.scrollingElement ? "the page" : e.tagName.toLowerCase()} ${s}`)
			}
			const scrollAbove = above.join(" / ") || "none"
			// Contrast is also what shows through from above the subtree.
			let backdrop = "none"
			for (let e = root.parentElement; e; e = e.parentElement) {
				const cs = getComputedStyle(e)
				const bg = cs.getPropertyValue("background-color")
				const image = cs.getPropertyValue("background-image")
				if (bg !== "rgba(0, 0, 0, 0)" || image !== "none") {
					backdrop = `${bg} ${image}`
					break
				}
			}
			return { tree, attrs, styles, backdrop, scrollAbove }
		},
		{ sel, props: STYLE_PROPS, placement: PLACEMENT_PROPS, idrefs: IDREFS, hostFlags: HOST_FLAGS, clock: CLOCK_SAMPLE }
	)
}

/** axe, scoped to the widget's subtree: violations and undecided rules, per node count. */
export async function readAxe(page: Page, sel: string) {
	// axe, scoped to the conversation.
	// Served same-origin through the test's own interception: the page's CSP
	// refuses an inline script, and nothing is written into the app.
	if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ url: "/__gate_axe.js" })
	// Undecided counts too: a rule axe could not settle on the remote is one
	// the gate cannot vouch for (scrolled-off rows inside the remote's box
	// came back "overlapped" on color-contrast while the native copy's were judged).
	return page.evaluate(async (sel) => {
		type Result = { id: string; nodes: Array<{ any?: Array<{ message?: string }> }> }
		// @ts-expect-error injected
		const r = await window.axe.run(document.querySelector(sel), { resultTypes: ["violations", "incomplete"] })
		return {
			axe: (r.violations as Result[]).map((v) => `${v.id}×${v.nodes.length}`).sort(),
			axeUndecided: (r.incomplete as Result[])
				.map((v) => ({
					rule: v.id,
					nodes: v.nodes.length,
					why: [...new Set(v.nodes.map((n) => n.any?.[0]?.message ?? "").filter(Boolean))].join(" / ").slice(0, 300)
				}))
				.sort((a, b) => (a.rule < b.rule ? -1 : 1))
		}
	}, sel)
}

/** Keyboard: from the top of the widget, the Tab order inside it. */
export async function readTabs(page: Page, sel: string): Promise<string[]> {
	// Keyboard: from the top of the conversation, the Tab order inside it.
	return page.evaluate(async (sel) => {
		const root = document.querySelector(sel) as HTMLElement
		const all = [...root.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,[tabindex]")].filter(
			(e) => !e.hasAttribute("disabled") && e.tabIndex >= 0 && e.offsetParent !== null
		)
		return all.map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 24) ?? ""}]`)
	}, sel)
}


/** The pin the messages widget wears (`null`: none), set through the page and waited back from it. */
export async function pinMessages(page: Page, ref: { slug: string; id?: number } | null) {
	await open(page, view(false).url)
	await ready(page, view(false))
	await page.evaluate(async (ref) => {
		const live = (globalThis as unknown as { __gateImport: (path: string) => Promise<any> }).__gateImport
		const s = await live("/src/lib/client/stores/widgetStyles.svelte.ts")
		const store = s.widgetStylesStore() as { rows?: Array<{ id: number; slug: string }>; pins: Record<string, { slug: string }> }
		for (let i = 0; i < 50 && !store.rows?.length; i++) await new Promise((r) => setTimeout(r, 100))
		const id = ref ? (ref.id ?? store.rows?.find((r) => r.slug === ref.slug)?.id) : undefined
		if (ref && id == null) throw new Error(`no style '${ref.slug}'`)
		const at = () => store.pins.messages?.slug ?? null
		// The pin round-trips through the server (the page re-reads its layout
		// settings); asked again once if the first write was lost to a reload.
		for (let attempt = 0; attempt < 2 && at() !== (ref?.slug ?? null); attempt++) {
			s.setWidgetStylePin("messages", ref ? { id: id!, slug: ref.slug } : null)
			for (let i = 0; i < 100 && at() !== (ref?.slug ?? null); i++) await new Promise((r) => setTimeout(r, 100))
		}
		if (at() !== (ref?.slug ?? null)) throw new Error(`the pin to '${ref?.slug ?? "none"}' did not come back from the page`)
	}, ref)
}
// A system style's slug is `<widget>:<preset>` (`systemStyleSlug`).
export const pinPack = (page: Page, pack: string) => pinMessages(page, { slug: `messages:${pack}` })

/* ── the instance: the gate's model, and putting things back ─────────── */

/** The gate's model: GATE_MODEL_URL when given, else one started here — either way under this run's own path (fakeModel.mjs). */
export async function fakeModel(): Promise<{ server?: Server; baseUrl: string }> {
	const run = `/run-${Date.now().toString(36)}`
	if (process.env.GATE_MODEL_URL) {
		const given = process.env.GATE_MODEL_URL.replace(/\/+$/, "")
		// One started before replies were counted streams the same text every
		// time: the swipe step could not tell a new reply from the old one.
		const said = await fetch(`${given}/models`)
			.then((r) => r.json() as Promise<{ gateReplies?: unknown }>)
			.catch((e) => ({ gateReplies: `unreachable: ${firstLine(e)}` }))
		if (said.gateReplies !== REPLY_SHAPE)
			throw new Error(
				`GATE_MODEL_URL ${given} is not this fakeModel.mjs (its /models says gateReplies ${JSON.stringify(said.gateReplies)}, not "${REPLY_SHAPE}"): ` +
					`restart it (node scripts/c7Gate/fakeModel.mjs <port>), or leave GATE_MODEL_URL unset and the gate starts its own`
			)
		const u = new URL(given)
		return { baseUrl: `${u.origin}${run}${u.pathname}` }
	}
	const server = fakeModelServer() as Server
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
	return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}${run}/v1` }
}

/** What the run changes on the instance, as it was before — each read once, before the first write. */
export type Prior = {
	chat?: { connectionId: number | null; connectionModelId: number | null } | null
	addresses?: Array<{ id: number; name: string; baseUrl: string }>
	pin?: { id: number; slug: string } | null
	/** The user's theme and dark mode (held at FRESH_LOOK for the run). */
	look?: { theme: string; darkMode: boolean }
	/** The gate connection's overrides on WIRE_KEYS, as stored (cleared for the run); null: the run makes the connection. */
	wire?: { id: number; overrides: Record<string, number | false> } | null
}

/**
 * Where the prior values wait while the run holds the instance, for a person
 * to put back by hand if the run cannot: outside the project, which the dev
 * server watches (a file written there reloads the page under test).
 */
export const PRIOR_FILE = (() => {
	const project = fileURLToPath(new URL("../../", import.meta.url))
	const within = relative(project, tmpdir())
	return join(!within.startsWith("..") && !isAbsolute(within) ? "/tmp" : tmpdir(), `c7gate-restore-${process.pid}.json`)
})()
export const saidChat = (c: Prior["chat"]) => (c ? `connection ${c.connectionId ?? "none"} / model ${c.connectionModelId ?? "none"}` : "none")
export const saidAddress = (c: { id: number; name: string; baseUrl: string }) => `"${c.name}" (connection ${c.id}) at ${c.baseUrl}`
export const saidPin = (p: Prior["pin"]) => (p ? `${p.slug} (style ${p.id})` : "none")
export const saidLook = (l: { theme: string; darkMode: boolean }) => `theme ${l.theme}, dark mode ${l.darkMode ? "on" : "off"}`
export const saidOverrides = (o: Record<string, number | false>) =>
	Object.keys(o).length ? Object.entries(o).map(([k, g]) => `${k} = ${g}`).join(", ") : "none"
/**
 * A stored override as `connections:setCapability` takes it back: absent is
 * cleared (null), off is false, a grade is its band — WIRE_KEYS are binary,
 * where 1 is native and 0 is what `emulated` walks down to (`gradeOf`).
 */
export const overrideValue = (g: number | false | undefined) => (g === undefined ? null : g === false ? false : g >= 1 ? "native" : "emulated")
export function saidPrior(prior: Prior) {
	const parts: string[] = []
	if (prior.chat !== undefined) parts.push(`Chat text->text = ${saidChat(prior.chat)}`)
	if (prior.addresses)
		parts.push(prior.addresses.length ? `connection address ${prior.addresses.map(saidAddress).join(", ")}` : "no gate connection yet (one is made)")
	if (prior.pin !== undefined) parts.push(`messages pin of session ${SESSION} = ${saidPin(prior.pin)}`)
	if (prior.look) parts.push(saidLook(prior.look))
	if (prior.wire) parts.push(`overrides of connection ${prior.wire.id} on ${WIRE_KEYS.join("/")} = ${saidOverrides(prior.wire.overrides)}`)
	return parts.join("; ")
}
/** Said, and kept in PRIOR_FILE, once read and before the first write. */
export async function keepPrior(prior: Prior) {
	console.log(`[gate] before: ${saidPrior(prior)} — kept in ${PRIOR_FILE} until put back`)
	const restore = [
		prior.chat !== undefined && {
			event: "connections:setDefault",
			params: { capability: "text->text", id: prior.chat?.connectionId ?? null, modelId: prior.chat?.connectionModelId ?? null }
		},
		...(prior.addresses ?? []).map((c) => ({ event: "connections:update", params: { connection: { id: c.id, baseUrl: c.baseUrl } } })),
		prior.pin !== undefined && {
			what: `session ${SESSION}'s messages widget style pin (set it in the session's layout, or through setWidgetStylePin)`,
			pin: prior.pin ? { id: prior.pin.id, slug: prior.pin.slug } : null
		},
		prior.look && { event: "userSettings:updateTheme", params: { theme: prior.look.theme } },
		prior.look && { event: "userSettings:updateDarkMode", params: { enabled: prior.look.darkMode } },
		...(prior.wire
			? WIRE_KEYS.map((capability) => ({
					event: "connections:setCapability",
					params: { id: prior.wire!.id, capability, value: overrideValue(prior.wire!.overrides[capability]) }
				}))
			: [])
	].filter(Boolean)
	await writeFile(
		PRIOR_FILE,
		JSON.stringify({ instance: URL_BASE, session: SESSION, readAt: new Date().toISOString(), prior, restore }, null, "\t") + "\n"
	)
}

/** A GATE_SESSION the gate did not build is refused before anything is written. */
export async function refuseForeignSession(page: Page) {
	await open(page, URL_BASE)
	await booted(page)
	const list: Array<{ id: number; name: string }> = (await ask(page, "sessions:list", {}))?.sessionList ?? []
	const name = list.find((s) => s.id === SESSION)?.name
	if (!name?.startsWith(FIXTURE_NAME))
		throw new Error(
			`GATE_SESSION=${SESSION} is ${name ? `"${name}"` : "no session this user can see"}, not a fixture ("${FIXTURE_NAME} …"). ` +
				`The gate writes into the session it judges (stream lines, an edit, a swipe): name one it built, or leave GATE_SESSION unset.`
		)
}

/** Point Chat at the fake host, through the app's own socket (admin). */
export async function useFakeModel(page: Page, baseUrl: string, prior: Prior) {
	await open(page, view(false).url)
	await ready(page, view(false))
	// Read before anything is written; a retried step keeps the first reading.
	if (!("chat" in prior)) {
		const settings = await ask(page, "systemSettings:get", {})
		prior.chat = settings?.capabilityDefaults?.["text->text"] ?? null
	}
	if (!("pin" in prior)) {
		const layout = await ask(page, "sessions:panelLayout:get", { sessionId: SESSION }, { where: { sessionId: SESSION } })
		prior.pin = layout?.layoutSettings?.widgetStyles?.messages ?? null
	}
	if (!("look" in prior)) {
		const settings = (await ask(page, "userSettings:get", {}))?.userSettings
		prior.look = { theme: settings?.theme ?? FRESH_LOOK.theme, darkMode: settings?.darkMode ?? FRESH_LOOK.darkMode }
	}
	// One connection for the gate, re-pointed at this run's fake host (older
	// runs' "Gate stream …" connections too), so nothing Chat can reach calls
	// a host that is gone.
	const NAME = "C7 gate stream"
	const rows: Array<{ id: number; name: string; baseUrl: string }> = (await ask(page, "connections:list", {}))?.connectionsList ?? []
	const mine = rows.filter((r) => r.name === NAME || r.name?.startsWith("Gate stream "))
	if (!("wire" in prior)) {
		const gate = mine.find((r) => r.name === NAME)
		if (gate) {
			const got = await ask(page, "connections:capabilities", { id: gate.id }, { where: { connectionId: gate.id } })
			if (!got?.capabilities) throw new Error(`the gate connection's capabilities could not be read: ${JSON.stringify(got)}`)
			const stored: Record<string, number | false> = got.capabilities.overrides ?? {}
			prior.wire = { id: gate.id, overrides: Object.fromEntries(WIRE_KEYS.filter((k) => k in stored).map((k) => [k, stored[k]!])) }
		} else prior.wire = null
	}
	if (!prior.addresses) {
		prior.addresses = mine.map(({ id, name, baseUrl }) => ({ id, name, baseUrl }))
		await keepPrior(prior)
	}
	for (const r of mine) await ask(page, "connections:update", { connection: { id: r.id, baseUrl, extraJson: { apiKey: "gate" } } })
	const made = mine.find((r) => r.name === NAME)
		? { connection: mine.find((r) => r.name === NAME) }
		: await ask(page, "connections:create", {
				connection: { name: NAME, type: "openai", baseUrl, model: "gate-model", enabled: true, extraJson: { apiKey: "gate" } }
			})
	if (!made?.connection?.id) throw new Error(`the gate's connection was refused: ${JSON.stringify(made)}`)
	// A default names the MODEL on the endpoint (0114).
	const listed = await ask(page, "connections:models", { id: made.connection.id })
	const modelId = listed?.models?.[0]?.id
	if (!modelId) throw new Error(`the gate's connection has no model: ${JSON.stringify(listed)}`)
	const set = await ask(page, "connections:setDefault", { capability: "text->text", id: made.connection.id, modelId }, { refusable: true })
	if (!set?.ok) throw new Error(`the gate's connection could not be Chat's default: ${JSON.stringify(set)}`)
	// What the goldens were recorded in, held for the run (and put back).
	const look = prior.look!
	if (look.theme !== FRESH_LOOK.theme) await ask(page, "userSettings:updateTheme", { theme: FRESH_LOOK.theme })
	if (look.darkMode !== FRESH_LOOK.darkMode) await ask(page, "userSettings:updateDarkMode", { enabled: FRESH_LOOK.darkMode })
	const id = made.connection.id as number
	let resolved: Record<string, unknown> | undefined
	for (const capability of WIRE_KEYS) {
		const cleared = await ask(page, "connections:setCapability", { id, capability, value: null }, { where: { connectionId: id } })
		if (!cleared?.capabilities) throw new Error(`the gate connection's ${capability} override could not be cleared: ${JSON.stringify(cleared)}`)
		resolved = cleared.capabilities.resolved ?? {}
	}
	const wire = resolved?.wire_chat ? "chat" : resolved?.wire_completion ? "completion" : "chat (the type's declaration)"
	console.log(
		`[gate] held at a fresh instance's defaults, as the goldens were recorded: ${saidLook(FRESH_LOOK)}; ` +
			`the gate connection (${id}) with no override on ${WIRE_KEYS.join(", ")} — wire mode ${wire}`
	)
	if (wire === "completion")
		failAbsolute(
			`[gate] the gate connection (${id}) resolves to wire mode completion with its overrides cleared (its preset or last test says so); ` +
				`the goldens were recorded on chat, and their Continue notice says so`
		)
}

/**
 * Put back what the run changed, each part on its own so one refusal does not
 * keep the others; a part that cannot be put back is a problem, and names
 * what it was. PRIOR_FILE goes once everything is back, and stays otherwise.
 */
export async function restoreInstance(page: Page, prior: Prior) {
	let failed = 0
	const put = async (what: string, was: string, fn: () => Promise<void>) => {
		try {
			await steady(page, `restore ${what}`, fn)
		} catch (e) {
			failed++
			problems.push(`[restore] ${what} could not be put back: ${firstLine(e)} — it was ${was} (every prior value: ${PRIOR_FILE})`)
		}
	}
	if (prior.pin !== undefined && SESSION)
		await put("the messages style pin", `${saidPin(prior.pin)} on session ${SESSION}`, () => pinMessages(page, prior.pin ?? null))
	if (prior.chat !== undefined)
		await put("Chat's default", saidChat(prior.chat), async () => {
			await open(page, URL_BASE)
			await booted(page)
			const was = prior.chat
			if (was?.connectionId != null && was.connectionModelId == null)
				throw new Error(`it named connection ${was.connectionId} with no model, which setDefault no longer accepts`)
			await ask(page, "connections:setDefault", { capability: "text->text", id: was?.connectionId ?? null, modelId: was?.connectionModelId ?? null }, { refusable: true })
		})
	for (const c of prior.addresses ?? [])
		await put(`the address of "${c.name}"`, saidAddress(c), async () => {
			await open(page, URL_BASE)
			await booted(page)
			await ask(page, "connections:update", { connection: { id: c.id, baseUrl: c.baseUrl } })
		})
	const look = prior.look
	if (look && (look.theme !== FRESH_LOOK.theme || look.darkMode !== FRESH_LOOK.darkMode))
		await put("the theme and dark mode", saidLook(look), async () => {
			await open(page, URL_BASE)
			await booted(page)
			await ask(page, "userSettings:updateTheme", { theme: look.theme })
			await ask(page, "userSettings:updateDarkMode", { enabled: look.darkMode })
		})
	const wire = prior.wire
	if (wire && Object.keys(wire.overrides).length)
		await put(`the overrides of connection ${wire.id} on ${WIRE_KEYS.join("/")}`, saidOverrides(wire.overrides), async () => {
			await open(page, URL_BASE)
			await booted(page)
			for (const capability of WIRE_KEYS)
				await ask(
					page,
					"connections:setCapability",
					{ id: wire.id, capability, value: overrideValue(wire.overrides[capability]) },
					{ where: { connectionId: wire.id } }
				)
		})
	if (!prior.addresses) return
	if (failed) console.log(`[gate] ${failed} part(s) not put back; the prior values stay in ${PRIOR_FILE}`)
	else await rm(PRIOR_FILE, { force: true })
}

/* ── judging a pack ───────────────────────────────────────────────────── */

/**
 * What differs between two runs and says nothing about either copy, taken out
 * when a live copy is judged against a recording: the fake reply's counter,
 * the clock beside a name, and database numbers in spelled-out ids (`id`,
 * `href`, a host element's `ref`, a reference to an element outside the
 * conversation) — numbered in order of appearance, per attribute. That
 * numbering reads the same for ids swapped between rows, shifted, or a wrong
 * `ref`, and the media uuid and reply counter are gone too: `checkRecords`
 * holds each to the session's own records instead, outright. (Unchanged, so
 * the goldens recorded through it still read the same.) A reference resolved
 * to a path has no database number in it and is left alone.
 */
export const DB_NUMBERED = new Set(["id", "href", "ref", ...IDREFS])
export function goldenize(s: Snapshot): Snapshot {
	const numbers = new Map<string, Map<string, string>>()
	const ordinal = (name: string, v: string) =>
		v
			.split(" ")
			.map((token) => {
				if (/^@[\d/]+$/.test(token)) return token
				const seen = numbers.get(name) ?? numbers.set(name, new Map()).get(name)!
				return token.replace(/\d+/g, (d) => seen.get(d) ?? seen.set(d, `#${seen.size + 1}`).get(d)!)
			})
			.join(" ")
	const text = (v: string) => v.replace(/\br\d+(?= w0\b)/g, "r#").replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/g, "<time>")
	return {
		...s,
		attrs: s.attrs.map(({ path, attrs }) => ({
			path,
			attrs: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, DB_NUMBERED.has(k) ? ordinal(k, text(v)) : text(v)]))
		})),
		tabs: s.tabs.map(text)
	}
}

export const shown = (v: string | undefined) => (v === undefined ? "∅" : JSON.stringify(v.length > 90 ? `${v.slice(0, 87)}…` : v))

/** Every difference of one kind (an attribute, a property), counted, with its first example. */
export function tallyDiffs(
	pack: string,
	a: Array<{ path: string; map: Record<string, string> }>,
	b: Array<{ path: string; map: Record<string, string> }>,
	label: (k: string) => string,
	[was, now]: readonly [string, string] = ["native", "remote"]
) {
	const other = new Map(b.map((s) => [s.path, s.map]))
	const byKey = new Map<string, { n: number; first: string }>()
	for (const s of a) {
		const o = other.get(s.path)
		if (!o) continue
		for (const k of new Set([...Object.keys(s.map), ...Object.keys(o)]))
			if (s.map[k] !== o[k]) {
				const seen = byKey.get(k)
				if (seen) seen.n++
				else byKey.set(k, { n: 1, first: `${s.path}: ${was} ${shown(s.map[k])} ≠ ${now} ${shown(o[k])}` })
			}
	}
	for (const [k, { n, first }] of byKey)
		problems.push(`[${pack}] ${label(k)} differs on ${n} element${n > 1 ? "s" : ""} — first at ${first}`)
}

/**
 * Two snapshots, every difference a problem. `names` says what each side is
 * (the conversation's: the native copy's recording, and the remote).
 */
export const compare = (pack: string, a0: Snapshot, b0: Snapshot, recorded: boolean, names: readonly [string, string] = ["native", "remote"]) => {
	const [was, now] = names
	const subject = was === "native" ? "conversation" : "widget"
	const wasCopy = was === "native" ? "native copy" : was
	const [a, b] = recorded ? [goldenize(a0), goldenize(b0)] : [a0, b0]
	const n = Math.max(a.tree.length, b.tree.length)
	for (let i = 0; i < n; i++)
		if (a.tree[i] !== b.tree[i]) {
			problems.push(`[${pack}] structure differs at #${i}:\n    ${was} ${a.tree[i] ?? "∅"}\n    ${now} ${b.tree[i] ?? "∅"}`)
			break
		}
	tallyDiffs(
		pack,
		a.attrs.map((s) => ({ path: s.path, map: s.attrs })),
		b.attrs.map((s) => ({ path: s.path, map: s.attrs })),
		(k) => (k === "#text" ? "text" : k === "#shown" ? "being drawn" : `@${k}`),
		names
	)
	tallyDiffs(
		pack,
		a.styles.map((s) => ({ path: s.path, map: s.style })),
		b.styles.map((s) => ({ path: s.path, map: s.style })),
		(k) => (k === "#scroll" ? "where it stands scrolled (distance from the bottom)" : k),
		names
	)
	// Per rule: the remote breaks no rule on more nodes than the native copy does.
	const counts = (list: string[]) =>
		new Map(
			list.map((v) => {
				const [id, count] = v.split("×")
				return [id!, Number(count)] as const
			})
		)
	const nativeAxe = counts(a.axe)
	for (const [id, count] of counts(b.axe))
		if (count > (nativeAxe.get(id) ?? 0)) problems.push(`[${pack}] axe: the ${now} breaks ${id} on ${count} node(s), the ${wasCopy} on ${nativeAxe.get(id) ?? 0}`)
	const nativeUndecided = new Map(a.axeUndecided.map((u) => [u.rule, u.nodes]))
	for (const u of b.axeUndecided)
		if (u.nodes > (nativeUndecided.get(u.rule) ?? 0))
			problems.push(`[${pack}] axe could not decide ${u.rule} on ${u.nodes} node(s) of the ${now}, ${nativeUndecided.get(u.rule) ?? 0} of the ${wasCopy}: ${u.why}`)
	if (a.backdrop !== b.backdrop) problems.push(`[${pack}] what shows behind the ${subject} differs: ${was} ${a.backdrop} ≠ ${now} ${b.backdrop}`)
	if (a.scrollAbove !== b.scrollAbove) problems.push(`[${pack}] what scrolls above the ${subject} differs: ${was} ${a.scrollAbove} ≠ ${now} ${b.scrollAbove}`)
	if (JSON.stringify(a.tabs) !== JSON.stringify(b.tabs))
		problems.push(`[${pack}] Tab order differs:\n    ${was} ${a.tabs.join(" → ")}\n    ${now} ${b.tabs.join(" → ")}`)
}

/** Re-baselining: every axe rule the remote breaks, or cannot decide, on more nodes than the old golden (`rises`). */
export function axeRises(pack: string, was: Snapshot, now: Snapshot) {
	const counts = (list: string[]) =>
		new Map(
			list.map((v) => {
				const [id, count] = v.split("×")
				return [id!, Number(count)] as const
			})
		)
	const before = counts(was.axe)
	for (const [id, n] of counts(now.axe))
		if (n > (before.get(id) ?? 0)) rises.push(`[${pack}] axe ${id}: ${before.get(id) ?? 0} → ${n} node(s)`)
	const undecided = new Map(was.axeUndecided.map((u) => [u.rule, u.nodes]))
	for (const u of now.axeUndecided)
		if (u.nodes > (undecided.get(u.rule) ?? 0)) rises.push(`[${pack}] axe could not decide ${u.rule}: ${undecided.get(u.rule) ?? 0} → ${u.nodes} node(s)`)
}

/* ── running it ───────────────────────────────────────────────────────── */

/**
 * One step of the gate, run again when the dev server reloaded the page under
 * it: another session saving a server file full-reloads every open page, and
 * that says nothing about either copy. A `load` the step did not ask for
 * (`open`, `reopen`) is such a reload; what the reloaded attempt heard and
 * found is dropped with it. A failure with no reload is the gate's answer and
 * is thrown as before — a retry never turns a real difference green.
 */
export async function steady<T>(page: Page, what: string, fn: () => Promise<T>): Promise<T> {
	const RELOADED =
		/Execution context was destroyed|because of a navigation|interrupted by another navigation|frame was detached|net::ERR_ABORTED|page\.(goto|reload|waitForLoadState): Timeout/
	for (let attempt = 1; ; attempt++) {
		let loads = 0
		const onLoad = () => void loads++
		const own = ownLoads
		const heardAt = heard.length
		const problemsAt = problems.length
		stepName = what
		page.on("load", onLoad)
		try {
			const out = await fn()
			if (loads <= ownLoads - own) return out
		} catch (e) {
			if (loads <= ownLoads - own && !RELOADED.test(String((e as Error)?.message ?? e))) throw e
		} finally {
			page.off("load", onLoad)
		}
		heard.length = heardAt
		problems.length = problemsAt
		if (attempt >= 4) throw new Error(`${what}: the dev server reloaded the page on ${attempt} runs in a row`)
		console.log(`[gate] ${what}: the dev server reloaded the page mid-step; running it again`)
	}
}

/** A recording, refused when it predates what this gate reads. */
export async function readGolden<T extends { format?: number }>(name: string): Promise<T> {
	const value = JSON.parse(await readFile(new URL(`${name}.json`, GOLDENS), "utf8")) as T
	if (value?.format !== GOLDEN_FORMAT)
		throw new Error(`goldens/${name}.json is format ${value?.format ?? 1}; this gate reads format ${GOLDEN_FORMAT} — record it again (GATE_RECORD=1${ONE_PAGE ? " GATE_REBASELINE=1" : ""})`)
	return value
}
/**
 * Goldens are held until the browser is closed: the dev server watches the
 * whole project, so a file written mid-run full-reloads the page under test.
 */
export const recorded = new Map<string, unknown>()
export const record = (name: string, value: unknown) => void recorded.set(name, value)
/** Re-baselining: what the remote gave no whole answer for — then nothing is written. */
export const unrecorded: string[] = []
export async function writeGoldens() {
	await mkdir(GOLDENS, { recursive: true })
	for (const [name, value] of recorded)
		await writeFile(new URL(`${name}.json`, GOLDENS), JSON.stringify(value, null, "\t") + "\n")
}

/**
 * The admin the gate signs in as, on an instance with accounts on
 * (`GATE_ADMIN_USERNAME` / `GATE_ADMIN_PASSWORD`); null where accounts are
 * off and every page is the instance's one admin already.
 */
export const GATE_ADMIN =
	process.env.GATE_ADMIN_USERNAME && process.env.GATE_ADMIN_PASSWORD
		? { username: process.env.GATE_ADMIN_USERNAME, passphrase: process.env.GATE_ADMIN_PASSWORD }
		: null

/**
 * Sign `page`'s browser context in (`/api/login` sets its cookie) — from the
 * page itself, with the browser's own user agent: the socket's handshake
 * holds the token to the browser and system it was issued to, and
 * Playwright's request client names neither as the page does.
 */
export async function signIn(page: Page, who: { username: string; passphrase: string }) {
	await page.goto(`${URL_BASE}/api/system-settings`, { waitUntil: "load" })
	const said = await page.evaluate(async (who) => {
		const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(who) })
		return { ok: res.ok, status: res.status, text: res.ok ? "" : await res.text() }
	}, who)
	if (!said.ok) throw new Error(`signing in as ${who.username} was refused: ${said.status} ${said.text}`)
}

/**
 * A page the gate drives: its timeouts, the helpers its page functions need,
 * axe served same-origin, and every console line it says heard (`heard`).
 * The second socket a push is timed from is another of these.
 */
export async function gatePage(browser: Browser): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	// A dev server shared with other work can stall a load for a while; a
	// press or a read a person makes is answered well inside 15s, or it is not.
	page.setDefaultNavigationTimeout(90_000)
	page.setDefaultTimeout(15_000)
	// tsx names functions it transpiles (`__name(fn, "x")`); the functions this
	// file hands the page carry that call, and the page has no such helper.
	await page.addInitScript("globalThis.__name = (f) => f")
	// The app's own module, not a second copy of it: once the dev server has
	// hot-updated a module, the page imports it as `…?t=<stamp>`, and a bare
	// `import("/src/…")` is another instance with none of the app's state (no
	// pin writer, no socket). The page's resource list names the one it runs.
	await page.addInitScript(`
		performance.setResourceTimingBufferSize(100000)
		globalThis.__gateImport = (path) => {
			const runs = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => new URL(n).pathname === path)
			return import(runs.length ? runs[runs.length - 1] : path)
		}
	`)
	await page.route("**/__gate_axe.js", (route) =>
		route.fulfill({ status: 200, contentType: "text/javascript", body: axeSource })
	)
	// An instance with accounts on answers no one who has not signed in.
	if (GATE_ADMIN) await signIn(page, GATE_ADMIN)
	// Worker lines arrive here too (`worker()` names the realm).
	page.on("console", (m) => {
		const kind = m.type()
		if (kind === "warning" || kind === "error")
			heard.push({ step: stepName, remote: onRemote, kind, text: m.text(), worker: !!m.worker(), url: m.location().url ?? "" })
	})
	page.on("pageerror", (e) => heard.push({ step: stepName, remote: onRemote, kind: "pageerror", text: e.message, worker: false, url: "" }))
	return page
}

/**
 * A remote that stopped leaves the host's overlay beside its box: for the
 * widget whose root is `sel`, that is a failure whatever else it shows.
 */
export async function noteHostOverlay(page: Page, sel: string, what: string) {
	const fatal = await page.evaluate(
		({ sel, box }) => {
			const b = document.querySelector(sel)?.closest(box)
			const alert = b?.parentElement?.querySelector(":scope > [role=alert]")
			return alert ? (alert.textContent ?? "").replace(/\s+/g, " ").trim() || "(no text)" : null
		},
		{ sel, box: REMOTE_BOX }
	)
	if (fatal !== null) failAbsolute(`${what}: the remote stopped — the host's overlay says "${fatal}"`)
}
