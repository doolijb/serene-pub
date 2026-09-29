/**
 * The C7 gate (PLAN-sdk-1.0 §4, R21): core's conversation as a remote must be
 * the same widget as the native copy before anything native is removed — and
 * stays a permanent suite, the acceptance test for any later renderer swap
 * (R23). Run against a live instance; it builds its own fixture session:
 *
 *   GATE_URL=http://localhost:5234 npm run test:gate
 *
 * (`GATE_SESSION=<id>` judges a fixture an earlier run built, while there is a
 * native copy to judge it against live. The gate writes into the session it
 * judges — stream lines, the flows' exchange, an edit, a swipe — so it refuses
 * any session not named "C7 gate fixture …"; and after the cutover it refuses
 * GATE_SESSION outright: the goldens hold a fresh fixture's six messages, which
 * a fixture an earlier run wrote into no longer has.)
 *
 * For each of the five message style packs it loads the session natively and
 * as a remote (`view`) and compares, inside the conversation:
 *   - structure: every element's tag and classes, in document order;
 *   - every element's attributes and own text (ids by what they name);
 *   - the computed styles in STYLE_PROPS (layout, box, border, grid, type,
 *     colour, transform, effects) of every element and of every drawn
 *     ::before/::after — the properties listed, not every property there is
 *     (and not how the page places the root in its cell: PLACEMENT_PROPS);
 *   - where each scroller stands: every element inside that scrolls, and the
 *     conversation's ancestors up to the page, by distance from the bottom —
 *     and both copies open on the newest line;
 *   - axe violations: per rule, the remote breaks it on no more nodes;
 *   - keyboard: the Tab order through the conversation;
 *   - the remote's health: no host overlay, and nothing said in the console;
 *   - the session's own records, outright, in every copy it reads
 *     (`checkRecords`): what a golden normalises away — each row's
 *     `message-<id>`, its face, the fake reply's counter, a reference's target.
 * Then streaming (medians of alternating samples) and the flows a person uses.
 * Exits non-zero with every difference named. What it changed on the instance
 * (Chat's default, its connections' address, the style pin, and — held at a
 * fresh instance's defaults, which the goldens were recorded in — the theme,
 * dark mode and the gate connection's wire mode) it puts back — and says what
 * it was before it writes anything (`[gate] before: …`, and a JSON file
 * outside the project), so a restore that fails loses nothing.
 *
 * What the remote is judged against:
 *   GATE_AGAINST=native   the native copy, live (the default while there is one);
 *   GATE_AGAINST=golden   what an earlier run recorded (goldens/).
 *   GATE_RECORD=1         records the native copy's answers as the goldens.
 * After the cutover (`REMOTE_QUERY` is "": the remote is the plain page) the
 * two views are one page, and a "native" copy read there would be the remote
 * itself — compared with itself, always green. So there the judge is the
 * goldens (the default), `GATE_AGAINST=native` is refused, and a recording
 * is refused too unless `GATE_REBASELINE=1` says, on purpose, to record the
 * REMOTE ITSELF as the new goldens — a renderer swap must never re-baseline
 * by accident. A re-baseline writes nothing while the remote fails on its own
 * terms (`failAbsolute`), and prints what rises against the old goldens.
 */
import { createHash } from "node:crypto"
import type { Locator, Page } from "playwright"
import {
	AGAINST,
	FIXTURE_NAME,
	GOLDEN_FORMAT,
	IDREFS,
	RECORD,
	RECORDS_REMOTE,
	REPLY,
	SESSION,
	URL_BASE,
	ask,
	axeRises,
	booted,
	compare,
	failAbsolute,
	firstLine,
	mustBeNative,
	noteFatal,
	open,
	pinPack,
	problems,
	readAxe,
	readGolden,
	readShape,
	readTabs,
	ready,
	record,
	reopen,
	rises,
	stepName,
	steady,
	unrecorded,
	view,
	type Snapshot,
	type View
} from "../engine"
import { CONVERSATION_EXHIBITS, GATE_VIEWPORT, openGroup } from "./conversationExhibits"
const PACKS = (process.env.GATE_PACKS ?? "default,bubbles,novel,compact,cameo").split(",")
/** Stream samples per copy, alternating between them. */
const STREAM_SAMPLES = 3

type Timing = { toFirst: number; toDone: number; updates: number }

/* ── the pack snapshot ────────────────────────────────────────────────── */

/**
 * Everything the gate reads off one copy, the conversation's own subtree only
 * — and, given the session's records, that copy held to them (`checkRecords`),
 * which is judged outright and never part of what is recorded.
 */
async function snapshot(page: Page, v: View, records?: Records): Promise<Snapshot> {
	await open(page, v.url, v.remote)
	await ready(page, v)
	await mustBeNative(page, v)
	await page.waitForTimeout(2500)
	const sel = `${v.scope}[data-widget-part~="messages.root"]`
	const shape = await readShape(page, sel)
	// Each copy opens on the newest line: whatever scrolls inside it stands at
	// its bottom — within 4px, `sp-scroll`'s own "pinned" (SpScroll.svelte).
	// Where the two copies stand is compared exactly, like everything else.
	for (const { path, style } of shape.styles) {
		const far = [...(style["#scroll"] ?? "").matchAll(/(\d+)px from the bottom/g)].some((m) => Number(m[1]) >= 4)
		if (far) failAbsolute(`${stepName}: did not open on the newest line — ${path} ${style["#scroll"]}`)
	}
	if (records) await checkRecords(page, sel, records)
	const { axe, axeUndecided } = await readAxe(page, sel)
	const tabs = await readTabs(page, sel)
	await noteFatal(page, v, stepName)
	return { format: GOLDEN_FORMAT, ...shape, axe, axeUndecided, tabs }
}

/* ── the exhibits: the states the snapshot never draws ─────────────────── */

