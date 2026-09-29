/**
 * In-app component authoring (C6), live: an admin clones core's Stats in the
 * editor, changes a string a person can see, and the widget it becomes runs
 * in a session under its own authored owner — never core's.
 *
 * The steps, in order, each a sentence judged against the golden's, the
 * first failure stopping the rest (each needs the one before):
 *   1. clone — /admin/components, core's Stats, Clone: it lands in the
 *      editor as `authored.<id>`, off, compiled clean;
 *   2. edit — a line typed into Stats.svelte as a person types it (only
 *      `</` for a closing tag: the Svelte language closes it);
 *   3. preview — the draft mounts in the preview under `authored.<id>`,
 *      drawing the edited string; nothing is stored (the golden snapshot);
 *   4. save — compiles clean, the server holds the edit;
 *   5. switch on + scope review — offered to layouts, nothing left waiting;
 *   6. seat — placed on the Adventure fixture's left side (as the layout
 *      editor stores it); it draws the edited string in its own box, beside
 *      core's Stats;
 *   7. not core — a write from it (Rook's Health, pressed as a person
 *      presses) is refused as core-only; the server's value stays. The host
 *      says what it withheld (the field's autofocus, the write) in the
 *      remote's voice, which the console never excuses: here those two lines
 *      are the check, each required once and taken off the judged lines;
 *   8. live reload — a SECOND browser context saves another edit, and the
 *      session page shows it in place: no navigation, the old string gone;
 *   9. compile error — a broken line: Preview names its place in Problems
 *      and keeps the last good preview; Save names it too and keeps it as
 *      the component draft (owner ruling 2026-09-26): the saved version is
 *      still offered and the session KEEPS showing the last good build; the
 *      editor reopens on the draft under its banner, and Revert to last save
 *      puts the editor back on the saved source;
 *  10. export — the share file carries the saved source and its artifact;
 *  11. import — the file lands as a copy: its own id, off, waiting for
 *      review;
 *  12. a non-admin — no /admin/components, no answer from the component
 *      verbs, a switch-on and a delete sent straight on the socket change
 *      nothing, and the admin's /component-preview URL is a 404 for them;
 *  13. delete — both go; a session page open on it shows it as missing in
 *      place, and loaded afresh draws nothing of it.
 * What it made it deletes, and the fixture's layout is put back.
 *
 * Admin is a sidebar view, never a page (ruled 2026-09-27): a cold
 * /admin/components opens the Admin view in Focus at that section, so every
 * admin selector here is scoped under `[data-sidebar-view="admin"]`
 * (`openAdmin` in kit.ts), and a session is opened with `openSession`, which
 * closes that view first.
 *
 * Needs: SP_PLUGINS_ENABLED=1 on the instance (authoring is part of the
 * extension subsystem) and accounts on, with the gate signed in as its admin
 * (GATE_ADMIN_USERNAME / GATE_ADMIN_PASSWORD) — step 12 needs a second user,
 * which only an instance with accounts has.
 *
 * Golden (`goldens/authoring.json`): the preview's subtree after step 3
 * (read as a widget's is: `readShape`, axe, Tab order), the file tabs and
 * the edited Stats.svelte as the editor shows them, and the step sentences. Authored ids, box id
 * prefixes, preview tokens and artifact hashes are the run's own and are
 * normalised.
 */
import type { Browser, Page } from "playwright"
import {
	GATE_ADMIN,
	GOLDEN_FORMAT,
	RECORDS_REMOTE,
	URL_BASE,
	ask,
	booted,
	compare,
	failAbsolute,
	firstLine,
	gatePage,
	heard,
	noteHostOverlay,
	open,
	problems,
	readAxe,
	readGolden,
	readShape,
	readTabs,
	record,
	signIn,
	steady,
	unrecorded,
	type Snapshot
} from "../engine"
import { adventureFixture, FIXTURE_LAYOUT, FIXTURE_WIDGET_SETTINGS, serverValue, castOwner, storeLayout, type AdventureFixture } from "./adventure"
import { ADMIN_VIEW, PUSH_BOUND_MS, openAdmin, openSession, until } from "./kit"
import { stateVersion } from "./slotFlows"
import { normalise } from "./widgets"

export const AUTHORING = "authoring"
/** What the gate types: a string no core component shows, so every copy of it on a page is the authored one's. */
export const MARK = "C7 gate authored"
/** The file a person edits: Stats' own markup (the entry, `stats.ts`, only mounts it). */
export const STATS_FILE = "sessions/stats/Stats.svelte"
const markLine = (v: string) => `<p class="gate-mark">${MARK} ${v}</p>`
/** The non-admin the gate signs a second context in as (made once, kept across runs). */
const NON_ADMIN = { username: "c7-gate-reader", passphrase: "C7-gate-reader!1" }

type Detail = {
	id: string
	ownerId: string
	widgetId: string
	label: unknown
	entry: string
	framework: string
	files: Record<string, string>
	basedOn: { component: string } | null
	artifactHash: string | null
	lastError: string | null
	enabled: boolean
	needsReview: boolean
	src: string | null
	hasComponentDraft: boolean
	componentDraft: { files: Record<string, string>; entry: string } | null
	updatedAt: string
	scopes: Array<{ key: string; granted: boolean; pending?: boolean }>
}
type AuthoringGolden = { format: number; snapshot: Snapshot; editor: EditorView; steps: string[] }
type EditorView = { files: string[]; edited: string[] }

/* ── normalising ──────────────────────────────────────────────────────── */

