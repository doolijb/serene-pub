/**
 * The live gate (PLAN-sdk-1.0 §4, R21; PLAN-r21-core-widgets §4): every core
 * session widget, as the remote it is, judged against a live instance — the
 * permanent acceptance suite for any later renderer swap (R23).
 *
 *   GATE_URL=http://localhost:5234 GATE_MODEL_URL=http://127.0.0.1:47998/v1 npm run test:gate
 *
 * The engine (`engine.ts`) drives the instance and the page and holds the
 * goldens; each spec says what one widget must do:
 *   - `specs/conversation.ts` — the conversation under every message style
 *     pack, its stream timing and its flows (the C7 gate; its header says
 *     what it compares and how GATE_AGAINST / GATE_RECORD / GATE_REBASELINE
 *     work);
 *   - `specs/worldState.ts`, `specs/stats.ts`, `specs/loreEntries.ts`,
 *     `specs/scenePortraits.ts` — the four side widgets, on one Adventure
 *     fixture (`specs/adventure.ts`): each mounts as a core remote, draws the
 *     fixture's records, matches its golden, and its flows work end to end;
 *   - `specs/authoring.ts` — in-app component authoring (C6): core's Stats
 *     cloned, edited, previewed, saved, switched on and seated in the
 *     Adventure fixture under its own authored owner, reloaded live from a
 *     second browser context, broken (kept as a draft) and reverted, exported, imported, refused
 *     to a non-admin, and deleted. It needs SP_PLUGINS_ENABLED=1 and accounts
 *     on, the gate signed in as the admin (GATE_ADMIN_USERNAME /
 *     GATE_ADMIN_PASSWORD; every page the gate opens signs in when they are
 *     set).
 *   - `specs/frames.ts` — plugin frames at every frame point (panel,
 *     session-view, page): a fixture plugin installed, reviewed and switched
 *     on; its document served under its grant-composed CSP and mounted
 *     sandboxed; fed only its lanes, no scoped section, and rows without the
 *     host's fields; an unprompted gated invoke refused and a person's press
 *     let through; and every frame gone once it is switched off. Needs what
 *     authoring needs (SP_PLUGINS_ENABLED=1, the admin).
 * `GATE_SPECS=conversation,stats` runs some of them (default: all). Exits
 * non-zero with every difference named, having put back what it changed.
 */
import { chromium } from "playwright"
import {
	AGAINST,
	ONE_PAGE,
	RECORD,
	RECORDS_REMOTE,
	SESSION,
	absolute,
	fakeModel,
	gatePage,
	firstLine,
	judgeConsole,
	problems,
	recorded,
	refuseForeignSession,
	restoreInstance,
	rises,
	setSession,
	steady,
	unrecorded,
	useFakeModel,
	writeGoldens,
	type Prior
} from "./engine"
import { fixtureExchanges, fixtureSession, judgeConversation, readRecords } from "./specs/conversation"
import { WIDGET_SPECS, runWidgetSpec } from "./specs/widgets"
import { AUTHORING, runAuthoringSpec } from "./specs/authoring"
import { FRAMES, runFramesSpec } from "./specs/frames"

const SPEC_NAMES = ["conversation", ...WIDGET_SPECS.map((s) => s.name), AUTHORING, FRAMES]
const SPECS = new Set((process.env.GATE_SPECS ?? SPEC_NAMES.join(",")).split(",").map((s) => s.trim()).filter(Boolean))
for (const s of SPECS)
	if (!SPEC_NAMES.includes(s)) {
		console.error(`gate: refused — GATE_SPECS names "${s}"; the specs are ${SPEC_NAMES.join(", ")}`)
		process.exit(2)
	}