/** A pack's recording: its snapshot, and each exhibit read as the snapshot is. */
type PackGolden = Snapshot & { exhibits?: Record<string, Snapshot> }

/**
 * Every exhibit group (`CONVERSATION_EXHIBITS`) on the plain page, each opened
 * afresh and its states read in turn, then judged against the recording's.
 * The viewport is the gate's again whatever a group left it at.
 */
async function packExhibits(page: Page, pack: string, golden: Record<string, Snapshot> | undefined) {
	const v = view(true)
	const ctx = { page, v, sel: `${v.scope}[data-widget-part~="messages.root"]` }
	const read: Record<string, Snapshot> = {}
	let states = 0
	try {
		for (const group of CONVERSATION_EXHIBITS) {
			states += group.states.length
			const tag = `[${pack}] exhibits "${group.name}"`
			try {
				await steady(page, tag, async () => {
					await openGroup(ctx, group)
					for (const state of group.states) {
						await state.show(ctx)
						const shape = await readShape(page, ctx.sel)
						const { axe, axeUndecided } = await readAxe(page, ctx.sel)
						const tabs = await readTabs(page, ctx.sel)
						read[state.name] = { format: GOLDEN_FORMAT, ...shape, axe, axeUndecided, tabs }
					}
					await noteFatal(page, v, tag)
				})
			} catch (e) {
				failAbsolute(`${tag} could not be read: ${firstLine(e)}`)
			}
		}
	} finally {
		await page.setViewportSize(GATE_VIEWPORT)
	}
	for (const [name, now] of Object.entries(read)) {
		const was = golden?.[name]
		if (was) compare(`${pack} exhibit "${name}"`, was, now, true, ["recording", "remote"])
		else if (!RECORDS_REMOTE) problems.push(`[${pack}] exhibit "${name}" has no recording to judge against — record one: GATE_RECORD=1 GATE_REBASELINE=1 GATE_SPECS=conversation`)
		console.log(`[${pack}] exhibit "${name}" ${now.tree.length} elements (recording ${was?.tree.length ?? "∅"}); axe ${now.axe.join(",") || "clean"}`)
	}
	return { read, whole: Object.keys(read).length === states }
}

/* ── the records: what the conversation must show, whatever it is judged against ── */

/**
 * The session's own records, read through the app's socket once the fixture
 * is whole. A golden cannot hold them — a database number, a media uuid and
 * the fake reply's counter are each the run's own, so `goldenize` and the
 * snapshot normalise them, and a swap between rows reads the same there — so
 * the conversation is held to them directly.
 */
export type Records = {
	/** The session's message ids, oldest first. */
	messageIds: number[]
	/** This user's characters (personas too) by id: the name, and the uuid of its avatar's media (null: none). */
	characters: Map<number, { name: string; drawn: string; face: string | null }>
	/** This run built the fixture: every reply came from this run's model, which counts from r1 (fakeModel.mjs). */
	fresh: boolean
}

/** Read from a page with no conversation on it, so nothing the page holds takes the answer in. */
export async function readRecords(page: Page, fresh: boolean): Promise<Records> {
	await open(page, URL_BASE)
	await booted(page)
	const got = await ask(page, "sessions:get", { id: SESSION, limit: 1000 }, { where: { "session.id": SESSION } })
	const messages: Array<{ id: number }> = got?.messages ?? []
	if (!messages.length) throw new Error(`session ${SESSION} read back with no messages through sessions:get`)
	const list: Array<{ id: number; name: string; nickname?: string | null; avatarMedia?: { uuid?: string } | null }> =
		(await ask(page, "characters:list", {}))?.characterList ?? []
	return {
		messageIds: messages.map((m) => m.id).sort((a, b) => a - b),
		// `drawn`: the name a row shows (`nickname || name`, as the page resolves it).
		characters: new Map(list.map((c) => [c.id, { name: c.name, drawn: c.nickname?.trim() || c.name, face: c.avatarMedia?.uuid?.toLowerCase() ?? null }])),
		fresh
	}
}

/**
 * One copy held to the session's records, each failure outright
 * (`failAbsolute`), in whatever mode — and in live mode, in both copies:
 *   - every row carries `message-<id>`, on no other element of the page (a
 *     `#message-<id>` link from outside lands on that row), in the log's
 *     order, and the rows are the session's newest messages, in order;
 *   - a reference inside the conversation (`for`, `aria-*`, `href="#…"`)
 *     that lands inside it lands in the referrer's own message row — or, from
 *     the composer, outside every row; a composer avatar's `ref` names the
 *     persona written beside it;
 *   - each row's face is the avatar of the speaker the row names;
 *   - on a fixture this run built, the replies' counters are distinct and
 *     ascend in row order: each reply is drawn once, where it was made.
 */