/** The run's own: authored ids, a box's id prefix, a preview token, an artifact hash. */
const runOwn = (s: string) =>
	s
		.replace(/authored\.[a-z0-9]{10}/g, "authored.<id>")
		.replace(/sp-r\d+-[0-9a-f]{8}-/g, "sp-r#-<box>-")
		.replace(/\/component-preview\/[A-Za-z0-9_-]+/g, "/component-preview/<token>")
		.replace(/\b[0-9a-f]{16,64}\b/g, "<hash>")
const normaliseSnapshot = (s: Snapshot): Snapshot => normalise(JSON.parse(runOwn(JSON.stringify(s))) as Snapshot)

/* ── the app's socket, as an admin ────────────────────────────────────── */

const getComponent = async (page: Page, id: string): Promise<Detail> =>
	(await ask(page, "components:get", { id }, { where: { "component.id": id }, refusable: true })).component
const listComponents = async (page: Page): Promise<Detail[]> => (await ask(page, "components:list", {}, { refusable: true })).components

/** Ask again until `ok` holds of the component, or throw `why`. */
async function componentUntil(page: Page, id: string, ok: (c: Detail) => boolean, why: (c: Detail) => string, timeout = 30_000): Promise<Detail> {
	const end = Date.now() + timeout
	for (;;) {
		const c = await getComponent(page, id)
		if (ok(c)) return c
		if (Date.now() > end) throw new Error(why(c))
		await page.waitForTimeout(500)
	}
}

async function deleteComponent(page: Page, id: string) {
	const c = await getComponent(page, id).catch(() => null)
	if (c) await ask(page, "components:delete", { id, expectedUpdatedAt: c.updatedAt }, { where: { id }, refusable: true })
}

/* ── the editor ───────────────────────────────────────────────────────── */

const sourceOf = (file: string) => `.cm-content[aria-label="${file} source"]`

/** The editor as a person reads it: the file tabs, and `file`'s lines (CodeMirror draws every line of a file this short). */
const readEditor = (page: Page, file: string): Promise<EditorView> =>
	page.evaluate((sel) => {
		const flat = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim()
		return {
			files: [...document.querySelectorAll('[role=tablist][aria-label$=" files"] [role=tab]')].map((t) => flat(t.textContent)),
			edited: [...document.querySelectorAll(`${sel} .cm-line`)].map((l) => l.textContent ?? "")
		}
	}, sourceOf(file))

/**
 * Open the editor on `id` cold — the shell opens the Admin view in Focus at
 * the component — waiting for its source to be drawn. Returns the view.
 */
async function openEditor(page: Page, id: string) {
	const admin = await openAdmin(page, `${URL_BASE}/admin/components/${id}`)
	await admin.locator(".cm-content").first().waitFor({ timeout: 60_000 })
	return admin
}

/** Show `file` in the editor: its tab (the entry's title adds " — the entry"). */
async function showFile(page: Page, file: string) {
	await page.locator(`[role=tab][title="${file}"], [role=tab][title="${file} — the entry"]`).click()
	await page.locator(sourceOf(file)).waitFor({ timeout: 30_000 })
}

/** Type `text` on a new last line of `file`, as a person does. */
async function typeAtEnd(page: Page, file: string, text: string) {
	await showFile(page, file)
	await page.locator(sourceOf(file)).click()
	await page.keyboard.press("Control+End")
	await page.keyboard.press("Enter")
	await page.keyboard.type(text, { delay: 15 })
	// A completion list the typing opened must not take the next key.
	await page.keyboard.press("Escape")
}

/** One of the editor's side tabs (Preview, Problems, Widget, Core); a tab with something to see says so after its name. */
const toolTab = (page: Page, name: string) => page.getByRole("tablist", { name: "Component tools" }).getByRole("tab", { name: new RegExp(`^${name}\\b`) })

/** The Problems pane's rows: each one's place (`file:line:col`) and text. */
const problemRows = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll("#component-side-problems .problem-row")].map((r) => ({
			place: (r.querySelector(".font-mono")?.textContent ?? "").trim(),
			text: (r.querySelector(".block")?.textContent ?? "").replace(/\s+/g, " ").trim(),
			jumps: r.tagName === "BUTTON"
		}))
	)

/* ── the session page ─────────────────────────────────────────────────── */

/** A remote's box under `owner` (a menu it opens is portalled under the same owner, outside it). */
const ownerBox = (owner: string) => `.sp-remote-box[data-sp-owner="${owner}"]`
/** The session layout's cell for a widget. */
const cellOf = (widgetId: string) => `[data-panel-id="${widgetId}"]`
/** What the page shows of the mark: every copy's text, and whether each sits in `owner`'s box. */
const marksOn = (page: Page, owner: string) =>
	page.evaluate(
		(box) =>
			[...document.querySelectorAll(".gate-mark")].map((m) => ({
				text: (m.textContent ?? "").trim(),
				mine: !!m.closest(box),
				core: !!m.closest('[data-sp-owner="core"]')
			})),
		ownerBox(owner)
	)

/** The fixture's layout, with the authored widget below Lore entries on the left. */
function layoutWith(widgetId: string) {
	const l = structuredClone(FIXTURE_LAYOUT) as typeof FIXTURE_LAYOUT & { active: Array<{ id: string; on: boolean }> }
	l.active = [...l.active, { id: widgetId, on: true }]
	;(l.zoneLayout.zones.left.widgets as string[]) = ["lore-entries", widgetId]
	l.arrangedGrid.left.items = [
		{ id: "lore-entries", x: 0, y: 0, w: 1, h: 6 },
		{ id: widgetId, x: 0, y: 6, w: 1, h: 6 }
	]
	return l
}

/**
 * A line the host must have said since `heardAt` — once — taken off the
 * judged lines, since saying it is the behaviour being checked.
 */
