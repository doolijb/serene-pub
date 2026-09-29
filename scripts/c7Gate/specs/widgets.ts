/**
 * The side widgets' half of the gate (PLAN-r21-core-widgets §4): what every
 * side-widget spec shares, and the list of them.
 *
 * Each spec names one of core's side widgets on the Adventure fixture
 * (`adventure.ts`) and is run the same way (`runWidgetSpec`):
 *   1. it MOUNTS AS A CORE REMOTE — exactly one copy on the page, inside a
 *      core remote box (`[data-sp-owner="core"]`) named for it, with no host
 *      overlay over it: no native copy exists to be drawn instead;
 *   2. it DRAWS THE FIXTURE — the spec's own records check, outright
 *      (`failAbsolute`), whatever the golden says;
 *   3. it MATCHES ITS GOLDEN (`goldens/widget-<name>.json`) — the subtree's
 *      structure, attributes, text, computed styles, axe and Tab order, read
 *      as the conversation's are (`readShape`), under the widget's one skin
 *      (its default: each side widget ships one preset); and so do its
 *      EXHIBITS, the states the snapshot never shows (a menu open, a control
 *      under the pointer), each recorded beside the snapshot;
 *   4. its FLOWS WORK end to end against the real server, each a sentence
 *      judged against the golden's; a flow that changes a value also watches
 *      it arrive on a SECOND SOCKET (another page on the session) and says
 *      how long the push took (`[push]`), bounded by PUSH_BOUND_MS.
 * What a flow changes it puts back (`reset`), so the next spec meets the
 * fixture as it was built.
 *
 * Recording: `GATE_RECORD=1 GATE_REBASELINE=1` records these goldens as it
 * does the conversation's (the remote is the only copy there is), and never
 * over a spec that failed on its own terms.
 */
import type { Page } from "playwright"
import {
	GOLDEN_FORMAT,
	RECORDS_REMOTE,
	REMOTE_BOX,
	compare,
	failAbsolute,
	firstLine,
	noteHostOverlay,
	problems,
	readAxe,
	readGolden,
	readShape,
	readTabs,
	record,
	steady,
	unrecorded,
	type Snapshot
} from "../engine"
import { adventureFixture } from "./adventure"
import { inBox, openOn, type WidgetCtx, type WidgetSpec } from "./kit"
import { worldStateSpec } from "./worldState"
import { statsSpec } from "./stats"
import { loreEntriesSpec } from "./loreEntries"
import { scenePortraitsSpec } from "./scenePortraits"

export type { WidgetSpec } from "./kit"
export const WIDGET_SPECS: WidgetSpec[] = [worldStateSpec, statsSpec, loreEntriesSpec, scenePortraitsSpec]

type WidgetGolden = { format: number; snapshot: Snapshot; flows: string[]; exhibits?: Record<string, Snapshot> }

/* ── normalising a snapshot ───────────────────────────────────────────── */

/**
 * What differs between runs and says nothing about the widget: a database
 * number in an attribute that names a row (`data-entry-id`, a scene member's
 * `character:<id>`, an id), numbered in order of appearance per attribute;
 * a radio group's name (the host's per-box prefix, the widget's per-mount
 * suffix); a relative time ("just now", "5m ago").
 * Media uuids are already `<uuid>` (`readShape`). Applied before a snapshot
 * is recorded, so a golden holds no run's own numbers.
 */