async function checkRecords(page: Page, sel: string, records: Records) {
	const seen = await page.evaluate(
		({ sel, idrefs }) => {
			const root = document.querySelector(sel) as HTMLElement
			const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
			const pageIds = [...document.querySelectorAll("[id]")].map((e) => e.id)
			const rows = [...root.querySelectorAll('[data-widget-part~="messages.message"]')].map((row) => ({
				id: row.id,
				onPage: pageIds.filter((id) => id === row.id).length,
				role: row.getAttribute("data-msg-role"),
				name: flat(row.querySelector('[data-widget-part~="messages.message-name"]')?.textContent),
				face: row.querySelector('img[data-widget-part~="messages.message-avatar-img"]')?.getAttribute("src") ?? null,
				text: row.querySelector("sp-message-body")?.getAttribute("text") ?? ""
			}))
			const avatars = [...root.querySelectorAll("sp-avatar[ref]")].map((a) => ({
				ref: a.getAttribute("ref") ?? "",
				beside: flat(a.closest('[data-widget-part~="messages.composer-persona"]')?.querySelector('[data-widget-part~="messages.composer-persona-name"]')?.textContent) || null
			}))
			const rowOf = (el: Element) => el.closest('[data-widget-part~="messages.message"]')
			const said = (row: Element | null) => (row ? row.id || "an unnamed message row" : "no message row")
			const crossings: string[] = []
			for (const el of root.querySelectorAll("*")) {
				const named: Array<[string, string]> = []
				for (const a of idrefs) for (const t of (el.getAttribute(a) ?? "").split(/\s+/).filter(Boolean)) named.push([a, t])
				const href = el.getAttribute("href")
				if (href?.startsWith("#") && href.length > 1) named.push(["href", href.slice(1)])
				for (const [a, t] of named) {
					const target = document.getElementById(t)
					if (!target || !root.contains(target) || rowOf(el) === rowOf(target)) continue
					crossings.push(`<${el.tagName.toLowerCase()}> in ${said(rowOf(el))} has ${a}="${t}", which lands in ${said(rowOf(target))}`)
				}
			}
			// The log's order: its scroll region (`sp-scroll`) sticks to the top when the newest is drawn first.
			const newestFirst = root.querySelector('[data-widget-part~="messages.log-scroll"]')?.getAttribute("stick") === "top"
			return { rows, avatars, crossings, newestFirst }
		},
		{ sel, idrefs: IDREFS }
	)
	const at = stepName
	const say = (what: string) => failAbsolute(`${at}: ${what}`)
	const order = seen.newestFirst ? "newest first" : "oldest first"

	// Each row's id, and the rows as the session's newest messages.
	const unnamed = seen.rows.filter((r) => !/^message-\d+$/.test(r.id))
	if (unnamed.length)
		say(`${unnamed.length} message row(s) carry no message-<id> id (${unnamed.map((r) => JSON.stringify(r.id)).join(", ")}): a #message-<id> link cannot reach them`)
	for (const r of seen.rows) if (r.id && r.onPage !== 1) say(`the id ${r.id} is on ${r.onPage} elements of the page: a #${r.id} link lands on the first`)
	const shown = seen.rows.map((r) => Number(/^message-(\d+)$/.exec(r.id)?.[1] ?? NaN))
	const oldestFirst = seen.newestFirst ? [...shown].reverse() : shown
	const want = records.messageIds.slice(Math.max(0, records.messageIds.length - oldestFirst.length))
	if (!shown.length) say(`no message row is drawn; the session has ${records.messageIds.length} message(s)`)
	else if (!unnamed.length && (oldestFirst.length !== want.length || oldestFirst.some((n, i) => n !== want[i])))
		say(
			`the rows carry ${shown.map((n) => `message-${n}`).join(", ")} (the log draws ${order}); ` +
				`the session's newest ${oldestFirst.length} message(s), oldest first, are ${want.join(", ") || "none"}`
		)

	// A reference lands where it should.
	for (const c of seen.crossings) say(`a reference crosses message rows: ${c}`)
	for (const a of seen.avatars) {
		const id = /^character:(\d+)$/.exec(a.ref)?.[1]
		if (!id) continue
		const who = records.characters.get(Number(id))
		if (!who) say(`an avatar names ${a.ref}, which is none of this user's characters`)
		else if (a.beside !== null && who.name !== a.beside)
			say(`the composer's avatar names ${a.ref} (${JSON.stringify(who.name)}) beside the persona ${JSON.stringify(a.beside)}`)
	}

	// Each row's face is its own speaker's.
	const owners = new Map<string, Set<string>>()
	for (const { name, drawn, face } of records.characters.values())
		if (face) for (const n of [name, drawn]) (owners.get(face) ?? owners.set(face, new Set()).get(face)!).add(n)
	for (const r of seen.rows) {
		if (!r.face) continue
		const uuid = /\/media\/([0-9a-f-]{36})/i.exec(r.face)?.[1]?.toLowerCase()
		const whose = uuid ? owners.get(uuid) : undefined
		if (!whose?.has(r.name))
			say(
				`${r.id || "a message row"} shows ${whose ? `the avatar of ${[...whose].map((n) => JSON.stringify(n)).join(" / ")}` : `a face that is no character's avatar (${r.face})`} ` +
					`beside the name ${JSON.stringify(r.name)}`
			)
	}

	// Each fake reply drawn once, in the order it was made.
	if (records.fresh) {
		const counters = seen.rows
			.filter((r) => r.role === "assistant")
			.map((r) => /^\s*r(\d+) w0\b/.exec(r.text)?.[1])
			.filter((c): c is string => c !== undefined)
			.map(Number)
		const made = seen.newestFirst ? [...counters].reverse() : counters
		if (made.some((n, i) => i > 0 && n <= made[i - 1]!))
			say(
				`the replies read ${counters.map((n) => `r${n}`).join(", ")} in row order (the log draws ${order}): ` +
					`on a fixture this run built each reply is drawn once, in the order its model made it`
			)
	}
}

/* ── streaming (the gate's first bullet) ─────────────────────────────── */

