/**
 * Plugin frames (20 §12, 21 §7), live: a plugin's documents mounted in
 * opaque-origin iframes at all three frame points — a `panel` seated in a
 * session's layout, a genre's `session-view`, and a `page` at `/x/<plugin>` —
 * judged against a real instance. The unit tests (`frames/*.test.ts`,
 * `frameHost.int.test.ts`) prove each piece; this proves the pieces meet.
 *
 * The fixture is a package the spec writes itself (`gate.frames`, outside the
 * project — a file written inside it reloads the page under test) and
 * installs through the app's own dev-install verb (`plugins:installLocal`),
 * driven from the page: one document, `ui/probe.html`, declared as all three
 * surfaces; a panel viewing the `main` channel; a network grant, so the CSP
 * has something to compose; and a genre whose shape names the plugin as its
 * `view`. The document records everything the host posts it, and draws one
 * button a person presses.
 *
 * The steps, in order, each a sentence judged against the golden's, the
 * first failure stopping the rest (each needs the one before):
 *   1. install — lands disabled; its documents answer 404 until switched on;
 *   2. review + switch on — the review grants what it declares;
 *   3. served — the document comes with a CSP composed from the grants
 *      (sandboxed, framed by this origin only, `connect-src` = the granted
 *      host), X-Frame-Options SAMEORIGIN and nosniff; denying the host takes
 *      it out of `connect-src` (re-granted after);
 *   4. seat — a session's stored layout seats the panel; it mounts in an
 *      `<iframe sandbox="allow-scripts">` (never `allow-same-origin`) and
 *      boots on the port the host transfers;
 *   5. sections — it is sent only its lanes (`channel` posts for `main`,
 *      never the whole log), no scoped section and no grants (a frame is
 *      granted none), and every row it holds — pushed or paged — arrives
 *      without the host's fields (`MESSAGE_HOST_FIELDS`: `debugMeta`,
 *      `embedding`, `userId`, …) the page's own copy carries;
 *   6. unprompted — the document's own invoke of `core#hide`, on load, is
 *      refused with the host's warning (the check — said once, taken off the
 *      judged lines) and the line stays shown;
 *   7. a person's press — clicking the document's button lets the same
 *      invoke through: the line is hidden on the server and the frame is
 *      pushed the hidden row; pressed again, it is shown again;
 *   8. session-view — a session of the fixture's genre is drawn by the
 *      frame in place of core's conversation, fed the session and its rows
 *      (projected), and nothing only a widget is sent;
 *   9. page — `/x/gate.frames` mounts the page surface, sandboxed, sent no
 *      session, no rows and no actions;
 *  10. disabled (three steps, one load each) — switched off, every frame
 *      goes: the documents 404, the panel's cell is gone, the session-view
 *      session falls back to core's conversation, and the page says the
 *      extension is not found.
 * What it made it uninstalls (the plugin, and with it its genre and files).
 *
 * Needs SP_PLUGINS_ENABLED=1 (a dev install asks for it) and an admin: the
 * gate signed in as one (GATE_ADMIN_USERNAME / GATE_ADMIN_PASSWORD) where
 * accounts are on.
 *
 * Golden (`goldens/frames.json`): the step sentences, which name what each
 * frame was sent (the kinds, sorted), so a new section reaching a frame is a
 * difference to look at.
 */
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { Frame, Page } from "playwright"
import { compile, sessionEvents, spec, MESSAGE_HOST_FIELDS } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import {
	FIXTURE_NAME,
	GOLDEN_FORMAT,
	RECORDS_REMOTE,
	REPLY,
	URL_BASE,
	ask,
	booted,
	failAbsolute,
	firstLine,
	heard,
	open,
	problems,
	readGolden,
	record,
	steady,
	unrecorded
} from "../engine"
import { openSession } from "./kit"

export const FRAMES = "frames"
const PLUGIN = "gate.frames"
const PANEL = "probe"
const WIDGET = `${PLUGIN}:${PANEL}`
const GENRE = `${PLUGIN}:genre/frame-view`
const ENTRY = "ui/probe.html"
const HOST = "frames-gate.example"
const PANEL_TITLE = "Frame probe"
const VIEW_TITLE = "Frame probe view"
const PAGE_TITLE = "Frame probe page"
const LINE = "Frames, good evening."
const SRC = `/plugin-ui/${PLUGIN}/${ENTRY}`

type FramesGolden = { format: number; steps: string[] }

/* ── the fixture package ──────────────────────────────────────────────── */

/**
 * The document every surface mounts. Its script is a FILE: a frame is
 * served under `script-src 'self'`, so an inline block would be refused.
 */