/** A radio group's name: the host's per-box prefix (`sp-r1-<box>-`) and the widget's per-mount suffix are each the run's own. */
const radioGroup = (v: string) => v.replace(/^sp-r\d+-[0-9a-z]+-/, "sp-r#-<box>-").replace(/^(.*sp-lore-filter-)[0-9a-z]+$/, "$1<random>")
const NUMBERED = ["id", "href", "ref", "data-entry-id", "data-scene-member", "for", "aria-labelledby", "aria-describedby", "aria-controls"]
export function normalise(s: Snapshot): Snapshot {
	const numbers = new Map<string, Map<string, string>>()
	const ordinal = (name: string, v: string) =>
		v
			.split(" ")
			.map((token) => {
				if (/^@[\d/]+$/.test(token)) return token
				const seen = numbers.get(name) ?? numbers.set(name, new Map()).get(name)!
				// `#<n>` is an ordinal already: a golden read back is normalised again, and stays as it was.
				return token.replace(/(?<![#\d])\d+/g, (d) => seen.get(d) ?? seen.set(d, `#${seen.size + 1}`).get(d)!)
			})
			.join(" ")
	const text = (v: string) => v.replace(/\bjust now\b|\b\d+[mhd] ago\b/g, "<ago>")
	return {
		...s,
		attrs: s.attrs.map(({ path, attrs }) => ({
			path,
			attrs: Object.fromEntries(
				Object.entries(attrs).map(([k, v]) => [
					k,
					k === "name" ? radioGroup(v) : NUMBERED.includes(k) ? ordinal(k, text(v)) : text(v)
				])
			)
		})),
		tabs: s.tabs.map(text)
	}
}

/* ── running one spec ─────────────────────────────────────────────────── */

/** Mounts as a core remote: one copy, in a core box named for it, no host overlay. */
async function mountedAsRemote(page: Page, spec: WidgetSpec): Promise<string[]> {
	return page.evaluate(
		({ root, box, title }) => {
			const wrong: string[] = []
			const copies = [...document.querySelectorAll(root)]
			if (copies.length !== 1) wrong.push(`${copies.length} copies of ${root} are on the page, not one`)
			for (const c of copies) {
				const b = c.closest(box)
				if (!b) {
					wrong.push(`a copy of ${root} is drawn outside every core remote box — a native copy`)
					continue
				}
				if (!b.classList.contains("sp-remote-box")) wrong.push(`the box around ${root} is not a remote box (class "${b.className}")`)
				if (b.getAttribute("aria-label") !== title) wrong.push(`the remote box around ${root} is named "${b.getAttribute("aria-label")}", not "${title}"`)
				const alert = b.parentElement?.querySelector(":scope > [role=alert]")
				if (alert) wrong.push(`the host's overlay covers it: "${(alert.textContent ?? "").replace(/\s+/g, " ").trim()}"`)
			}
			return wrong
		},
		{ root: spec.root, box: REMOTE_BOX, title: spec.title }
	)
}

export async function runWidgetSpec(page: Page, second: Page, spec: WidgetSpec) {
	const tag = `[${spec.name}]`
	const f = await steady(page, `${tag} fixture`, () => adventureFixture(page))
	const timings: string[] = []
	const ctx: WidgetCtx = { page, second, f, sel: inBox(spec.root), pushed: (what, ms) => void timings.push(`${what} ${ms}ms`) }
	// Whatever an earlier spec's failure left behind, this one meets the fixture as built.
	await steady(page, `${tag} reset`, () => spec.reset(ctx))

	let golden: WidgetGolden | null = null
	try {
		golden = await readGolden<WidgetGolden>(`widget-${spec.name}`)
	} catch (e) {
		if (RECORDS_REMOTE) console.log(`[rebaseline] ${firstLine(e)}: nothing to judge against, recorded afresh`)
		else problems.push(`${tag} no golden to judge against (${firstLine(e)}) — record one: GATE_RECORD=1 GATE_REBASELINE=1 GATE_SPECS=${spec.name}`)
	}

	// 1–3: mounted, drawn, and as recorded.
	let snap: Snapshot | null = null
	try {
		snap = await steady(page, `${tag} snapshot`, async () => {
			await openOn(ctx, spec)
			await page.waitForTimeout(1500)
			for (const w of await mountedAsRemote(page, spec)) failAbsolute(`${tag} ${w}`)
			const shape = await readShape(page, ctx.sel)
			for (const w of await spec.records(ctx)) failAbsolute(`${tag} ${w}`)
			const { axe, axeUndecided } = await readAxe(page, ctx.sel)
			const tabs = await readTabs(page, ctx.sel)
			await noteHostOverlay(page, ctx.sel, `${tag} snapshot`)
			return normalise({ format: GOLDEN_FORMAT, ...shape, axe, axeUndecided, tabs })
		})
	} catch (e) {
		failAbsolute(`${tag} the widget could not be read: ${firstLine(e)}`)
	}
	// The golden read through today's normalisation too (it is idempotent), so a rule added since it was recorded applies to both sides.
	if (snap && golden) compare(spec.name, normalise(golden.snapshot), snap, false, ["golden", "now"])
	if (snap)
		console.log(
			`${tag} ${snap.tree.length} elements (golden ${golden?.snapshot.tree.length ?? "∅"}); axe ${snap.axe.join(",") || "clean"}; ` +
				`undecided ${snap.axeUndecided.map((u) => `${u.rule}×${u.nodes}`).join(",") || "none"}; Tab stops ${snap.tabs.length}`
		)

	// 3b: its exhibits, the states the snapshot does not show, each judged as the snapshot is.
	const exhibits: Record<string, Snapshot> = {}
	for (const exhibit of spec.exhibits ?? []) {
		const xtag = `${tag} exhibit "${exhibit.name}"`
		try {
			await steady(page, `${xtag} reset`, () => spec.reset(ctx))
			exhibits[exhibit.name] = await steady(page, xtag, async () => {
				await openOn(ctx, spec)
				await page.waitForTimeout(1500)
				await exhibit.show(ctx)
				const shape = await readShape(page, ctx.sel)
				const { axe, axeUndecided } = await readAxe(page, ctx.sel)
				const tabs = await readTabs(page, ctx.sel)
				await noteHostOverlay(page, ctx.sel, xtag)
				return normalise({ format: GOLDEN_FORMAT, ...shape, axe, axeUndecided, tabs })
			})
		} catch (e) {
			failAbsolute(`${xtag} could not be read: ${firstLine(e)}`)
			continue
		}
		const was = golden?.exhibits?.[exhibit.name]
		if (was) compare(`${spec.name} ${exhibit.name}`, normalise(was), exhibits[exhibit.name]!, false, ["golden", "now"])
		else if (golden && !RECORDS_REMOTE)
			problems.push(`${xtag} has no golden to judge against — record one: GATE_RECORD=1 GATE_REBASELINE=1 GATE_SPECS=${spec.name}`)
		console.log(`${xtag} ${exhibits[exhibit.name]!.tree.length} elements (golden ${was?.tree.length ?? "∅"}); axe ${exhibits[exhibit.name]!.axe.join(",") || "clean"}`)
	}
	if (spec.exhibits?.length) await steady(page, `${tag} reset`, () => spec.reset(ctx))

	// 4: the flows, each from a fresh load of both pages.
	const lines: string[] = []
	try {
		await steady(page, `${tag} flows`, async () => {
			lines.length = 0
			timings.length = 0
			await openOn(ctx, spec, second)
			await openOn(ctx, spec)
			for (const flow of spec.flows) {
				try {
					lines.push(`${flow.name}: ${await flow.run(ctx)}`)
				} catch (e) {
					lines.push(`${flow.name}: FAILED — ${firstLine(e)}`)
					await noteHostOverlay(page, ctx.sel, `${tag} ${flow.name}`)
					await openOn(ctx, spec, second).catch(() => {})
					await openOn(ctx, spec)
				}
			}
			await noteHostOverlay(page, ctx.sel, `${tag} flows`)
		})
	} catch (e) {
		failAbsolute(`${tag} the flows could not run: ${firstLine(e)}`)
	} finally {
		await steady(page, `${tag} reset`, () => spec.reset(ctx)).catch((e) => problems.push(`${tag} could not put the fixture back: ${firstLine(e)}`))
	}
	const judged = golden?.flows ?? lines
	for (let i = 0; i < Math.max(judged.length, lines.length); i++) {
		const was = judged[i] ?? "∅"
		const now = lines[i] ?? "∅"
		console.log(`${tag} [flow] ${now}${was === now ? "" : `  ≠  golden: ${was}`}`)
		if (now.includes("FAILED")) failAbsolute(`${tag} [flow] ${now}`)
		else if (golden && was !== now) problems.push(`${tag} [flow] differs: golden "${was}" / now "${now}"`)
	}
	if (timings.length) console.log(`${tag} [push] to a second socket: ${timings.join("; ")}`)

	if (RECORDS_REMOTE)
		if (snap && lines.length === spec.flows.length && Object.keys(exhibits).length === (spec.exhibits?.length ?? 0))
			record(`widget-${spec.name}`, { format: GOLDEN_FORMAT, snapshot: snap, flows: lines, ...(spec.exhibits?.length ? { exhibits } : {}) })
		else unrecorded.push(`widget-${spec.name}`)
}