/** Send a line and record, frame by frame, when the reply's text changed on the page. */
async function streamTiming(page: Page, v: View): Promise<Timing> {
	await open(page, v.url, v.remote)
	await ready(page, v, " textarea")
	await mustBeNative(page, v)
	await page.waitForTimeout(1500)
	await page.evaluate((scope) => {
		const w = window as unknown as { __gate: { t: number; len: number }[]; __gateStop?: boolean }
		w.__gate = []
		w.__gateStop = false
		const body = () => {
			const rows = document.querySelectorAll(`${scope}[data-widget-part~="messages.message"]`)
			return rows[rows.length - 1]?.querySelector("sp-message-body")?.getAttribute("text") ?? ""
		}
		let last = -1
		const frame = () => {
			const len = body().length
			if (len !== last) w.__gate.push({ t: performance.now(), len }), (last = len)
			if (!w.__gateStop) requestAnimationFrame(frame)
		}
		requestAnimationFrame(frame)
	}, v.scope)
	const field = page.locator(`${v.scope}[data-widget-part~="messages.root"] textarea`).last()
	// Unique per sample: a long log is windowed, so a row count says nothing.
	const line = `gate stream ${v.name} ${Date.now()}`
	await field.fill(line)
	const sent = await page.evaluate(() => performance.now())
	await field.press("Enter")
	// Done when the line sent is the last person's line and the row after it
	// holds a whole reply.
	await page.waitForFunction(
		({ scope, reply, line }) => {
			const rows = [...document.querySelectorAll(`${scope}[data-widget-part~="messages.message"]`)]
			const at = rows.findIndex((r) => r.querySelector("sp-message-body")?.getAttribute("text")?.trim() === line)
			const text = (at >= 0 ? rows[at + 1] : undefined)?.querySelector("sp-message-body")?.getAttribute("text")?.trim()
			return !!text && new RegExp(reply).test(text)
		},
		{ scope: v.scope, reply: REPLY, line },
		{ timeout: 60_000 }
	)
	await page.waitForTimeout(300)
	const trace = await page.evaluate(() => {
		const w = window as unknown as { __gate: { t: number; len: number }[]; __gateStop?: boolean }
		w.__gateStop = true
		return w.__gate
	})
	await noteFatal(page, v, stepName)
	const growing = trace.filter((p, i) => i > 0 && p.len > trace[i - 1]!.len)
	const first = growing[0]?.t ?? sent
	const done = trace[trace.length - 1]!.t
	return { toFirst: first - sent, toDone: done - sent, updates: growing.length }
}

function median(xs: number[]) {
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * The remote shows its first words and finishes as soon as the native copy
 * does, and redraws as often — judged on medians. Within one run both copies
 * share the machine's load; a recording from another run does not (the same
 * code has measured 184ms apart run to run), so it gets a wider margin.
 */
function judgeStream(native: Timing[], remote: Timing[], recorded: boolean) {
	const [floor, share] = recorded ? [300, 0.1] : [150, 0.05]
	const slack = (base: number) => Math.max(floor, base * share)
	const med = (xs: Timing[], k: keyof Timing) => median(xs.map((x) => x[k]))
	console.log(
		`[stream] medians of ${native.length} native / ${remote.length} remote samples; margin max(${floor}ms, ${share * 100}%)` +
			(recorded ? " — wider: native is a recording from another run" : "")
	)
	if (!native.length || !remote.length) return
	for (const [k, what] of [["toFirst", "showed its first words"], ["toDone", "finished"]] as const) {
		const n = med(native, k)
		const r = med(remote, k)
		console.log(`[stream] ${k}: native ${Math.round(n)}ms (${native.map((x) => Math.round(x[k])).join(", ")}), remote ${Math.round(r)}ms (${remote.map((x) => Math.round(x[k])).join(", ")})`)
		if (r > n + slack(n))
			problems.push(`[stream] the remote ${what} ${Math.round(r - n)}ms after the native copy (medians ${Math.round(r)} / ${Math.round(n)}ms; allowed ${Math.round(slack(n))}ms)`)
	}
	const n = med(native, "updates")
	const r = med(remote, "updates")
	console.log(`[stream] updates: native ${n}, remote ${r}`)
	if (r < n * 0.6) problems.push(`[stream] the remote redrew ${r} times against the native ${n} (medians) — visibly steppier`)
}

/* ── the flows (the gate's second bullet) ───────────────────────────── */

/**
 * Each flow a person uses, run the same way in both copies: each step asserts
 * what it should have produced and says so in a sentence, and the two lists
 * must agree — agreeing on a broken flow is not parity. A step that fails
 * records why.
 */