const PROBE_HTML = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Frame probe</title>
<style>body { margin: 0; padding: 8px; font: 13px system-ui, sans-serif; }</style>
<p id="said">waiting for the host</p>
<button id="hide" type="button">Hide the first line</button>
<script src="probe.js"></script>
</html>
`

/**
 * Records every post as the gate reads it back (`__gateLog`): its kind, and
 * for rows each row's id, channel, hidden flag and field names. On a panel it
 * invokes \`core#hide\` on its own, once, as soon as it holds actions and a
 * row — the unprompted press the host must refuse — and the button makes the
 * same invoke a person's.
 */
const PROBE_JS = `const log = []
globalThis.__gateLog = log
let port = null
let surface = null
let actions = null
let rows = []
let unprompted = false
const rowsOf = (m) => m.t === "messages" || m.t === "channel" ? m.messages : m.t === "page" ? m.rows : m.t === "message" ? [m.message] : null
const listed = (a) => Object.values(a || {}).flatMap((v) => [...(v.primary || []), ...(v.overflow || [])]).map((x) => x.specSlug + "#" + x.key)
const hide = () => {
  const first = rows.find((r) => r.role === "user") || rows[0]
  if (port && first) port.postMessage({ t: "invoke", key: "core#hide", messageId: first.id })
}
function onHost(m) {
  if (!m || typeof m !== "object") return
  const entry = { t: m.t }
  const r = rowsOf(m)
  if (r) {
    entry.rows = r.map((x) => ({ id: x.id, channel: x.channel ?? null, role: x.role ?? null, isHidden: !!x.isHidden, keys: Object.keys(x).sort() }))
    if (m.t !== "page") rows = r
  }
  if (m.t === "channel") entry.channel = m.channel
  if (m.t === "scoped") entry.section = m.section
  if (m.t === "grants") entry.grants = m.grants
  if (m.t === "response") entry.ok = m.ok
  if (m.t === "actions") { actions = m.actions; entry.listed = listed(m.actions) }
  if (m.t === "session") entry.sessionId = m.session && m.session.id
  if (m.t === "event") entry.kind = m.event && m.event.kind
  log.push(entry)
  document.getElementById("said").textContent = surface + ": " + log.length + " posts"
  if (surface === "panel" && !unprompted && actions && rows.length && listed(actions).includes("core#hide")) {
    unprompted = true
    hide()
  }
}
document.getElementById("hide").addEventListener("click", hide)
window.addEventListener("message", (e) => {
  const m = e.data
  if (!m || m.t !== "init" || !e.ports || !e.ports[0]) return
  surface = m.surface
  log.push({ t: "init", surface: m.surface, protocol: m.protocol })
  port = e.ports[0]
  port.onmessage = (ev) => onHost(ev.data)
  port.postMessage({ t: "ready" })
  if (surface === "panel") port.postMessage({ t: "request", requestId: "gate-page", what: "messages", channel: "main", limit: 50 })
})
`

/** The genre whose sessions the frame draws: the plugin is its `view`. */
const GENRE_DECL = {
	id: GENRE,
	name: { en: "C7 gate frame view" },
	family: "chat",
	description: { en: "The C7 gate's session-view fixture: its sessions are drawn by a plugin frame." },
	shape: {
		characters: { min: 0 },
		personas: { min: 0 },
		lorebook: "optional",
		composer: "text",
		voice: "character",
		greeting: { enabled: false },
		view: PLUGIN
	},
	events: { [sessionEvents.sessionCreated]: { required: true } }
}

/** The genre's one required member: its create pipeline (24 §3), compiled by the SDK as a package's is. */
function createSpec() {
	const g = GENRE_DECL
	return compile(
		spec(`${PLUGIN}:spec/create-session`, {
			version: "1.0.0",
			taxonomy: { role: "create" },
			genre: { name: g.name, family: g.family, description: g.description, shape: g.shape as never, events: g.events }
		})
			.inlet("input", C.sessionCreated.v1(), { genre: g as never, event: sessionEvents.sessionCreated })
			.query("collect", ($) => C.sessionGreetings.v1({ scope: $.input.sessionScope }))
			.outlet("seed", ($) => C.seedGreetings.v1({ greetings: $.collect.greetings, channel: "main" }))
			.build()
	)
}

/** Outside the project, which the dev server watches (as `PRIOR_FILE`). */
const PACKAGE_DIR = (() => {
	const project = fileURLToPath(new URL("../../../", import.meta.url))
	const within = relative(project, tmpdir())
	return join(!within.startsWith("..") && !isAbsolute(within) ? "/tmp" : tmpdir(), `c7gate-frames-${process.pid}`)
})()

async function writePackage() {
	const doc = createSpec() as { id: string }
	const manifest = {
		schemaVersion: 1,
		slug: PLUGIN,
		name: { en: "C7 gate frames" },
		version: "1.0.0",
		description: { en: "The C7 gate's frame fixture: one document at every frame point." },
		permissions: [`network:${HOST}`],
		surfaces: {
			"session-view": { entry: ENTRY, title: VIEW_TITLE },
			page: { entry: ENTRY, title: PAGE_TITLE },
			panels: [{ id: PANEL, entry: ENTRY, title: PANEL_TITLE, channels: ["main"] }]
		},
		genres: [GENRE_DECL],
		pipelines: [{ id: doc.id, version: "1.0.0", nodes: 3, presets: [] }]
	}
	await rm(PACKAGE_DIR, { recursive: true, force: true })
	await mkdir(join(PACKAGE_DIR, "dist/plugin/pipelines"), { recursive: true })
	await mkdir(join(PACKAGE_DIR, "ui"), { recursive: true })
	await writeFile(join(PACKAGE_DIR, "dist/plugin/manifest.json"), JSON.stringify(manifest, null, "\t"))
	await writeFile(join(PACKAGE_DIR, "dist/plugin/pipelines", `${doc.id.replace(/[:/]/g, "_")}.json`), JSON.stringify(doc, null, "\t"))
	await writeFile(join(PACKAGE_DIR, ENTRY), PROBE_HTML)
	await writeFile(join(PACKAGE_DIR, "ui/probe.js"), PROBE_JS)
}

/* ── the app, as an admin ─────────────────────────────────────────────── */

type PluginRow = { pluginId: string; enabled: boolean; needsReview: boolean }
/** What the reply must say: its plugins list holds (or lacks) the fixture, maybe switched as given; or it is about the fixture. */
type Match = { listed?: boolean; enabled?: boolean; about?: boolean }
/**
 * Emit `event` and wait for the push it answers with — `reply`, which the
 * plugin verbs name apart from themselves (they answer on `plugins:list` or
 * `plugins:permissions`) — or its refusal (`<event>:error`, `error`).
 * `match` is data, not a function: the page's CSP allows no eval.
 */
const askVia = (page: Page, event: string, params: unknown, reply: string, match: Match): Promise<any> =>
	page.evaluate(
		async ({ event, params, reply, match, plugin }) => {
			const live = (globalThis as unknown as { __gateImport: (path: string) => Promise<any> }).__gateImport
			const ts = await live("/src/lib/client/sockets/typedSocket.ts")
			const ir = await live("/src/lib/client/sockets/interest.svelte.ts")
			for (let i = 0; i < 300 && !ts.typedSocketOrNull()?.connected; i++) await new Promise((r) => setTimeout(r, 100))
			const s = ts.typedSocketOrNull()
			if (!s?.connected) throw new Error("the app's socket never connected")
			const test = (d: any) => {
				const row = (d?.plugins as Array<{ pluginId: string; enabled: boolean }> | undefined)?.find((p) => p.pluginId === plugin)
				if (match.about !== undefined && (d?.pluginId === plugin) !== match.about) return false
				if (match.listed !== undefined && (!Array.isArray(d?.plugins) || !!row !== match.listed)) return false
				if (match.enabled !== undefined && row?.enabled !== match.enabled) return false
				return true
			}
			return new Promise<any>((res, rej) => {
				const offs: Array<() => void> = []
				const done = (f: () => void) => (clearTimeout(t), offs.forEach((off) => off()), f())
				const t = setTimeout(() => done(() => rej(new Error(`timeout ${event} → ${reply}`))), 30_000)
				offs.push(ir.declareInterest(reply, (d: any) => test(d) && done(() => res(d))))
				for (const refusal of [`${event}:error`, "error"])
					offs.push(ir.declareInterest(refusal, (d: any) => done(() => rej(new Error(`${event} refused: ${d?.error}`)))))
				ir.flushInterestSync?.()
				setTimeout(() => s.emit(event, params), 120)
			})
		},
		{ event, params, reply, match, plugin: PLUGIN }
	)
const listPlugins = async (page: Page): Promise<PluginRow[]> => (await ask(page, "plugins:list", {}, { refusable: true }))?.plugins ?? []
const rowOf = (plugins: PluginRow[]) => plugins.find((p) => p.pluginId === PLUGIN)
const setEnabled = async (page: Page, enabled: boolean) =>
	rowOf(
		(
			await askVia(page, "plugins:setEnabled", { pluginId: PLUGIN, enabled }, "plugins:list", { listed: true, enabled })
		).plugins
	)
const setPermission = (page: Page, key: string, granted: boolean) =>
	askVia(page, "plugins:setPermission", { pluginId: PLUGIN, key, granted }, "plugins:permissions", { about: true })
async function uninstall(page: Page) {
	if (rowOf(await listPlugins(page)))
		await askVia(page, "plugins:uninstall", { pluginId: PLUGIN }, "plugins:list", { listed: false })
}
/** A frame document as the browser fetches it — same origin, no credentials needed. */
const fetchDoc = (page: Page, path = SRC) =>
	page.evaluate(async (path) => {
		const res = await fetch(`${path}?gate=${Date.now()}`, { cache: "no-store", credentials: "omit" })
		return {
			status: res.status,
			csp: res.headers.get("content-security-policy"),
			xfo: res.headers.get("x-frame-options"),
			nosniff: res.headers.get("x-content-type-options"),
			type: res.headers.get("content-type")
		}
	}, path)
/** Emit on the app's socket without waiting on a reply (a write whose answer is a push). */
const emit = (page: Page, event: string, params: unknown) =>
	page.evaluate(
		async ({ event, params }) => {
			const live = (globalThis as unknown as { __gateImport: (path: string) => Promise<any> }).__gateImport
			const ts = await live("/src/lib/client/sockets/typedSocket.ts")
			for (let i = 0; i < 300 && !ts.typedSocketOrNull()?.connected; i++) await new Promise((r) => setTimeout(r, 100))
			ts.typedSocketOrNull()?.emit(event, params)
		},
		{ event, params }
	)

type Row = { id: number; role?: string; isHidden?: boolean; channel?: string | null } & Record<string, unknown>
const readRows = async (page: Page, sessionId: number): Promise<Row[]> =>
	(await ask(page, "sessions:get", { id: sessionId, limit: 1000 }, { where: { "session.id": sessionId } }))?.messages ?? []
async function hiddenOnServer(page: Page, sessionId: number, id: number) {
	const row = (await readRows(page, sessionId)).find((r) => r.id === id)
	if (!row) throw new Error(`message ${id} is not in session ${sessionId}`)
	return !!row.isHidden
}

/* ── the frame, read from inside ──────────────────────────────────────── */

type Logged = {
	t: string
	surface?: string
	protocol?: number
	channel?: string
	section?: string
	grants?: string[]
	listed?: string[]
	ok?: boolean
	sessionId?: number
	rows?: Array<{ id: number; channel: string | null; role: string | null; isHidden: boolean; keys: string[] }>
}

/** The frame element `sel` names, and its document once it has booted (said `init`). */
async function frameOf(page: Page, sel: string): Promise<Frame> {
	const handle = await page.waitForSelector(sel, { timeout: 60_000 })
	const end = Date.now() + 30_000
	for (;;) {
		const frame = await handle.contentFrame()
		const booted = frame ? await frame.evaluate(() => Array.isArray((globalThis as { __gateLog?: unknown[] }).__gateLog) && (globalThis as unknown as { __gateLog: unknown[] }).__gateLog.length > 0).catch(() => false) : false
		if (frame && booted) return frame
		if (Date.now() > end) throw new Error(`the frame at ${sel} never booted (no init reached its document)`)
		await page.waitForTimeout(250)
	}
}
const logOf = (frame: Frame): Promise<Logged[]> => frame.evaluate(() => structuredClone((globalThis as unknown as { __gateLog: Logged[] }).__gateLog))
const kindsOf = (log: Logged[]) => [...new Set(log.map((e) => e.t))].sort()
/** The iframe as the host drew it. */
const frameAttrs = (page: Page, sel: string) =>
	page.evaluate((sel) => {
		const f = document.querySelector(sel) as HTMLIFrameElement | null
		return f ? { sandbox: f.getAttribute("sandbox"), src: f.getAttribute("src"), title: f.getAttribute("title"), allow: f.getAttribute("allow") } : null
	}, sel)
/** Every way the iframe must be sandboxed; each string a failure. */
function sandboxWrong(a: Awaited<ReturnType<typeof frameAttrs>>, title: string): string[] {
	if (!a) return ["no iframe is on the page"]
	const wrong: string[] = []
	if (a.sandbox !== "allow-scripts") wrong.push(`its sandbox is ${JSON.stringify(a.sandbox)}, not exactly "allow-scripts"`)
	if (a.src !== SRC) wrong.push(`its src is ${JSON.stringify(a.src)}, not ${SRC}`)
	if (a.title !== title) wrong.push(`its title is ${JSON.stringify(a.title)}, not ${JSON.stringify(title)}`)
	return wrong
}
/** Every row a frame was sent that carries one of the host's fields. */
const hostFieldsIn = (log: Logged[]) =>
	log.flatMap((e) =>
		(e.rows ?? []).flatMap((r) => r.keys.filter((k) => (MESSAGE_HOST_FIELDS as readonly string[]).includes(k)).map((k) => `${e.t} row ${r.id}: ${k}`))
	)

/**
 * A line the host must have said since `heardAt` — at least once — taken off
 * the judged lines, since saying it is the behaviour being checked.
 */
function said(heardAt: number, pattern: RegExp, what: string): number {
	let n = 0
	for (let i = heard.length - 1; i >= heardAt; i--)
		if (pattern.test(heard[i]!.text)) {
			heard.splice(i, 1)
			n++
		}
	if (!n) throw new Error(`the host never said ${what}`)
	console.log(`[console] said, as the step requires (×${n}): ${what}`)
	return n
}

/* ── the fixtures ─────────────────────────────────────────────────────── */

const cellOf = (widgetId: string) => `[data-panel-id="${widgetId}"]`
const PANEL_FRAME = `${cellOf(WIDGET)} iframe`

/** The chat session's stored layout: the probe alone on the left. */
const PANEL_LAYOUT = {
	active: [{ id: WIDGET, on: true }],
	zoneLayout: { version: 1, zones: { left: { kind: "side", side: "left", pinned: true, widgets: [WIDGET] } } },
	arrangedGrid: { left: { cols: 1, rows: 12, items: [{ id: WIDGET, x: 0, y: 0, w: 1, h: 12 }] } }
}

/** A chat session of its own, with one exchange (the gate's model answers). */
async function chatSession(page: Page): Promise<number> {
	await open(page, URL_BASE)
	await booted(page)
	const list: Array<{ id: number; name: string; isPersona: boolean }> = (await ask(page, "characters:list", {}))?.characterList ?? []
	const mira = list.find((c) => c.name === "C7 gate Mira" && !c.isPersona)?.id
	const sam = list.find((c) => c.name === "C7 gate Sam" && c.isPersona)?.id
	if (!mira || !sam) throw new Error("the conversation fixture's C7 gate Mira and Sam are not both there")
	const made = await ask(page, "sessions:create", {
		session: { name: `${FIXTURE_NAME} frames ${new Date().toISOString()}` },
		characterIds: [mira],
		personaIds: [sam],
		characterPositions: { [mira]: 0 }
	})
	const id = made?.session?.id as number | undefined
	if (!id) throw new Error(`the frames session was refused: ${JSON.stringify(made)}`)
	await openSession(page, `${URL_BASE}/sessions/${id}`)
	const field = page.locator('[data-widget-part~="messages.root"] textarea').last()
	await field.waitFor({ timeout: 60_000 })
	await page.waitForTimeout(1500)
	await field.fill(LINE)
	await field.press("Enter")
	const re = new RegExp(REPLY)
	const end = Date.now() + 60_000
	for (;;) {
		const rows = await readRows(page, id)
		if (rows.some((r) => r.role === "user") && rows.some((r) => r.role !== "user" && re.test(String(r.content ?? "").trim()))) break
		if (Date.now() > end) throw new Error(`the frames session's line got no whole reply in 60s`)
		await page.waitForTimeout(500)
	}
	return id
}

