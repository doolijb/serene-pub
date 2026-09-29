/**
 * A mount that draws a widget hands it the session's venues and the host's
 * action dispatch.
 *
 * The dispatch is ONE prop and not two: a host that threads its core handlers
 * down but keeps its fire to itself hands the mount a lesser fire, and the
 * same action then behaves one way pressed inside a widget and another way
 * pressed on the chip beside it.
 *
 * `WidgetData.actions` is a BASE section — always present, so a widget need
 * not declare a scope to offer a control — and `invoke(key)` is the verb that
 * presses one. Both are real only if every host between the page and the
 * widget passes the two props down: `WidgetHost` built its `ProjectInput`
 * without an `actions` key at all, so `ctx.actions.v1` was `{}` for every
 * native widget in the app and `invoke` refused every key by name while the
 * page held the venues the whole time.
 *
 * Nothing else in this repo can see that. The props are optional by necessity
 * — a widget mounts outside a session too, and an absent venue table is the
 * honest answer there — so a forgotten one is not a type error; the projection
 * tests (`shared/widgets/context.test.ts`) prove what a populated section
 * does, never that a mount populated it; and the suite has no DOM, so no
 * render can read a context off a real host (a browser environment is not
 * worth one assertion).
 *
 * So it is read off the source, like `socketEgress.test.ts` reads its emits.
 * A new mount added to one of these files fails here until it is threaded —
 * which is the only moment anyone is looking at the right lines.
 */

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const ROOT = resolve(__dirname, "../../../..")

/**
 * Every file that draws a session widget, or hands the pair to one that does.
 * A frame on a surface that is NOT a widget — an extension's own page, at
 * `routes/x/[...rest]` — is deliberately absent: it has no session behind it
 * and no venues to be given.
 */
/** The session page: the one place a press becomes a socket call. */
const PAGE = "src/routes/sessions/[id]/+page.svelte"

const HOSTS = [
	PAGE,
	"src/lib/client/sessionLayout/SessionLayout.svelte",
	"src/lib/client/components/surfaces/Panel.svelte",
	"src/lib/client/components/surfaces/SurfaceGrid.svelte"
]

/** The components that either ARE a widget mount or carry the pair to one. */
const MOUNTS = [
	"WidgetHost",
	"PluginFrame",
	"Panel",
	"SessionLayout",
	"SurfaceGrid"
]

/**
 * The attributes of one element, from `<Tag` to its unnested `>`.
 *
 * Brace-counted rather than matched to the first `>`, because an attribute's
 * value is an expression and expressions contain `=>` and `>` freely.
 */
function attributesOf(src: string, from: number): string {
	let depth = 0
	for (let i = from; i < src.length; i++) {
		const c = src[i]
		if (c === "{") depth++
		else if (c === "}") depth--
		else if (c === ">" && depth === 0) return src.slice(from, i)
	}
	return src.slice(from)
}

/** Every mount in one file, as `{ tag, attributes }`, in source order. */
function mountsIn(source: string): { tag: string; attrs: string }[] {
	const found: { tag: string; attrs: string }[] = []
	for (const tag of MOUNTS) {
		const open = new RegExp(`<${tag}(?=[\\s/>])`, "g")
		for (const m of source.matchAll(open))
			found.push({ tag, attrs: attributesOf(source, m.index + tag.length + 1) })
	}
	return found
}

/** The first object literal at or after `from`, brace-matched through its close. */
function objectAt(src: string, from: number): string {
	const start = src.indexOf("{", from)
	if (start < 0) return ""
	let depth = 0
	for (let i = start; i < src.length; i++) {
		if (src[i] === "{") depth++
		else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1)
	}
	return src.slice(start)
}

/** 1-based line number of an offset, so a failure names the site. */
function lineOf(src: string, at: number): number {
	return src.slice(0, at).split("\n").length
}

/** `{actions}`, `actions={…}` — either spelling, and neither by accident. */
function passes(attrs: string, prop: string): boolean {
	return (
		new RegExp(`\\{\\s*${prop}\\s*\\}`).test(attrs) ||
		new RegExp(`(^|\\s)${prop}=`).test(attrs)
	)
}

describe("every widget mount is handed the session's actions", () => {
	for (const file of HOSTS) {
		const source = readFileSync(join(ROOT, file), "utf8")
		const mounts = mountsIn(source)

		test(`${file} mounts something`, () => {
			// A file that stopped mounting anything has been restructured, and
			// the list above is describing a shape that no longer exists.
			expect(mounts.length).toBeGreaterThan(0)
		})

		for (const prop of ["actions", "actionDispatch"]) {
			test(`${file} passes ${prop} to every mount`, () => {
				const missing = mounts
					.filter((m) => !passes(m.attrs, prop))
					.map((m) => m.tag)
				expect(missing).toEqual([])
			})
		}
	}

	test("the fire keeps all five arguments the whole way down", () => {
		// `action` (the pressed declaration's identity) and `blockId` (the form
		// a press answers) are the fourth and fifth. A host that declares three
		// drops both on its hop, and the server reads every press through it as
		// legacy — the owner floor — which refuses a guest answering a question
		// put to their own character.
		for (const file of HOSTS) {
			const source = readFileSync(join(ROOT, file), "utf8")
			for (const m of source.matchAll(
				/on(?:Frame)?Action\??: \(\s*fn: string,([\s\S]*?)\) => void/g
			)) {
				expect(m[1], `${file}: a fire that drops the identity`).toContain(
					"action?: string"
				)
				expect(m[1], `${file}: a fire that drops the block`).toContain(
					"blockId?: string"
				)
			}
		}
	})

	test("the session page emits the fire in ONE place, and names the run there", () => {
		// Every press is cancellable, whichever button it was: Cancel needs the
		// run's id during the window between the press and the first progress
		// event, and a second emit site is how one route comes to have it and
		// the route beside it does not — a form's button answering on the row,
		// a chip, a widget's `invoke`, all the same press to the server.
		//
		// Read off the source because the page has no DOM here: one
		// `socket.emit("sessions:fireAction", …)`, and `runId` inside the
		// object literal it sends.
		const source = readFileSync(join(ROOT, PAGE), "utf8")
		const sites = [
			...source.matchAll(/socket\.emit\("sessions:fireAction"/g)
		]
		expect(
			sites.map((s) => lineOf(source, s.index)),
			`${PAGE}: a second fire emits beside the first`
		).toHaveLength(1)
		expect(
			objectAt(source, sites[0]!.index),
			"the fire emits a run nobody can cancel"
		).toContain("runId")
	})
})