async function flows(page: Page, v: View): Promise<string[]> {
	await open(page, v.url, v.remote)
	await ready(page, v, " textarea")
	await mustBeNative(page, v)
	await page.waitForTimeout(1500)
	const conv = page.locator(`${v.scope}[data-widget-part~="messages.root"]`)
	const out: string[] = []
	const bodyOf = (row: Locator) =>
		row.locator("sp-message-body").first().getAttribute("text").then((t) => t ?? "")
	const lastRow = (role: "user" | "assistant") => conv.locator(`[data-widget-part~="messages.message"][data-msg-role="${role}"]`).last()
	/** The fake reply's counter (`r12`): which reply a row shows, in a sentence. */
	const which = (text: string) => text.trim().split(" ")[0] || "∅"
	// Both copies meet the same shape: a fresh exchange, its reply with no
	// alternatives yet — not whatever the copy before left behind.
	const opening = `gate flows ${v.name} ${Date.now()}`
	const field = conv.locator("textarea").last()
	await field.fill(opening)
	await field.press("Enter")
	await page.waitForFunction(
		({ scope, reply, line }) => {
			const rows = [...document.querySelectorAll(`${scope}[data-widget-part~="messages.message"]`)]
			const at = rows.findIndex((r) => r.querySelector("sp-message-body")?.getAttribute("text")?.trim() === line)
			const row = at >= 0 ? rows[at + 1] : undefined
			const text = row?.querySelector("sp-message-body")?.getAttribute("text")?.trim()
			return !!row && !row.hasAttribute("data-msg-generating") && !!text && new RegExp(reply).test(text)
		},
		{ scope: v.scope, reply: REPLY, line: opening },
		{ timeout: 60_000 }
	)
	await page.waitForFunction((scope) => !document.querySelector(`${scope}[data-widget-part~="messages.root"] [aria-label="Stop generating"]`), v.scope, { timeout: 30_000 })
	await page.waitForTimeout(1000)
	/**
	 * A person reads what opened before dismissing it; a popover that has not
	 * yet taken its Escape handling (it attaches after the opening press) is
	 * not a popover that ignores Escape.
	 */
	const glance = () => page.waitForTimeout(400)
	const step = async (name: string, fn: () => Promise<string>) => {
		try {
			out.push(`${name}: ${await fn()}`)
		} catch (e) {
			out.push(`${name}: FAILED — ${firstLine(e)}`)
			// What a failed step left open (an edit, a menu) is not the next
			// step's to meet: it starts from a fresh load, so one failure is
			// one line, not every line after it.
			await noteFatal(page, v, `${stepName} ${name}`)
			await reopen(page)
			await ready(page, v, " textarea")
			await page.waitForTimeout(1500)
		}
	}

	await step("edit", async () => {
		const want = `edited in the gate (${v.name})`
		const row = lastRow("user")
		const before = await bodyOf(row)
		await row.getByRole("button", { name: "Edit", exact: true }).click()
		const field = row.locator("textarea").first()
		await field.waitFor({ timeout: 8_000 })
		// The field opens holding the line; a remote's value reaches the page
		// through the host, so it gets the moment a person would give it.
		let held = await field.inputValue()
		for (let i = 0; i < 30 && held !== before; i++) {
			await page.waitForTimeout(100)
			held = await field.inputValue()
		}
		if (held !== before)
			throw new Error(`the field opened holding ${JSON.stringify(held.slice(0, 60))}, not the line's ${JSON.stringify(before.slice(0, 60))}`)
		await field.fill(want)
		await row.getByRole("button", { name: /save/i }).click()
		/**
		 * The line's own text — once its editor has closed. While it is open
		 * the row's only body is the editor's preview (MessageComposer's
		 * `sp-message-body text={markdown}`), which reads the new text before
		 * anything was sent; a remote closes its editor one worker turn after
		 * the press, so a read in that turn would take the preview for the line.
		 */
		const lastUser = () =>
			page.evaluate((scope) => {
				const rows = document.querySelectorAll(`${scope}[data-widget-part~="messages.message"][data-msg-role="user"]`)
				const row = rows[rows.length - 1]
				if (row?.querySelector("textarea")) return "(its editor is still open)"
				return row?.querySelector("sp-message-body")?.getAttribute("text")?.trim() ?? null
			}, v.scope)
		const reads = (timeout: number) =>
			page
				.waitForFunction(
					({ scope, want }) => {
						const rows = document.querySelectorAll(`${scope}[data-widget-part~="messages.message"][data-msg-role="user"]`)
						const row = rows[rows.length - 1]
						return !row?.querySelector("textarea") && row?.querySelector("sp-message-body")?.getAttribute("text")?.trim() === want
					},
					{ scope: v.scope, want },
					{ timeout }
				)
				.then(
					() => true,
					() => false
				)
		if (!(await reads(15_000))) throw new Error(`the line never read the new text (it reads ${JSON.stringify((await lastUser())?.slice(0, 60))})`)
		// Showing it is not keeping it: a copy can draw the new text before the
		// host answers and fall back when it declines. Read it again for a
		// while, then from a fresh load — the server's answer.
		for (const until = Date.now() + 1500; Date.now() < until; await page.waitForTimeout(100)) {
			const now = await lastUser()
			if (now !== want) throw new Error(`the new text showed, then the line went back to ${JSON.stringify(now?.slice(0, 60))}`)
		}
		await noteFatal(page, v, `${stepName} edit`)
		await reopen(page)
		await ready(page, v, " textarea")
		if (!(await reads(15_000))) throw new Error(`after a reload the line reads ${JSON.stringify((await lastUser())?.slice(0, 60))}: the edit did not keep`)
		await page.waitForTimeout(1500)
		return "the field opens holding the line; the new text shows, stays, and survives a reload"
	})

	await step("swipe", async () => {
		const row = lastRow("assistant")
		const counter = row.locator('[data-widget-part~="messages.message-swipe-count"]')
		// The counter is drawn only once a reply has alternatives: none is one of one.
		const read = async () => ((await counter.count()) ? ((await counter.first().textContent()) ?? "").trim() : "")
		const parse = (c: string) => {
			const [k, n] = c.split("/").map((x) => Number(x.trim()))
			return [k || 1, n || 1] as const
		}
		// Trailing whitespace is not drawn: a reply's own text and its copy in
		// the swipe history can differ by one (the stream's last space).
		const shownText = async () => (await bodyOf(row)).trim()
		const [k0, n0] = parse(await read())
		const text0 = await shownText()
		if (!new RegExp(REPLY).test(text0)) throw new Error(`the last reply is not a whole fake reply: ${JSON.stringify(text0.slice(0, 40))}`)
		// A new alternative is a swipe to the right (Regenerate replaces in place).
		await row.getByRole("button", { name: "Next swipe" }).click()
		// One more swipe, generation over, and a whole reply that reads
		// differently — every fake reply carries its own counter.
		const arrived = await page
			.waitForFunction(
				({ scope, n0, text0, reply }) => {
					const rows = [...document.querySelectorAll(`${scope}[data-widget-part~="messages.message"][data-msg-role="assistant"]`)]
					const r = rows[rows.length - 1]
					const n = Number((r?.querySelector('[data-widget-part~="messages.message-swipe-count"]')?.textContent ?? "").split("/")[1] ?? 0)
					const text = r?.querySelector("sp-message-body")?.getAttribute("text")?.trim() ?? ""
					return n > n0 && !r?.hasAttribute("data-msg-generating") && new RegExp(reply).test(text) && text !== text0.trim()
				},
				{ scope: v.scope, n0, text0, reply: REPLY },
				{ timeout: 30_000 }
			)
			.then(
				() => true,
				() => false
			)
		if (!arrived) throw new Error(`no new reply arrived: the counter reads "${await read()}" and the row shows ${which(await shownText())} (was ${which(text0)})`)
		// The reply's run finishes after its text does (its aftermath steps);
		// a person presses next once the conversation is idle, and so does this.
		await page.waitForFunction(
			(scope) => !document.querySelector(`${scope}[data-widget-part~="messages.root"] [aria-label="Stop generating"]`),
			v.scope,
			{ timeout: 30_000 }
		)
		await page.waitForTimeout(1000)
		/** After a press: the counter moves off `was`, then the text off `text` (a remote draws them in its own time). */
		const settle = async (was: string, text: string) => {
			for (let i = 0; i < 50 && (await read()) === was; i++) await page.waitForTimeout(100)
			for (let i = 0; i < 50 && (await shownText()) === text; i++) await page.waitForTimeout(100)
			return [await read(), await shownText()] as const
		}
		const atNew = await read()
		const textNew = await shownText()
		const [k, n] = parse(atNew)
		await row.getByRole("button", { name: "Previous swipe" }).click()
		const [atPrev, textPrev] = await settle(atNew, textNew)
		await row.getByRole("button", { name: "Next swipe" }).click()
		const [atNext, textNext] = await settle(atPrev, textPrev)
		const [pk] = parse(atPrev)
		const [nk, nn] = parse(atNext)
		/** Where two texts part, when they do: enough to say what a person would see differ. */
		const parted = (a: string, b: string) => {
			let i = 0
			while (i < a.length && a[i] === b[i]) i++
			return `at ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 12), i + 12))} / ${JSON.stringify(b.slice(Math.max(0, i - 12), i + 12))}`
		}
		const wrong = [
			!(k === n && n === n0 + 1 && pk === k - 1 && nk === k && nn === n) && "the counter",
			textPrev === textNew && "previous showed the same reply",
			textNext !== textNew && `next did not return to the new reply (${parted(textNew, textNext)})`,
			// Before the swipe the row showed its last alternative, so the one
			// before the new reply is that one.
			k0 === n0 && textPrev !== text0 && `previous did not show the reply it replaced (${parted(text0, textPrev)})`
		].filter(Boolean)
		if (wrong.length)
			throw new Error(
				`the swipes did not step as they should — ${wrong.join("; ")}: ${atNew} ${which(textNew)} → previous ${atPrev} ${which(textPrev)} → next ${atNext} ${which(textNext)} (before: ${k0} / ${n0} ${which(text0)})`
			)
		return "a new reply is the last of its swipes and reads anew; previous shows the reply it replaced; next returns to it"
	})

	await step("actions disclosure", async () => {
		const toggle = conv.getByRole("button", { name: "Actions", exact: true })
		await toggle.click()
		await page.waitForTimeout(400)
		const open = await toggle.getAttribute("aria-expanded")
		// What it opens, not only what it says: the region its aria-controls
		// names is there, drawn, and offers something to press. The sentence
		// stays the recorded one; a region missing, undrawn or empty fails it.
		if (open === "true") {
			const controls = (await toggle.getAttribute("aria-controls")) ?? ""
			// A remote draws the region a worker turn after the press: asked for a while.
			const wrong = await page.evaluate(async (id) => {
				const shown = (el: Element) => (el as Element & { checkVisibility?: () => boolean }).checkVisibility?.() !== false
				const offers = () => {
					const region = id ? document.getElementById(id) : null
					if (!region) return id ? `no element is #${id}` : "the toggle names no region (aria-controls)"
					if (!shown(region)) return `#${id} is not drawn`
					return [...region.querySelectorAll("button, [role=button]")].some(shown) ? null : `#${id} is drawn but offers nothing to press`
				}
				let why = offers()
				for (let i = 0; i < 50 && why !== null; i++) {
					await new Promise((r) => setTimeout(r, 100))
					why = offers()
				}
				return why
			}, controls)
			if (wrong) throw new Error(`aria-expanded reads "true", but ${wrong}`)
		}
		await toggle.click()
		await page.waitForTimeout(300)
		const closed = await toggle.getAttribute("aria-expanded")
		if (open !== "true" || closed !== "false") throw new Error(`aria-expanded read "${open}" opened and "${closed}" closed`)
		return "opens (true) and closes (false)"
	})

	await step("slash palette", async () => {
		const field = conv.locator("textarea").last()
		await field.fill("/")
		const options = conv.getByRole("option")
		await options.first().waitFor({ timeout: 5_000 }).catch(() => {})
		await page.waitForTimeout(300)
		const labels = await options.evaluateAll((os) => os.map((o) => (o.textContent ?? "").replace(/\s+/g, " ").trim()))
		await field.press("Escape")
		await field.fill("")
		if (!labels.length) throw new Error("typing / offered no command")
		return `offers, in order: ${labels.join(" | ")}`
	})

	await step("picker", async () => {
		await conv.getByRole("button", { name: "Pick", exact: true }).click()
		const dialog = page.getByRole("dialog").filter({ hasText: /speaks next|who speaks/i })
		await dialog.first().waitFor({ timeout: 8_000 })
		await glance()
		await page.keyboard.press("Escape")
		if (!(await dialog.first().waitFor({ state: "hidden", timeout: 3_000 }).then(() => true, () => false)))
			throw new Error("Escape left the picker open")
		await page.waitForTimeout(400)
		return `opens the host's "who speaks next" picker; Escape closes it`
	})

	await step("message menu", async () => {
		const row = lastRow("assistant")
		await row.getByRole("button", { name: "Message options" }).click()
		const menu = page.getByRole("dialog", { name: "Message options" })
		await menu.waitFor({ timeout: 8_000 })
		const items = await menu.getByRole("button").evaluateAll((bs) =>
			bs.map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim()).filter(Boolean)
		)
		await glance()
		await page.keyboard.press("Escape")
		if (!(await menu.waitFor({ state: "hidden", timeout: 3_000 }).then(() => true, () => false)))
			throw new Error(`Escape left the menu open (it offered ${items.join(", ") || "nothing"})`)
		await page.waitForTimeout(300)
		return `offers ${items.join(", ") || "nothing"}; Escape closes it`
	})

	await step("branch", async () => {
		const row = lastRow("assistant")
		await row.getByRole("button", { name: "Message options" }).click()
		await page.getByRole("dialog", { name: "Message options" }).getByRole("button", { name: /branch/i }).click()
		const heading = page.getByRole("heading", { name: /branch/i }).first()
		await heading.waitFor({ timeout: 8_000 })
		await glance()
		await page.keyboard.press("Escape")
		if (!(await heading.waitFor({ state: "hidden", timeout: 3_000 }).then(() => true, () => false)))
			throw new Error("Escape left the branch dialog open")
		await page.waitForTimeout(400)
		return "opens the branch dialog; Escape closes it"
	})

	await noteFatal(page, v, stepName)
	return out
}