function saidOnce(heardAt: number, line: string) {
	const at = heard.findIndex((h, i) => i >= heardAt && h.text === line)
	if (at < 0) throw new Error(`the host never said ${JSON.stringify(line)}`)
	heard.splice(at, 1)
	if (heard.slice(heardAt).some((h) => h.text === line)) throw new Error(`the host said ${JSON.stringify(line)} more than once`)
	console.log(`[console] said, as the step requires: ${line}`)
}

/* ── the run ──────────────────────────────────────────────────────────── */

export async function runAuthoringSpec(browser: Browser, page: Page) {
	const tag = `[${AUTHORING}]`
	const f: AdventureFixture = await steady(page, `${tag} fixture`, () => adventureFixture(page))
	/** Every component this run made, deleted whatever happens. */
	const made = new Set<string>()
	let id = ""
	// Set inside the steps (closures): declared wide, so the checks after them are typed as they run.
	let c = null as Detail | null
	let snap = null as Snapshot | null
	let editor = null as EditorView | null
	let copyId = ""
	let exported = null as { name: string; mimeType: string; buffer: Buffer } | null
	const timings: string[] = []

	let golden: AuthoringGolden | null = null
	try {
		golden = await readGolden<AuthoringGolden>(AUTHORING)
	} catch (e) {
		if (RECORDS_REMOTE) console.log(`[rebaseline] ${firstLine(e)}: nothing to judge against, recorded afresh`)
		else problems.push(`${tag} no golden to judge against (${firstLine(e)}) — record one: GATE_RECORD=1 GATE_REBASELINE=1 GATE_SPECS=${AUTHORING}`)
	}

	// A run that stopped before its clean-up left its components behind: they go first.
	const before = await steady(page, `${tag} leftovers`, async () => {
		await open(page, URL_BASE)
		await booted(page)
		const kept = new Set<string>()
		for (const x of await listComponents(page)) {
			const full = await getComponent(page, x.id)
			if (Object.values(full.files).some((t) => t.includes(MARK))) await deleteComponent(page, x.id)
			else kept.add(x.id)
		}
		return kept
	})

	const second = await gatePage(browser)
	let reader: Page | null = null
	const steps: Array<{ name: string; run: () => Promise<string> }> = [
		{
			name: "clone",
			run: async () => {
				const admin = await openAdmin(page, `${URL_BASE}/admin/components`)
				await admin.getByRole("heading", { name: "Core's components" }).waitFor({ timeout: 60_000 })
				const row = admin.locator("li.component-row", { has: page.locator("p.font-mono", { hasText: /^stats ·/ }) })
				await row.getByRole("button", { name: "Clone" }).click()
				await page.waitForURL(/\/admin\/components\/[a-z0-9]{10}(?:[?#]|$)/, { timeout: 60_000 })
				id = /\/admin\/components\/([a-z0-9]{10})/.exec(page.url())![1]!
				made.add(id)
				c = await componentUntil(page, id, (x) => !!x.artifactHash || !!x.lastError, () => "the clone never finished compiling")
				const wrong: string[] = []
				if (c.ownerId !== `authored.${id}`) wrong.push(`its owner is ${c.ownerId}, not authored.${id}`)
				if (c.basedOn?.component !== "stats") wrong.push(`it is based on ${JSON.stringify(c.basedOn)}, not core's stats`)
				if (!c.widgetId.startsWith(`${c.ownerId}:`)) wrong.push(`its widget id ${c.widgetId} is not under its owner`)
				if (c.enabled) wrong.push("it is already switched on")
				if (c.lastError || !c.artifactHash) wrong.push(`it did not compile: ${c.lastError}`)
				if (wrong.length) throw new Error(wrong.join("; "))
				await page.locator(sourceOf(c.entry)).waitFor({ timeout: 30_000 })
				return `core's Stats clones from the admin list into the editor as its own authored component (owner authored.<id>), switched off, compiled clean`
			}
		},
		{
			name: "edit",
			run: async () => {
				await typeAtEnd(page, STATS_FILE, `<p class="gate-mark">${MARK} v1</`)
				const want = markLine("v1")
				const lines = (await readEditor(page, STATS_FILE)).edited
				const last = lines.filter((l) => l.trim()).at(-1)?.trim()
				if (last !== want) throw new Error(`the typed line reads ${JSON.stringify(last)}, not ${JSON.stringify(want)} (the editor closes a tag on "</")`)
				if (lines.join("\n").split("</p>").length !== 2) throw new Error(`the file holds ${lines.join("\n").split("</p>").length - 1} closing </p> tags after typing one line`)
				await page.getByText("Unsaved", { exact: true }).waitFor({ timeout: 5_000 })
				editor = await readEditor(page, STATS_FILE)
				return `typing a line into ${STATS_FILE} with only "</" for its closing tag gives ${want}, and the editor marks it unsaved`
			}
		},
		{
			name: "preview",
			run: async () => {
				const sel = `#component-side-preview ${ownerBox(c!.ownerId)}`
				await page.locator(ADMIN_VIEW).getByRole("button", { name: "Preview", exact: true }).click()
				await until(
					page,
					({ sel, want }) => (document.querySelector(`${sel} .gate-mark`)?.textContent ?? "").trim() === want && !!document.querySelector(`${sel} [data-widget-part~="stats.card"]`),
					{ sel, want: `${MARK} v1` },
					60_000,
					async () => `the preview never drew the edited string: its box holds ${JSON.stringify(await page.locator("#component-side-preview").innerText().catch(() => "nothing"))}`
				)
				await page.waitForTimeout(1000)
				const inCore = await page.locator('#component-side-preview [data-sp-owner="core"]').count()
				if (inCore) throw new Error("the preview mounted under core's owner")
				await noteHostOverlay(page, `${sel} .gate-mark`, `${tag} preview`)
				const shape = await readShape(page, `#component-side-preview .sp-remote-box`)
				const { axe, axeUndecided } = await readAxe(page, `#component-side-preview .sp-remote-box`)
				const tabs = await readTabs(page, `#component-side-preview .sp-remote-box`)
				snap = normaliseSnapshot({ format: GOLDEN_FORMAT, ...shape, axe, axeUndecided, tabs })
				const stored = await getComponent(page, id)
				if (Object.values(stored.files).some((t) => t.includes(MARK))) throw new Error("previewing stored the draft")
				return "Preview mounts the draft in its own box under authored.<id>, drawing the edited string over the preview's fixtures, and stores nothing"
			}
		},
		{
			name: "save",
			run: async () => {
				await page.locator(ADMIN_VIEW).getByRole("button", { name: "Save", exact: true }).click()
				c = await componentUntil(
					page,
					id,
					(x) => x.files[STATS_FILE]?.includes(markLine("v1")) === true && (!!x.artifactHash || !!x.lastError),
					(x) => `the server never held the edit (${STATS_FILE} ends ${JSON.stringify(x.files[STATS_FILE]?.slice(-80))})`
				)
				if (c.lastError || !c.artifactHash) throw new Error(`the save did not compile: ${c.lastError}`)
				await page.getByText("Unsaved", { exact: true }).waitFor({ state: "detached", timeout: 10_000 })
				await toolTab(page, "Problems").click()
				await page.getByText(/^\s*It compiles/).waitFor({ timeout: 10_000 })
				await toolTab(page, "Preview").click()
				return "Save stores the edit and compiles it clean: the editor drops its unsaved mark, and Problems says it compiles"
			}
		},
		{
			name: "switch on and review",
			run: async () => {
				await page.getByText("Offered to layouts").click()
				c = await componentUntil(page, id, (x) => x.enabled, () => "the switch never turned it on")
				const waiting = c.scopes.filter((s) => s.pending).map((s) => s.key)
				if (!c.needsReview || !waiting.length) throw new Error(`a clone of Stats should wait for its scopes' review; it waits for ${JSON.stringify(waiting)}`)
				await toolTab(page, "Widget").click()
				await page.getByText("Waiting for review").first().waitFor({ timeout: 10_000 })
				await page.locator(ADMIN_VIEW).getByRole("button", { name: "Save review" }).click()
				c = await componentUntil(page, id, (x) => !x.needsReview, (x) => `the review never landed: ${JSON.stringify(x.scopes)}`)
				const denied = c.scopes.filter((s) => !s.granted).map((s) => s.key)
				if (denied.length) throw new Error(`the review denied ${denied.join(", ")}`)
				if (!c.src?.startsWith(`/authored-ui/${c.ownerId}/`)) throw new Error(`switched on and compiled, it is offered at ${JSON.stringify(c.src)}`)
				return `the switch offers it to layouts at /authored-ui/authored.<id>/<hash>.js; its scopes (${waiting.join(", ")}) wait for review until the review grants them`
			}
		},
		{
			name: "seat",
			run: async () => {
				await open(page, URL_BASE)
				await booted(page)
				const laid = await ask(
					page,
					"sessions:panelLayout:set",
					{ sessionId: f.sessionId, layout: layoutWith(c!.widgetId), widgetSettings: FIXTURE_WIDGET_SETTINGS },
					{ where: { sessionId: f.sessionId }, refusable: true }
				)
				if (!laid?.ok) throw new Error(`the layout was refused: ${JSON.stringify(laid)}`)
				await openSession(page, f.url)
				const box = `${cellOf(c!.widgetId)} ${ownerBox(c!.ownerId)}`
				await until(
					page,
					({ box, want }) => (document.querySelector(`${box} .gate-mark`)?.textContent ?? "").trim() === want && !!document.querySelector(`${box} [data-widget-part~="stats.card"]`),
					{ box, want: `${MARK} v1` },
					60_000,
					async () => `the session never drew it: its cell holds ${JSON.stringify(await page.locator(cellOf(c!.widgetId)).innerText().catch(() => "nothing"))}`
				)
				const wrong: string[] = []
				const marks = await marksOn(page, c!.ownerId)
				if (marks.length !== 1 || !marks[0]!.mine || marks[0]!.core) wrong.push(`the edited string shows ${JSON.stringify(marks)} — once, in the authored box, never core's`)
				const coreStats = await page.locator('.sp-remote-box[data-sp-owner="core"] [data-state-widget="stats"]').count()
				if (coreStats !== 1) wrong.push(`core's Stats is on the page ${coreStats} times beside it, not once`)
				const title = await page.locator(`${cellOf(c!.widgetId)} ${ownerBox(c!.ownerId)}`).getAttribute("aria-label")
				await noteHostOverlay(page, `${box} .gate-mark`, `${tag} seat`)
				if (wrong.length) throw new Error(wrong.join("; "))
				return `seated on the Adventure fixture's left side, it draws the edited string in its own box ("${title}", owner authored.<id>), beside core's Stats`
			}
		},
		{
			name: "not core",
			run: async () => {
				const box = page.locator(`${cellOf(c!.widgetId)} ${ownerBox(c!.ownerId)}`)
				const title = await box.getAttribute("aria-label")
				const slot = box.locator(`[data-owner-key="c7_gate_rook"] [data-slot-id="core:slot/hp@1"]`)
				const before = await serverValue(page, f, castOwner(f, "rook"), "hp")
				const version = await stateVersion(page, f)
				const heardAt = heard.length
				await slot.getByRole("button", { name: /^Health\b.*, edit$/ }).click()
				const field = slot.getByRole("spinbutton", { name: "Health value" })
				await field.waitFor({ timeout: 8_000 })
				await field.fill("3")
				await field.press("Enter")
				const alert = page.locator(`${cellOf(c!.widgetId)} ${ownerBox(c!.ownerId)} [role=alert]`).first()
				await alert.waitFor({ timeout: 10_000 }).catch(() => {})
				const said = ((await alert.textContent().catch(() => null)) ?? "").trim()
				await page.waitForTimeout(1500)
				const after = await serverValue(page, f, castOwner(f, "rook"), "hp")
				const now = await stateVersion(page, f)
				if (after !== before || now !== version) throw new Error(`its write landed: Rook's Health ${JSON.stringify(before)} → ${JSON.stringify(after)}, version ${JSON.stringify(version)} → ${JSON.stringify(now)}`)
				if (!/only core's own widgets ask 'set-attribute-value'/.test(said)) throw new Error(`the refused write says ${JSON.stringify(said)}, not that only core's widgets ask it`)
				// The host says what it withheld, in the remote's voice (never excused by the
				// console's rules): here those lines ARE the check — a clone runs without core's
				// trust — so each must be said, once, and is taken off the judged lines.
				for (const line of [
					`Remote "${title}" (${c!.ownerId}): <input> autofocus is core's to place — dropped`,
					`Remote "${title}" (${c!.ownerId}): declined request — only core's own widgets ask 'set-attribute-value'`
				])
					saidOnce(heardAt, line)
				return `a write it makes (Rook's Health, pressed as a person presses) is refused in its own box — "${said}" — and the server's value and version stay`
			}
		},
		{
			name: "live reload",
			run: async () => {
				// The page is marked; a navigation or a reload would lose the mark.
				let navs = 0
				const onNav = (fr: unknown) => void (fr === page.mainFrame() && navs++)
				page.on("framenavigated", onNav)
				try {
					await page.evaluate(() => ((globalThis as { __gateStayed?: boolean }).__gateStayed = true))
					await open(second, URL_BASE)
					await booted(second)
					const now = await getComponent(second, id)
					const files = { ...now.files, [STATS_FILE]: now.files[STATS_FILE]!.replace(markLine("v1"), markLine("v2")) }
					const saved = await ask(second, "components:save", { id, expectedUpdatedAt: now.updatedAt, files }, { where: { "component.id": id }, refusable: true })
					if (saved.compile.errors.length) throw new Error(`the second context's save did not compile: ${JSON.stringify(saved.compile.errors)}`)
					const t0 = Date.now()
					const box = `${cellOf(c!.widgetId)} ${ownerBox(c!.ownerId)}`
					await until(
						page,
						({ box, want }) => (document.querySelector(`${box} .gate-mark`)?.textContent ?? "").trim() === want && !!document.querySelector(`${box} [data-widget-part~="stats.card"]`),
						{ box, want: `${MARK} v2` },
						PUSH_BOUND_MS + 10_000,
						() => "the session page never showed the second context's save"
					)
					const ms = Date.now() - t0
					timings.push(`reload in place ${ms}ms`)
					const stayed = await page.evaluate(() => (globalThis as { __gateStayed?: boolean }).__gateStayed === true)
					const marks = await marksOn(page, c!.ownerId)
					const wrong: string[] = []
					if (!stayed || navs) wrong.push(`the page navigated (${navs} navigation(s); marked page ${stayed ? "kept" : "lost"})`)
					if (marks.length !== 1 || marks[0]!.text !== `${MARK} v2`) wrong.push(`the page shows ${JSON.stringify(marks)}, not the new string alone`)
					if (ms > PUSH_BOUND_MS) wrong.push(`the new build took ${ms}ms to show (allowed ${PUSH_BOUND_MS}ms)`)
					if ((await page.locator('.sp-remote-box[data-sp-owner="core"] [data-state-widget="stats"]').count()) !== 1) wrong.push("core's Stats went with it")
					if (wrong.length) throw new Error(wrong.join("; "))
					c = await getComponent(second, id)
					return "another browser context's save reaches the open session page in place — the widget remounts on the new build with no navigation, and the old string is gone"
				} finally {
					page.off("framenavigated", onNav)
				}
			}
		},
		{
			name: "compile error",
			run: async () => {
				const entry = STATS_FILE
				await openEditor(second, id)
				const good = (await getComponent(second, id)).files[entry]!
				const brokenLine = good.split("\n").length + 1
				// An expression cut short. The editor closes what is typed: the brace as it opens,
				// and this bare <p> on its ">" (typed "</" too, it would close it twice).
				await typeAtEnd(second, entry, "<p>{1 +}")
				const typed = (await readEditor(second, entry)).edited.filter((l) => l.trim()).at(-1)?.trim()
				if (typed !== "<p>{1 +}</p>") throw new Error(`the broken line reads ${JSON.stringify(typed)}, not "<p>{1 +}</p>"`)
				const located = async (what: string) => {
					await until(second, () => document.querySelectorAll("#component-side-problems .problem-row").length > 0, null, 60_000, () => `${what}: Problems listed nothing`)
					const rows = await problemRows(second)
					const at = rows.find((r) => r.place.startsWith(`${entry}:${brokenLine}:`))
					if (!at?.jumps) throw new Error(`${what}: Problems lists ${JSON.stringify(rows)}, none placed at ${entry}:${brokenLine} to jump to`)
					return at
				}
				// Preview: named in Problems; the last good preview stays.
				await second.locator(ADMIN_VIEW).getByRole("button", { name: "Preview", exact: true }).click()
				const previewed = await located("previewing the broken draft")
				await toolTab(second, "Preview").click()
				await second.getByText("Your edits don't compile — this is the last version that did.").waitFor({ timeout: 10_000 })
				const kept = (await second.locator(`#component-side-preview ${ownerBox(c!.ownerId)} .gate-mark`).textContent())?.trim()
				if (kept !== `${MARK} v2`) throw new Error(`after a broken preview the preview shows ${JSON.stringify(kept)}, not the last good build's string`)
				// Save: named in Problems; kept as the component draft — the saved build stays offered.
				await second.locator(ADMIN_VIEW).getByRole("button", { name: "Save", exact: true }).click()
				await located("saving the broken draft")
				const bad = await componentUntil(second, id, (x) => x.hasComponentDraft, () => "the server never kept the broken save as a draft")
				const wrong: string[] = []
				if (bad.src !== c!.src) wrong.push(`the saved build's offer moved from ${c!.src} to ${bad.src}`)
				if (bad.artifactHash !== c!.artifactHash || bad.lastError) wrong.push(`the saved build changed: ${bad.artifactHash} / ${bad.lastError}`)
				if (bad.files[entry] !== good) wrong.push("the saved source was replaced by the broken one")
				if (!bad.componentDraft?.files[entry]?.includes("<p>{1 +}</p>")) wrong.push("the draft does not hold the broken line")
				if (wrong.length) throw new Error(wrong.join("; "))
				const DRAFT_BANNER = "Draft — doesn't compile; sessions keep running the last save."
				await second.getByText(DRAFT_BANNER).waitFor({ timeout: 10_000 })
				// The session keeps the last good build, in place — nothing missing, nothing remounted away.
				const cell = cellOf(c!.widgetId)
				await page.waitForTimeout(PUSH_BOUND_MS + 1000)
				if (await page.locator(`${cell} [data-sp-missing]`).count()) throw new Error("the session page stopped showing the last good build")
				const shown = (await page.locator(`${cell} ${ownerBox(c!.ownerId)} .gate-mark`).textContent())?.trim()
				if (shown !== `${MARK} v2`) throw new Error(`after a broken save the session shows ${JSON.stringify(shown)}, not the last good build's string`)
				if ((await page.locator('.sp-remote-box[data-sp-owner="core"] [data-state-widget="stats"]').count()) !== 1) throw new Error("core's Stats went with it")
				// Opened afresh, the editor holds the draft under its banner.
				await openEditor(second, id)
				await second.getByText(DRAFT_BANNER).waitFor({ timeout: 10_000 })
				await showFile(second, entry)
				const reopened = (await readEditor(second, entry)).edited.filter((l) => l.trim()).at(-1)?.trim()
				if (reopened !== "<p>{1 +}</p>") throw new Error(`reopened, the editor ends ${JSON.stringify(reopened)}, not the draft's broken line`)
				// Revert to last save: the draft goes, the editor is back on the saved source.
				await second.locator(ADMIN_VIEW).getByRole("button", { name: "Revert to last save", exact: true }).click()
				await componentUntil(second, id, (x) => !x.hasComponentDraft, () => "Revert to last save never discarded the draft")
				await second.getByText(DRAFT_BANNER).waitFor({ state: "detached", timeout: 10_000 })
				const goodLast = good.split("\n").filter((l) => l.trim()).at(-1)?.trim()
				await until(
					second,
					({ sel, want }) => [...document.querySelectorAll(`${sel} .cm-line`)].map((l) => (l.textContent ?? "").trim()).filter(Boolean).at(-1) === want,
					{ sel: `.cm-content[aria-label="${entry} source"]`, want: goodLast },
					10_000,
					() => "after Revert to last save the editor does not hold the saved source"
				)
				const shownAfter = (await page.locator(`${cell} ${ownerBox(c!.ownerId)} .gate-mark`).textContent())?.trim()
				if (shownAfter !== `${MARK} v2`) throw new Error(`after Revert the session shows ${JSON.stringify(shownAfter)}`)
				c = await getComponent(second, id)
				return (
					`a broken line is named in Problems at its place (${previewed.place.replace(/:\d+$/, ":<col>")}, "${previewed.text.split(/\n|https?:/)[0]!.trim().slice(0, 80)}"), ` +
					"on Preview (which keeps the last good build) and on Save; saved broken, it is kept as a draft — the session keeps showing the last good build, in place; the editor reopens on the draft under its banner, and Revert to last save puts it back on the saved source"
				)
			}
		},
		{
			name: "export",
			run: async () => {
				const admin = await openEditor(page, id)
				const exportButton = admin.getByRole("button", { name: "Export", exact: true })
				const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), exportButton.click()])
				const path = await dl.path()
				const { readFile } = await import("node:fs/promises")
				const file = JSON.parse(await readFile(path, "utf8")) as {
					serenePub?: string
					component?: { basedOn?: { component?: string } }
					files?: Record<string, string>
					artifact?: { hash?: string }
				}
				const wrong: string[] = []
				if (file.serenePub !== "component@1") wrong.push(`it is ${JSON.stringify(file.serenePub)}, not component@1`)
				if (!file.files?.[STATS_FILE]?.includes(markLine("v2"))) wrong.push("it does not carry the saved source")
				if (file.component?.basedOn?.component !== "stats") wrong.push(`it names its base as ${JSON.stringify(file.component?.basedOn)}`)
				if (!file.artifact?.hash || file.artifact.hash !== c!.artifactHash) wrong.push(`its artifact is ${file.artifact?.hash ?? "missing"}, the saved build ${c!.artifactHash}`)
				if (wrong.length) throw new Error(wrong.join("; "))
				// Kept as the file a person saves: its name is what the import dialog checks.
				exported = { name: dl.suggestedFilename(), mimeType: "application/json", buffer: await readFile(path) }
				return `Export downloads ${dl.suggestedFilename().replace(/[a-z0-9]{10}/, "<id>")}: a component@1 share file with the saved source, its base and its built artifact`
			}
		},
		{
			name: "import",
			run: async () => {
				const admin = await openAdmin(page, `${URL_BASE}/admin/components`)
				await admin.getByRole("heading", { name: "Core's components" }).waitFor({ timeout: 60_000 })
				await admin.getByRole("button", { name: "Import", exact: true }).click()
				const dialog = page.getByRole("dialog")
				await dialog.waitFor()
				await dialog.locator("input[type=file]").setInputFiles(exported!)
				// Its Import button is drawn once the dialog has read what the file brings.
				const confirm = dialog.getByRole("button", { name: "Import", exact: true })
				await confirm.waitFor({ timeout: 60_000 }).catch(async () => {
					throw new Error(`the dialog never offered to import the file; it says ${JSON.stringify((await dialog.innerText()).replace(/\s+/g, " ").slice(0, 300))}`)
				})
				await confirm.click()
				await page.waitForURL((u) => /\/admin\/components\/[a-z0-9]{10}/.test(u.pathname) && !u.pathname.endsWith(`/${id}`), { timeout: 60_000 })
				const copy = /\/admin\/components\/([a-z0-9]{10})/.exec(page.url())![1]!
				made.add(copy)
				copyId = copy
				const got = await componentUntil(page, copy, (x) => !!x.artifactHash || !!x.lastError, () => "the import never compiled")
				const wrong: string[] = []
				if (copy === id) wrong.push("it replaced the original")
				if (got.enabled) wrong.push("it arrived switched on")
				if (!got.needsReview) wrong.push("it arrived with its scopes already granted")
				if (!got.files[STATS_FILE]?.includes(markLine("v2"))) wrong.push("it does not hold the exported source")
				if (got.basedOn?.component !== "stats") wrong.push(`it names its base as ${JSON.stringify(got.basedOn)}`)
				if (got.lastError) wrong.push(`it does not compile: ${got.lastError}`)
				if (wrong.length) throw new Error(wrong.join("; "))
				return "importing the file lands a copy — its own id, switched off, its scopes waiting for review — holding the exported source"
			}
		},
		{
			name: "a non-admin",
			run: async () => {
				const settings = (await page.request.get(`${URL_BASE}/api/system-settings`).then((r) => r.json())) as { isAccountsEnabled?: boolean }
				if (!settings.isAccountsEnabled || !GATE_ADMIN)
					throw new Error(
						"accounts are off on this instance, so no one but its admin can be tried — run the gate against an instance with accounts on, signed in as its admin (GATE_ADMIN_USERNAME / GATE_ADMIN_PASSWORD)"
					)
				// A reloaded attempt's reader goes first: left open, its own reload boots
				// it as the non-admin later, and its refusals land in the next step's console.
				await (reader as Page | null)?.close()
				reader = await gatePage(browser)
				await reader.context().clearCookies()
				// Made by the first run on this instance, and signed into by every later one.
				if (!(await signIn(reader, NON_ADMIN).then(() => true, () => false))) {
					await ask(page, "users:create", { username: NON_ADMIN.username, passphrase: NON_ADMIN.passphrase }, { refusable: true })
					await signIn(reader, NON_ADMIN)
				}
				const wrong: string[] = []
				// The page: sent home, the list never drawn.
				await open(reader, `${URL_BASE}/admin/components`)
				await booted(reader)
				await reader.waitForURL((u) => !u.pathname.startsWith("/admin"), { timeout: 30_000 }).catch(() => wrong.push(`the page stayed at ${reader!.url()}`))
				if (await reader.getByRole("heading", { name: "Your components" }).count()) wrong.push("the page drew the component list")
				// The verbs: refused, or never answered.
				const listed = await ask(reader, "components:list", {}, { refusable: true }).then(
					(r) => `answered with ${(r?.components ?? []).length} component(s)`,
					(e) => (/refused|timeout/.test(String(e)) ? null : `failed oddly: ${firstLine(e)}`)
				)
				if (listed) wrong.push(`components:list ${listed}`)
				const got = await ask(reader, "components:get", { id }, { refusable: true }).then(
					() => "answered",
					() => null
				)
				if (got) wrong.push(`components:get ${got}`)
				// Writes sent anyway, straight on the socket: the server must refuse them, not only the page.
				const copy = await getComponent(page, copyId)
				await reader.evaluate(
					async ({ id, updatedAt }) => {
						const live = (globalThis as unknown as { __gateImport: (path: string) => Promise<any> }).__gateImport
						const s = (await live("/src/lib/client/sockets/typedSocket.ts")).typedSocketOrNull()
						s.emit("components:setEnabled", { id, enabled: true })
						s.emit("components:delete", { id, expectedUpdatedAt: updatedAt })
					},
					{ id: copyId, updatedAt: copy.updatedAt }
				)
				await reader.waitForTimeout(2000)
				const after = await getComponent(page, copyId).catch(() => null)
				if (!after) wrong.push("their components:delete deleted the import")
				else if (after.enabled) wrong.push("their components:setEnabled switched the import on")
				// A preview URL the admin minted: theirs alone.
				const minted = await ask(page, "components:preview", { files: c!.files, entry: c!.entry, framework: c!.framework }, { refusable: true })
				if (!minted?.url) throw new Error(`the admin's preview was not minted: ${JSON.stringify(minted?.compile?.errors)}`)
				const theirs = (await reader.request.get(`${URL_BASE}${minted.url}`)).status()
				const admins = (await page.request.get(`${URL_BASE}${minted.url}`)).status()
				if (theirs !== 404) wrong.push(`the admin's /component-preview URL answers them ${theirs}`)
				if (admins !== 200) wrong.push(`the admin's own /component-preview URL answers the admin ${admins} (the control)`)
				if (wrong.length) throw new Error(wrong.join("; "))
				return "a signed-in non-admin is sent away from /admin/components, gets no answer from the component verbs and changes nothing with them (a switch-on and a delete sent straight on the socket leave the import as it was), and the admin's /component-preview URL is a 404 for them (200 for the admin)"
			}
		},
		{
			name: "delete",
			run: async () => {
				// A session page open on it while it is deleted.
				const cell = cellOf(c!.widgetId)
				await openSession(second, f.url)
				await until(
					second,
					({ cell, box, want }) => (document.querySelector(`${cell} ${box} .gate-mark`)?.textContent ?? "").trim() === want,
					{ cell, box: ownerBox(c!.ownerId), want: `${MARK} v2` },
					60_000,
					() => "before the delete, the session page never drew the widget"
				)
				const admin = await openAdmin(page, `${URL_BASE}/admin/components`)
				await admin.getByRole("heading", { name: "Your components" }).waitFor({ timeout: 60_000 })
				for (const x of [...made]) {
					const d = await getComponent(page, x)
					const row = admin.locator("li.component-row", { has: page.locator("p.font-mono", { hasText: `${d.widgetId} ·` }) })
					page.once("dialog", (dlg) => void dlg.accept())
					await row.getByRole("button", { name: /^Delete / }).click()
					await row.waitFor({ state: "detached", timeout: 30_000 })
					const gone = await getComponent(page, x).then(
						() => false,
						() => true
					)
					if (!gone) throw new Error(`${x === id ? "the clone" : "the import"} is still there after Delete`)
					made.delete(x)
				}
				await until(second, (cell) => !!document.querySelector(`${cell} [data-sp-missing]`), cell, PUSH_BOUND_MS + 10_000, () => "the open session page still draws the deleted widget")
				if ((await marksOn(second, c!.ownerId)).length) throw new Error("the deleted widget's string is still on the open session page")
				// Loaded afresh, the session no longer offers it: nothing of it is drawn.
				await openSession(second, f.url)
				await second.locator('.sp-remote-box[data-sp-owner="core"] [data-state-widget="stats"]').waitFor({ timeout: 60_000 })
				await second.waitForTimeout(1500)
				const left = await second.locator(ownerBox(c!.ownerId)).count()
				if (left || (await marksOn(second, c!.ownerId)).length) throw new Error(`loaded afresh, the session still draws ${left} box(es) of the deleted component`)
				return "Delete (confirmed) removes both from the list and the server; a session page open on it shows it as missing in place, and loaded afresh draws nothing of it"
			}
		}
	]

	const lines: string[] = []
	let stopped = false
	try {
		for (const step of steps) {
			if (stopped) {
				lines.push(`${step.name}: not run — an earlier step failed`)
				continue
			}
			try {
				lines.push(`${step.name}: ${await steady(page, `${tag} ${step.name}`, step.run)}`)
			} catch (e) {
				lines.push(`${step.name}: FAILED — ${firstLine(e)}`)
				stopped = true
			}
		}
	} finally {
		await steady(page, `${tag} clean up`, async () => {
			await open(page, URL_BASE)
			await booted(page)
			// A step the dev server reloaded ran again: a Stats clone it made first goes too.
			for (const x of await listComponents(page)) if (!before.has(x.id) && x.basedOn?.component === "stats") made.add(x.id)
			for (const x of made) await deleteComponent(page, x)
			await storeLayout(page, f.sessionId)
		}).catch((e) => problems.push(`${tag} could not put things back: ${firstLine(e)}`))
		await second.close()
		await (reader as Page | null)?.close()
	}

	if (snap && golden) compare(AUTHORING, normaliseSnapshot(golden.snapshot), snap, false, ["golden", "now"])
	if (snap) console.log(`${tag} preview: ${snap.tree.length} elements (golden ${golden?.snapshot.tree.length ?? "∅"}); axe ${snap.axe.join(",") || "clean"}`)
	if (editor && golden && JSON.stringify(editor) !== JSON.stringify(golden.editor))
		problems.push(`${tag} the editor differs:\n    golden ${JSON.stringify(golden.editor)}\n    now    ${JSON.stringify(editor)}`)
	const judged = golden?.steps ?? lines
	for (let i = 0; i < Math.max(judged.length, lines.length); i++) {
		const was = judged[i] ?? "∅"
		const now = lines[i] ?? "∅"
		console.log(`${tag} [step] ${now}${was === now ? "" : `  ≠  golden: ${was}`}`)
		if (/^[^:]+: (FAILED|not run)/.test(now)) failAbsolute(`${tag} [step] ${now}`)
		else if (golden && was !== now) problems.push(`${tag} [step] differs: golden "${was}" / now "${now}"`)
	}
	if (timings.length) console.log(`${tag} [push] ${timings.join("; ")}`)

	if (RECORDS_REMOTE)
		if (snap && editor && !stopped) record(AUTHORING, { format: GOLDEN_FORMAT, snapshot: snap, editor, steps: lines })
		else unrecorded.push(AUTHORING)
}