const started = Date.now()
let stopped = false
const browser = await chromium.launch()
try {
	const page = await gatePage(browser)
	const model = await fakeModel()
	const prior: Prior = {}
	try {
		console.log(
			`[gate] fake model at ${model.baseUrl}; judged against ${AGAINST}` +
				(ONE_PAGE ? " — one page (the cutover): the goldens are the only judge" : "") +
				(RECORDS_REMOTE ? "; RE-BASELINING: the remote's own answers become the goldens" : RECORD ? "; recording the native copy" : "")
		)
		const building = !SESSION
		if (building) {
			setSession(await steady(page, "fixture", () => fixtureSession(page)))
			console.log(`[gate] fixture session ${SESSION}`)
		} else await steady(page, "session", () => refuseForeignSession(page))
		await steady(page, "model", () => useFakeModel(page, model.baseUrl, prior))
		if (building) await steady(page, "fixture exchanges", () => fixtureExchanges(page))
		// What each pack's conversation must show, outright (`checkRecords`):
		// nothing the packs do adds a message, so one reading holds for all.
		const records = await steady(page, "records", () => readRecords(page, building))

		if (SPECS.has("conversation")) await judgeConversation(page, records)
		// The side widgets, each on the Adventure fixture (built once, by the first that asks).
		const widgets = WIDGET_SPECS.filter((spec) => SPECS.has(spec.name))
		if (widgets.length) {
			// The second socket every push is timed on: another page on the session.
			const second = await gatePage(browser)
			try {
				for (const spec of widgets) await runWidgetSpec(page, second, spec)
			} finally {
				await second.close()
			}
		}
		// Last: it seats its widget in the Adventure fixture, and puts the layout back after.
		if (SPECS.has(AUTHORING)) await runAuthoringSpec(browser, page)
		// After every other: while installed, its panel is offered to every session.
		if (SPECS.has(FRAMES)) await runFramesSpec(page)
	} finally {
		await restoreInstance(page, prior)
		model.server?.close()
		judgeConsole()
	}
} catch (e) {
	// A run that stopped still says what it found before it stopped.
	console.error(e)
	stopped = true
	problems.push(`[gate] the run stopped: ${firstLine(e)}`)
} finally {
	await browser.close()
}

// Re-baselining: every rise against the old goldens is said before anything
// is written — recorded, it is what every later run accepts — and a remote
// that failed on its own terms is never recorded as the reference.
if (RECORDS_REMOTE && rises.length)
	console.log(`[rebaseline] against the old goldens, these rise — recorded, each is the new allowance:\n    ${rises.join("\n    ")}`)
const refusals = RECORDS_REMOTE ? problems.filter((p) => absolute.has(p)) : []
// A run that stopped recorded part of the answers; the goldens keep the last whole set.
if (RECORD && !stopped && !unrecorded.length && !refusals.length) {
	await writeGoldens()
	console.log(`[gate] recorded ${[...recorded.keys()].join(", ")}${RECORDS_REMOTE ? " — the REMOTE's own answers (GATE_REBASELINE=1)" : ""}`)
} else if (RECORD)
	console.log(
		`[gate] nothing recorded: ${
			stopped
				? "the run stopped"
				: unrecorded.length
					? `the remote gave no whole answer for ${unrecorded.join(", ")}`
					: `the remote failed on its own terms (${refusals.length}, listed below: ${refusals.map((p) => p.split("\n")[0]!.slice(0, 120)).join(" | ")}) — a failure is never recorded as the reference`
		}; the goldens keep the last whole set`
	)

const took = `${Math.round((Date.now() - started) / 1000)}s`
if (problems.length) {
	const said = stopped ? `the run stopped; ${problems.length} problem(s)` : `${problems.length} difference(s)`
	console.error(`\nC7 gate: ${said} (${took})\n\n${problems.join("\n")}`)
	process.exit(1)
}
const widgetsPassed = WIDGET_SPECS.filter((spec) => SPECS.has(spec.name)).map((spec) => spec.name)
const passed = [
	...(SPECS.has("conversation") ? [`the remote conversation matches ${AGAINST === "golden" ? "the recording" : "the native one"} under every pack`] : []),
	...(widgetsPassed.length ? [`${widgetsPassed.join(", ")} — each mounted as a core remote, drew its fixture, matched its golden and ran its flows`] : []),
	...(SPECS.has(FRAMES)
		? ["frames — a plugin's document mounted sandboxed at the panel, session-view and page points, fed only what it may read, its unprompted press refused and a person's let through, and gone once switched off"]
		: []),
	...(SPECS.has(AUTHORING) ? ["authoring — a clone of core's Stats edited, previewed, saved, seated under its own owner, reloaded live, broken (kept as a draft) and reverted, shared, refused to a non-admin and deleted"] : [])
]
console.log(`\nC7 gate: ${passed.join("; ")} (${took}).`)