/* ── the fixture ──────────────────────────────────────────────────────── */

/**
 * The fixture: a Chat with one character and one persona and three
 * exchanges from the fake model — the same shape every run, so the goldens
 * hold. Built through the app's own socket, in two halves: the session first
 * (plain keys, so any page will do), then — once `useFakeModel` has pointed
 * Chat at this run's model from the session's own page, where the shell
 * knows the user and admin keys go out — the exchanges.
 */
export async function fixtureSession(page: Page): Promise<number> {
	await open(page, URL_BASE)
	await booted(page)
	const list: Array<{ id: number; name: string; isPersona: boolean; avatarMediaId?: number | null }> =
		(await ask(page, "characters:list", {}))?.characterList ?? []
	// Both carry a face, so the conversation's avatars are compared too (a
	// face URL names its revision: `/media/<uuid>?v=thumb&r=1`).
	const ensure = async (name: string, isPersona: boolean, color: string) =>
		list.find((c) => c.name === name && !!c.isPersona === isPersona && c.avatarMediaId != null)?.id ??
		(
			await ask(
				page,
				"characters:create",
				{ character: { name, description: "The C7 gate's fixture.", isPersona } },
				{ avatar: { color, letter: name.split(" ").at(-1)![0]! } }
			)
		)?.character?.id
	const character = await ensure("C7 gate Mira", false, "#7c3aed")
	const persona = await ensure("C7 gate Sam", true, "#0f766e")
	const made = await ask(page, "sessions:create", {
		session: { name: `${FIXTURE_NAME} ${new Date().toISOString()}` },
		characterIds: [character],
		personaIds: [persona],
		characterPositions: { [character]: 0 }
	})
	if (!made?.session?.id) throw new Error(`the fixture session was refused: ${JSON.stringify(made)}`)
	return made.session.id as number
}