/* ── the steps ────────────────────────────────────────────────────────── */

export async function runFramesSpec(page: Page) {
	const tag = `[${FRAMES}]`
	let golden: FramesGolden | null = null
	try {
		golden = await readGolden<FramesGolden>(FRAMES)
	} catch (e) {
		if (RECORDS_REMOTE) console.log(`[rebaseline] ${firstLine(e)}: nothing to judge against, recorded afresh`)
		else problems.push(`${tag} no golden to judge against (${firstLine(e)}) — record one: GATE_RECORD=1 GATE_REBASELINE=1 GATE_SPECS=${FRAMES}`)
	}

	let chat = 0
	let viewSession = 0
	let firstLineId = 0
	/** Where the panel's first load began: its on-load press is heard from here. */
	let seatHeardAt = 0
	const steps: Array<{ name: string; run: () => Promise<string> }> = [
		{
			name: "install",
			run: async () => {
				await writePackage()
				await open(page, URL_BASE)
				await booted(page)
				await uninstall(page)
				const got = await askVia(page, "plugins:installLocal", { dir: PACKAGE_DIR }, "plugins:list", { listed: true })
				const row = rowOf(got.plugins)
				if (!row || row.enabled || !row.needsReview) throw new Error(`installed, it lists as ${JSON.stringify(row)} — it should be there, off and waiting for review`)
				const doc = await fetchDoc(page)
				if (doc.status !== 404) throw new Error(`its document answers ${doc.status} while it is off, not 404`)
				return "the dev install lands it off and waiting for its permissions' review, and its documents answer 404 until it is switched on"
			}
		},
		{
			name: "review and switch on",
			run: async () => {
				const reviewed = await askVia(page, "plugins:reviewPermissions", { pluginId: PLUGIN }, "plugins:permissions", { about: true })
				const perms = (reviewed?.permissions ?? []) as Array<{ key: string; granted: boolean; pending: boolean }>
				const wrong = perms.filter((p) => !p.granted || p.pending)
				if (!perms.length || wrong.length) throw new Error(`the review left ${JSON.stringify(perms)}`)
				const row = await setEnabled(page, true)
				if (!row?.enabled || row.needsReview) throw new Error(`switched on, it lists as ${JSON.stringify(row)}`)
				return `the review grants what it declares (${perms.map((p) => p.key).join(", ")}) and the switch turns it on`
			}
		},
		{
			name: "served",
			run: async () => {
				const want = (connect: string) =>
					[
						"default-src 'none'",
						"script-src 'self'",
						"style-src 'self' 'unsafe-inline'",
						"img-src 'self' data: blob:",
						"font-src 'self' data:",
						"media-src 'self' blob:",
						connect,
						"form-action 'none'",
						"base-uri 'none'",
						"sandbox allow-scripts",
						"frame-ancestors 'self'"
					].join("; ")
				const granted = `connect-src https://${HOST} http://${HOST} wss://${HOST} ws://${HOST}`
				const doc = await fetchDoc(page)
				const wrong: string[] = []
				if (doc.status !== 200) wrong.push(`it answers ${doc.status}`)
				if (doc.csp !== want(granted)) wrong.push(`its CSP is ${JSON.stringify(doc.csp)}, not ${JSON.stringify(want(granted))}`)
				if (doc.xfo !== "SAMEORIGIN") wrong.push(`its X-Frame-Options is ${JSON.stringify(doc.xfo)}, not SAMEORIGIN`)
				if (doc.nosniff !== "nosniff") wrong.push(`its X-Content-Type-Options is ${JSON.stringify(doc.nosniff)}`)
				if (!doc.type?.startsWith("text/html")) wrong.push(`its type is ${JSON.stringify(doc.type)}`)
				// The same grant, withdrawn: the policy follows the admin's switch.
				await setPermission(page, `network:${HOST}`, false)
				const denied = await fetchDoc(page)
				await setPermission(page, `network:${HOST}`, true)
				if (denied.csp !== want("connect-src 'none'")) wrong.push(`with the host denied, its CSP is ${JSON.stringify(denied.csp)}`)
				const back = await fetchDoc(page)
				if (back.csp !== want(granted)) wrong.push(`re-granted, its CSP is ${JSON.stringify(back.csp)}`)
				if (wrong.length) throw new Error(wrong.join("; "))
				return `its document is served under a CSP composed from its grants (sandbox allow-scripts, frame-ancestors 'self', connect-src only ${HOST}; 'none' while the host is denied), X-Frame-Options SAMEORIGIN and nosniff`
			}
		},
		{
			name: "seat",
			run: async () => {
				chat = await chatSession(page)
				const laid = await ask(page, "sessions:panelLayout:set", { sessionId: chat, layout: PANEL_LAYOUT, widgetSettings: {} }, { where: { sessionId: chat }, refusable: true })
				if (!laid?.ok) throw new Error(`the layout was refused: ${JSON.stringify(laid)}`)
				seatHeardAt = heard.length
				await openSession(page, `${URL_BASE}/sessions/${chat}`)
				const frame = await frameOf(page, PANEL_FRAME)
				const wrong = sandboxWrong(await frameAttrs(page, PANEL_FRAME), PANEL_TITLE)
				const log = await logOf(frame)
				const init = log.find((e) => e.t === "init")
				if (init?.surface !== "panel") wrong.push(`its init names the surface ${JSON.stringify(init?.surface)}, not "panel"`)
				const origin = await frame.evaluate(() => globalThis.origin)
				if (origin !== "null") wrong.push(`its document runs at origin ${JSON.stringify(origin)}, not an opaque one`)
				if (wrong.length) throw new Error(wrong.join("; "))
				return `seated by the session's stored layout, the panel mounts in <iframe sandbox="allow-scripts"> at ${SRC}, runs at an opaque origin, and boots on the port its init carries (protocol ${init?.protocol})`
			}
		},
		{
			name: "sections",
			run: async () => {
				const frame = await frameOf(page, PANEL_FRAME)
				// Settled: the page answered the probe's request, and both lines are in.
				const end = Date.now() + 20_000
				let log = await logOf(frame)
				while (!(log.some((e) => e.t === "page") && log.some((e) => e.t === "channel" && (e.rows?.length ?? 0) >= 2)) && Date.now() < end) {
					await page.waitForTimeout(250)
					log = await logOf(frame)
				}
				const wrong: string[] = []
				const kinds = kindsOf(log)
				if (kinds.includes("messages")) wrong.push("it was sent the whole log (`messages`), not its lanes")
				const lanes = [...new Set(log.filter((e) => e.t === "channel").map((e) => e.channel))]
				if (lanes.join() !== "main") wrong.push(`it was sent the lanes ${JSON.stringify(lanes)}, not main alone`)
				const off = log.flatMap((e) => (e.rows ?? []).filter((r) => (r.channel ?? "main") !== "main").map((r) => `${e.t} row ${r.id} on ${r.channel}`))
				if (off.length) wrong.push(`rows from other lanes reached it: ${off.join(", ")}`)
				const scoped = log.filter((e) => e.t === "scoped").map((e) => e.section)
				if (scoped.length) wrong.push(`it was sent scoped sections (${scoped.join(", ")}) — a frame is granted none`)
				if (kinds.includes("grants")) wrong.push(`it was told grants ${JSON.stringify(log.find((e) => e.t === "grants")?.grants)}`)
				if (!log.some((e) => e.t === "page")) wrong.push("its request for a page of main was never answered")
				const leaked = hostFieldsIn(log)
				if (leaked.length) wrong.push(`host fields reached it: ${leaked.join(", ")}`)
				// What the page's own copy carries, so "none reached it" is a claim about something.
				const own = await readRows(page, chat)
				const carried = [...new Set(own.flatMap((r) => Object.keys(r).filter((k) => (MESSAGE_HOST_FIELDS as readonly string[]).includes(k))))].sort()
				if (!carried.length) wrong.push("the page's own rows carry none of the host's fields — nothing here proves the projection")
				const sent = log.find((e) => e.t === "channel" && (e.rows?.length ?? 0) >= 2)
				if (!sent) wrong.push("it never held both lines of the exchange")
				else firstLineId = (sent.rows!.find((r) => r.role === "user") ?? sent.rows![0]!).id
				if (wrong.length) throw new Error(wrong.join("; "))
				return (
					`it is sent ${kinds.filter((k) => k !== "init").join(", ")} — its lane (main) and never the whole log, no scoped section and no grants; ` +
					`every row, pushed or paged, arrives without the host's fields the page's own copy carries (${carried.join(", ")})`
				)
			}
		},
		{
			name: "unprompted",
			run: async () => {
				// Its first load (the seat), focus nowhere near it: the probe pressed on its own.
				const heardAt = seatHeardAt
				const frame = await frameOf(page, PANEL_FRAME)
				const end = Date.now() + 20_000
				while (!heard.slice(heardAt).some((h) => /'core#hide' changes a message and needs a person behind it/.test(h.text)) && Date.now() < end)
					await page.waitForTimeout(250)
				await page.waitForTimeout(1000)
				said(heardAt, /^PluginFrame "Frame probe" \(\/plugin-ui\/gate\.frames\/ui\/probe\.html\): 'core#hide' changes a message and needs a person behind it/, `PluginFrame "${PANEL_TITLE}" (${SRC}): 'core#hide' changes a message and needs a person behind it …`)
				if (await hiddenOnServer(page, chat, firstLineId)) throw new Error("its unprompted hide landed: the line is hidden on the server")
				const log = await logOf(frame)
				if (log.some((e) => e.rows?.some((r) => r.id === firstLineId && r.isHidden))) throw new Error("the frame was pushed the line as hidden")
				return "its own invoke of core#hide, made on load with no person in it, is refused with the host's warning, and the line stays shown"
			}
		},
		{
			name: "person press",
			run: async () => {
				const frame = await frameOf(page, PANEL_FRAME)
				const heardAt = heard.length
				const press = async (hidden: boolean) => {
					await frame.getByRole("button", { name: "Hide the first line" }).click()
					const end = Date.now() + 15_000
					while ((await hiddenOnServer(page, chat, firstLineId)) !== hidden) {
						if (Date.now() > end) throw new Error(`a person's press did not ${hidden ? "hide" : "show"} the line on the server`)
						await page.waitForTimeout(300)
					}
					const pushed = Date.now() + 15_000
					for (;;) {
						const log = await logOf(frame)
						const last = [...log].reverse().find((e) => e.t === "channel" && e.rows?.some((r) => r.id === firstLineId))
						if (last?.rows?.find((r) => r.id === firstLineId)?.isHidden === hidden) break
						if (Date.now() > pushed) throw new Error(`the frame was never pushed the line as ${hidden ? "hidden" : "shown"}`)
						await page.waitForTimeout(250)
					}
				}
				await press(true)
				await press(false)
				const refused = heard.slice(heardAt).filter((h) => /core#hide/.test(h.text))
				if (refused.length) throw new Error(`a person's press was refused: ${refused[0]!.text}`)
				return "a person's click in the frame lets the same invoke through: the line is hidden on the server and the frame is pushed the hidden row; pressed again, it is shown again"
			}
		},
		{
			name: "session-view",
			run: async () => {
				await open(page, URL_BASE)
				await booted(page)
				const list: Array<{ id: number; name: string; isPersona: boolean }> = (await ask(page, "characters:list", {}))?.characterList ?? []
				const sam = list.find((c) => c.name === "C7 gate Sam" && c.isPersona)?.id
				const made = await ask(
					page,
					"sessions:create",
					{ session: { name: `${FIXTURE_NAME} frames view ${new Date().toISOString()}`, genreId: GENRE }, personaIds: sam ? [sam] : [] },
					{ refusable: true }
				)
				viewSession = made?.session?.id
				if (!viewSession) throw new Error(`a session of ${GENRE} was refused: ${JSON.stringify(made)}`)
				// One line of its own, sent as the composer sends one (the frame draws no composer).
				await emit(page, "sessionMessages:sendPersonaMessage", { sessionId: viewSession, personaId: sam ?? null, content: LINE, channel: "main" })
				for (const end = Date.now() + 20_000; !(await readRows(page, viewSession)).some((r) => r.content === LINE); await page.waitForTimeout(300))
					if (Date.now() > end) throw new Error("the session-view session's line never landed")
				const sel = `iframe[title="${VIEW_TITLE}"]`
				await openSession(page, `${URL_BASE}/sessions/${viewSession}`)
				const frame = await frameOf(page, sel)
				await page.waitForTimeout(1500)
				const wrong = sandboxWrong(await frameAttrs(page, sel), VIEW_TITLE)
				if (await page.locator('[data-widget-part~="messages.root"]').count()) wrong.push("core's conversation is drawn beside it")
				const log = await logOf(frame)
				const kinds = kindsOf(log)
				if (log.find((e) => e.t === "init")?.surface !== "session-view") wrong.push(`its init names ${JSON.stringify(log.find((e) => e.t === "init")?.surface)}`)
				if (log.find((e) => e.t === "session")?.sessionId !== viewSession) wrong.push(`it was sent the session ${JSON.stringify(log.find((e) => e.t === "session"))}`)
				if (!log.some((e) => e.t === "messages" && e.rows?.length)) wrong.push("it was never sent the session's rows")
				for (const k of ["settings", "style", "layout", "props", "scoped", "grants"]) if (kinds.includes(k)) wrong.push(`it was sent ${k}, which only a widget is`)
				const leaked = hostFieldsIn(log)
				if (leaked.length) wrong.push(`host fields reached it: ${leaked.join(", ")}`)
				if (wrong.length) throw new Error(wrong.join("; "))
				return `a session of the genre whose view it is is drawn by the frame (sandboxed, at ${SRC}) in place of core's conversation, and sent its rows without the host's fields — ${kinds.filter((k) => k !== "init").join(", ")} — nothing only a widget is sent`
			}
		},
		{
			name: "page",
			run: async () => {
				const sel = `iframe[title="${PAGE_TITLE}"]`
				await open(page, `${URL_BASE}/x/${PLUGIN}`)
				const frame = await frameOf(page, sel)
				await page.waitForTimeout(1500)
				const wrong = sandboxWrong(await frameAttrs(page, sel), PAGE_TITLE)
				const log = await logOf(frame)
				const kinds = kindsOf(log)
				if (log.find((e) => e.t === "init")?.surface !== "page") wrong.push(`its init names ${JSON.stringify(log.find((e) => e.t === "init")?.surface)}`)
				for (const k of ["session", "messages", "channel", "actions", "settings", "style", "layout", "props", "scoped", "grants"])
					if (kinds.includes(k)) wrong.push(`it was sent ${k}`)
				if (wrong.length) throw new Error(wrong.join("; "))
				return `/x/${PLUGIN} mounts its page surface full-window (sandboxed, at ${SRC}), sent ${kinds.filter((k) => k !== "init").join(", ") || "nothing past init"} — no session, no rows, no actions`
			}
		},
		// Switched off, in three steps of one load each: a dev server shared with
		// other work reloads often, and a step is retried whole.
		{
			name: "disabled: panel",
			run: async () => {
				await open(page, URL_BASE)
				await booted(page)
				await setEnabled(page, false)
				const wrong: string[] = []
				const doc = await fetchDoc(page)
				if (doc.status !== 404) wrong.push(`its document answers ${doc.status}`)
				await openSession(page, `${URL_BASE}/sessions/${chat}`)
				await page.locator('[data-widget-part~="messages.root"] textarea').last().waitFor({ timeout: 60_000 })
				await page.waitForTimeout(1500)
				if (await page.locator(`${cellOf(WIDGET)}, iframe[src^="/plugin-ui/"]`).count()) wrong.push("the chat session still seats the panel")
				if (wrong.length) throw new Error(wrong.join("; "))
				return "switched off, its documents answer 404 and the chat session no longer seats the panel"
			}
		},
		{
			name: "disabled: session-view",
			run: async () => {
				await openSession(page, `${URL_BASE}/sessions/${viewSession}`)
				const wrong: string[] = []
				await page
					.locator('[data-widget-part~="messages.root"]')
					.first()
					.waitFor({ timeout: 60_000 })
					.catch(() => wrong.push("the session-view session did not fall back to core's conversation"))
				if (await page.locator('iframe[src^="/plugin-ui/"]').count()) wrong.push("the session-view session still mounts the frame")
				if (wrong.length) throw new Error(wrong.join("; "))
				return "switched off, the session-view session falls back to core's conversation, with no frame"
			}
		},
		{
			name: "disabled: page",
			run: async () => {
				await open(page, `${URL_BASE}/x/${PLUGIN}`)
				const wrong: string[] = []
				await page
					.getByText("Extension page not found")
					.waitFor({ timeout: 30_000 })
					.catch(() => wrong.push("/x/ does not say the extension is not found"))
				if (await page.locator("iframe").count()) wrong.push("/x/ still mounts a frame")
				if (wrong.length) throw new Error(wrong.join("; "))
				return `switched off, /x/${PLUGIN} says the extension is not found, with no frame`
			}
		}
	]

	const lines: string[] = []
	try {
		for (const step of steps) {
			try {
				lines.push(`${step.name}: ${await steady(page, `${tag} ${step.name}`, step.run)}`)
			} catch (e) {
				lines.push(`${step.name}: FAILED — ${firstLine(e)}`)
				break
			}
		}
	} finally {
		await steady(page, `${tag} reset`, async () => {
			await open(page, URL_BASE)
			await booted(page)
			if (chat && firstLineId && (await hiddenOnServer(page, chat, firstLineId).catch(() => false)))
				await emit(page, "sessionMessages:update", { id: firstLineId, isHidden: false })
			await uninstall(page)
		}).catch((e) => problems.push(`${tag} could not uninstall the fixture plugin: ${firstLine(e)}`))
		await rm(PACKAGE_DIR, { recursive: true, force: true }).catch(() => {})
	}

	const judged = golden?.steps ?? lines
	for (let i = 0; i < Math.max(judged.length, lines.length); i++) {
		const was = judged[i] ?? "∅"
		const now = lines[i] ?? "∅"
		console.log(`${tag} [step] ${now}${was === now ? "" : `  ≠  golden: ${was}`}`)
		if (now.includes("FAILED")) failAbsolute(`${tag} [step] ${now}`)
		else if (now === "∅") failAbsolute(`${tag} [step] ${was.split(":")[0]} never ran`)
		else if (golden && was !== now) problems.push(`${tag} [step] differs: golden "${was}" / now "${now}"`)
	}
	if (RECORDS_REMOTE)
		if (lines.length === steps.length && !lines.some((l) => l.includes("FAILED"))) record(FRAMES, { format: GOLDEN_FORMAT, steps: lines })
		else unrecorded.push(FRAMES)
}