export async function fixtureExchanges(page: Page) {
	const v = view(false)
	await open(page, v.url)
	await ready(page, v, " textarea")
	const answered = (line: string) =>
		page.evaluate(
			({ line, reply }) => {
				const rows = [...document.querySelectorAll('[data-widget-part~="messages.message"]')]
				const at = rows.findIndex((r) => r.querySelector("sp-message-body")?.getAttribute("text")?.trim() === line)
				const row = at >= 0 ? rows[at + 1] : undefined
				const text = row?.querySelector("sp-message-body")?.getAttribute("text")?.trim()
				return !!row && !row.hasAttribute("data-msg-generating") && !!text && new RegExp(reply).test(text)
			},
			{ line, reply: REPLY }
		)
	await page.waitForTimeout(1500)
	for (const line of ["Good evening.", "What are you reading?", "Tell me more."]) {
		// A step run again after a reload keeps the exchanges already made, so
		// the fixture has the same shape however often it was interrupted.
		if (await answered(line)) continue
		const field = page.locator('[data-widget-part~="messages.root"] textarea').last()
		await field.fill(line)
		await field.press("Enter")
		for (const until = Date.now() + 60_000; !(await answered(line)); await page.waitForTimeout(200))
			if (Date.now() > until) throw new Error(`the fixture's "${line}" got no whole reply in 60s`)
	}
	await page.waitForFunction(() => !document.querySelector('[data-widget-part~="messages.root"] [aria-label="Stop generating"]'), null, { timeout: 30_000 })
}

/* ── judging it ───────────────────────────────────────────────────────── */

/**
 * The conversation's whole judgement, once its fixture is whole and Chat
 * points at the gate's model: every pack's snapshot against its golden, the
 * stream timing, and the flows.
 */
export async function judgeConversation(page: Page, records: Records) {
	const recordedNative = AGAINST === "golden"
	/**
	 * The recording judged by. Re-baselining, a missing or older one leaves
	 * that part unjudged — it is about to be replaced — and says so.
	 */
	const judgeBy = <T extends { format?: number }>(name: string): Promise<T | null> =>
		RECORDS_REMOTE
			? readGolden<T>(name).catch((e) => (console.log(`[rebaseline] ${firstLine(e)}: nothing to judge against, recorded afresh`), null))
			: readGolden<T>(name)
	const looks = new Set<string>()
	/** The remote's own looks, whatever the reference's are: a pack not applied on it shows here in every mode. */
	const remoteLooks = new Set<string>()
	let drawn = 0
	for (const pack of PACKS) {
		await steady(page, `pin ${pack}`, () => pinPack(page, pack))
		const native = recordedNative
			? await judgeBy<Snapshot>(`pack-${pack}`)
			: await steady(page, `[${pack}] native`, () => snapshot(page, view(false), records))
		if (RECORD && !RECORDS_REMOTE) record(`pack-${pack}`, native)
		const scrollsIn = (s: Snapshot) =>
			s.styles.filter((e) => e.style["#scroll"]).map((e) => `${e.path.split(" ")[1]} ${e.style["#scroll"]}`).join(" / ") || "none"
		const lookOf = (s: Snapshot) => createHash("sha256").update(JSON.stringify(s.styles)).digest("hex").slice(0, 10)
		if (native) looks.add(lookOf(native))
		let remote: Snapshot
		try {
			remote = await steady(page, `[${pack}] remote`, () => snapshot(page, view(true), records))
		} catch (e) {
			failAbsolute(`[${pack}] the remote could not be read: ${firstLine(e)}`)
			if (RECORDS_REMOTE) unrecorded.push(`pack-${pack}`)
			continue
		}
		if (!native) looks.add(lookOf(remote))
		drawn++
		remoteLooks.add(lookOf(remote))
		if (native) compare(pack, native, remote, recordedNative)
		// The states the snapshot never draws (`conversationExhibits.ts`), judged against the recording's.
		const exhibits = await packExhibits(page, pack, (native as PackGolden | null)?.exhibits)
		if (RECORDS_REMOTE)
			if (exhibits.whole) record(`pack-${pack}`, { ...remote, exhibits: exhibits.read })
			else unrecorded.push(`pack-${pack}`)
		if (RECORDS_REMOTE && native) axeRises(pack, native, remote)
		console.log(
			`[${pack}] look ${lookOf(native ?? remote)}; native ${native?.tree.length ?? "∅"} elements, remote ${remote.tree.length}; ` +
				`axe native ${native ? native.axe.join(",") || "clean" : "∅"}, remote ${remote.axe.join(",") || "clean"}; ` +
				`undecided native ${native ? native.axeUndecided.map((u) => `${u.rule}×${u.nodes}`).join(",") || "none" : "∅"}, remote ${remote.axeUndecided.map((u) => `${u.rule}×${u.nodes}`).join(",") || "none"}; ` +
				`scrolls inside native ${native ? scrollsIn(native) : "∅"}, remote ${scrollsIn(remote)}; ` +
				`scrolls above native ${native?.scrollAbove ?? "∅"}, remote ${remote.scrollAbove}`
		)
	}
	// A gate that compared one look five times would pass while proving nothing.
	if (looks.size < PACKS.length) problems.push(`only ${looks.size} distinct looks across ${PACKS.length} packs — a pack was not applied`)
	if (remoteLooks.size < drawn)
		failAbsolute(`the remote drew only ${remoteLooks.size} distinct looks across the ${drawn} packs it drew — a pack was not applied on it`)
	await steady(page, "pin default", () => pinPack(page, "default"))

	// Streaming at a fast local model's rate, sampled alternately — and
	// alternating which copy goes first, so each meets the same server
	// load and the same growing log.
	const samples: Record<View["name"], Timing[]> = { native: [], remote: [] }
	for (let round = 0; round < STREAM_SAMPLES; round++)
		for (const remote of round % 2 ? [true, false] : [false, true]) {
			if (!remote && recordedNative) continue
			const v = view(remote)
			try {
				samples[v.name].push(await steady(page, `[stream] ${v.name} ${round + 1}`, () => streamTiming(page, v)))
			} catch (e) {
				if (!remote) throw e
				failAbsolute(`[stream] remote sample ${round + 1}: ${firstLine(e)}`)
			}
		}
	const nativeSamples = recordedNative ? ((await judgeBy<{ format: number; samples: Timing[] }>("stream"))?.samples ?? []) : samples.native
	if (RECORD)
		if (!RECORDS_REMOTE) record("stream", { format: GOLDEN_FORMAT, samples: samples.native })
		else if (samples.remote.length === STREAM_SAMPLES) record("stream", { format: GOLDEN_FORMAT, samples: samples.remote })
		else unrecorded.push("stream")
	judgeStream(nativeSamples, samples.remote, recordedNative)
	if (RECORDS_REMOTE && nativeSamples.length && samples.remote.length) {
		const med = (xs: Timing[], k: keyof Timing) => median(xs.map((x) => x[k]))
		for (const k of ["toFirst", "toDone"] as const)
			if (med(samples.remote, k) > med(nativeSamples, k))
				rises.push(`[stream] median ${k}: ${Math.round(med(nativeSamples, k))}ms → ${Math.round(med(samples.remote, k))}ms`)
		if (med(samples.remote, "updates") < med(nativeSamples, "updates"))
			rises.push(`[stream] median redraws fall: ${med(nativeSamples, "updates")} → ${med(samples.remote, "updates")} (steppier)`)
	}

	// The flows, through host elements. A flow's sentence may name its copy; judged, the name is not.
	const nativeFlows = recordedNative
		? ((await judgeBy<{ format: number; flows: string[] }>("flows"))?.flows ?? null)
		: await steady(page, "[flow] native", () => flows(page, view(false)))
	if (RECORD && !RECORDS_REMOTE) record("flows", { format: GOLDEN_FORMAT, flows: nativeFlows })
	let remoteFlows: string[] = []
	try {
		remoteFlows = await steady(page, "[flow] remote", () => flows(page, view(true)))
		if (RECORDS_REMOTE) record("flows", { format: GOLDEN_FORMAT, flows: remoteFlows })
	} catch (e) {
		failAbsolute(`[flow] the remote's flows could not run: ${firstLine(e)}`)
		if (RECORDS_REMOTE) unrecorded.push("flows")
	}
	const judged = nativeFlows ?? remoteFlows
	const neutral = (line: string) => line.replace(/\((?:native|remote)\)/g, "(this copy)")
	for (let i = 0; i < Math.max(judged.length, remoteFlows.length); i++) {
		const n = judged[i] ?? "∅"
		const r = remoteFlows[i] ?? "∅"
		const same = neutral(n) === neutral(r)
		console.log(`[flow] ${n}${same ? "" : `  ≠  remote: ${r}`}`)
		if (nativeFlows && n.includes("FAILED")) problems.push(`[flow] native ${n}`)
		if (r.includes("FAILED")) failAbsolute(`[flow] remote ${r}`)
		else if (nativeFlows && !same) problems.push(`[flow] differs: native "${n}" / remote "${r}"`)
	}
}
