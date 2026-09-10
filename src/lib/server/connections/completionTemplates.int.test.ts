/**
 * Loading a `completion_templates` row into the shape the renderer takes.
 *
 * The pure resolver in `$lib/shared/constants/completionTemplates` answers a
 * bare key **against the built-ins** — correct for the eight shipped formats and
 * silently the default for every other row in the table. This module is the
 * loader that closes that gap, and what it has to get right is what happens to a
 * row that is not shaped like a built-in: written by an older build, half
 * filled, or holding JSON of a shape nothing in TypeScript ever checked.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	completionTemplatesByKey,
	resolveCompletionTemplate,
	rowToTemplate,
	withCompletionTemplate
} from "./completionTemplates"
import {
	BLOCK_ROLES,
	completionTemplateOf,
	DEFAULT_COMPLETION_TEMPLATE,
	framingFor
} from "$lib/shared/constants/completionTemplates"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

const row = (over: Record<string, any> = {}) =>
	({
		id: 1,
		seedKey: null,
		key: "house-style",
		name: "House Style",
		isImmutable: false,
		renderMode: "flat",
		roles: { system: { prefix: "S>", suffix: "<S" } },
		fallbackRole: { prefix: "F>", suffix: "<F" },
		stopStrings: ["<<end>>"],
		isSelectable: true,
		...over
	}) as any

describe("rowToTemplate", () => {
	it("fills every role, so no block is ever wrapped in `undefined`", () => {
		const t = rowToTemplate(row())
		for (const r of BLOCK_ROLES) expect(t.roles[r], r).toBeTruthy()
		// A role the row does not carry falls back to the ROW's own fallback,
		// never to a built-in — a half-filled custom template must not silently
		// borrow Vicuna's markers for the roles it is missing.
		expect(t.roles.user).toEqual({ prefix: "F>", suffix: "<F" })
		expect(t.roles.system).toEqual({ prefix: "S>", suffix: "<S" })
		// And the formatter agrees, which is the only reason any of this matters.
		expect(
			PromptBlockFormatter.makeBlock({
				format: t,
				role: "tool",
				content: "x"
			})
		).toBe("F>x<F")
	})

	it("narrows an unrecognised render mode to flat", () => {
		// Never the other way. Treating an unknown mode as role_array would hand
		// a text-completion adapter `rendered: undefined`, which reaches a user
		// as an empty generation.
		expect(rowToTemplate(row({ renderMode: "wat" })).renderMode).toBe(
			"flat"
		)
		expect(rowToTemplate(row({ renderMode: null })).renderMode).toBe("flat")
		expect(
			rowToTemplate(row({ renderMode: "role_array" })).renderMode
		).toBe("role_array")
	})

	it("survives JSON columns of the wrong shape", () => {
		// `json`, not `jsonb` with per-key types: what comes back is whatever was
		// written, including by a build that had one fewer field.
		const t = rowToTemplate(
			row({
				roles: { system: { prefix: 42 }, user: "nope" },
				fallbackRole: null,
				stopStrings: ["ok", 7, null]
			})
		)
		expect(t.roles.system).toEqual({ prefix: "", suffix: "" })
		expect(t.roles.user).toEqual({ prefix: "", suffix: "" })
		expect(t.fallbackRole).toEqual({ prefix: "", suffix: "" })
		expect(t.stopStrings).toEqual(["ok"])
	})
})

describe("reading the table", () => {
	it("projects every seeded built-in back to the constant it came from", async () => {
		/**
		 * The two seed sources have to agree, and this is the third place that
		 * can tell: the MIGRATION writes the rows, `db/defaults.ts` rewrites them
		 * from the constant on every boot, and this reads them back through the
		 * loader the renderer uses. A disagreement anywhere shows up as a prompt
		 * wrapped in one format's markers and stopped on another's.
		 */
		const byKey = await completionTemplatesByKey(db)
		expect(byKey.size).toBeGreaterThanOrEqual(8)
		const vicuna = byKey.get("vicuna")!
		for (const r of BLOCK_ROLES)
			expect(vicuna.roles[r], r).toEqual(
				framingFor(DEFAULT_COMPLETION_TEMPLATE, r)
			)
	}, 60_000)

	it("resolves a row an admin wrote, which a bare key cannot", async () => {
		await db.insert(schema.completionTemplates).values({
			key: "loader-check",
			name: "Loader Check",
			renderMode: "flat",
			roles: { system: { prefix: "[[S]]", suffix: "[[/S]]" } },
			fallbackRole: { prefix: "[[U]]", suffix: "[[/U]]" },
			stopStrings: [],
			isSelectable: true
		})
		const t = await resolveCompletionTemplate(db, "loader-check")
		expect(t.key).toBe("loader-check")
		expect(t.roles.system.prefix).toBe("[[S]]")
	}, 60_000)

	it("answers all three absent states with the default", async () => {
		// Never set, cleared, and a key whose row is gone — the same question,
		// so the same answer, which is the thing six hand-written copies of this
		// operator used to disagree about.
		for (const absent of [null, undefined, "", "no-such-template"])
			expect(
				(await resolveCompletionTemplate(db, absent)).key,
				String(absent)
			).toBe(DEFAULT_COMPLETION_TEMPLATE.key)
	}, 60_000)
})

/**
 * The template has to arrive ON the connection, because the adapters cannot go
 * and get it.
 *
 * `prompt_format` is a KEY, and `completionTemplateOf` resolves a bare key
 * against the built-ins — so an adapter holding only the row can see eight
 * templates and no others. Fetching the ninth needs the table, the table needs
 * `db`, and an adapter has neither (`adapters/importBoundary.test.ts`) nor may
 * `promptTextFor` become async to get one. So the dereference happens where the
 * connection is loaded and rides along.
 *
 * Two places in the app load a connection bound for a text adapter —
 * `resolveCapabilityTarget` (replies, summaries, and every step outside the
 * executor) and `resolveStepConfigs` (a graph step's own pick) — and both call
 * the one helper asserted here.
 */
describe("the template rides on the connection", () => {
	const CUSTOM_KEY = "wiring-house-style"

	beforeAll(async () => {
		await db.insert(schema.completionTemplates).values({
			key: CUSTOM_KEY,
			name: "Wiring House Style",
			renderMode: "flat",
			roles: { system: { prefix: "@@sys@@", suffix: "@@/sys@@" } },
			fallbackRole: { prefix: "@@u@@", suffix: "@@/u@@" },
			stopStrings: ["@@stop@@"],
			isSelectable: true
		})
	}, 60_000)

	it("attaches the row a bare key could never have found", async () => {
		const attached = await withCompletionTemplate(db, {
			id: 1,
			promptFormat: CUSTOM_KEY
		})
		expect(attached.completionTemplate.key).toBe(CUSTOM_KEY)
		expect(attached.completionTemplate.stopStrings).toEqual(["@@stop@@"])
		// The row travels WITH the connection; the connection is unchanged.
		expect(attached.promptFormat).toBe(CUSTOM_KEY)
		// A new object, so a caller still holding the row it passed in has a row.
		const row = { id: 1, promptFormat: CUSTOM_KEY }
		await withCompletionTemplate(db, row)
		expect(row).not.toHaveProperty("completionTemplate")
	}, 60_000)

	it("attaches the DEFAULT for all three absent states, never nothing", async () => {
		// ⚠ Not `undefined`. If this attached nothing for an absent format, the
		// fallback would live in two places — here and in the adapter — and the
		// two would be free to drift. A render/stop disagreement is exactly what
		// drift produces, and it does not error: the model just never stops.
		for (const promptFormat of [null, undefined, "", "no-such-template"]) {
			const attached = await withCompletionTemplate(db, {
				id: 1,
				promptFormat
			})
			expect(attached.completionTemplate.key, String(promptFormat)).toBe(
				DEFAULT_COMPLETION_TEMPLATE.key
			)
		}
	}, 60_000)

	it("reaches an adapter through resolveCapabilityTarget", async () => {
		// The load site itself, not the helper: this is what `dispatch.ts`,
		// `generateResponse.ts`, `dispatchStep.ts`, `scenes.ts` (the summarizer)
		// and `narrativeGraph.ts` (the graph build) all go through, and it is the
		// only reason any of them can hand an adapter a resolved template
		// without acquiring a database of their own.
		const [conn] = await db
			.insert(schema.connections)
			.values({
				name: "Wiring check",
				type: "ollama",
				baseUrl: "http://localhost:11434",
				promptFormat: CUSTOM_KEY
			})
			.returning()

		const { resolveCapabilityTarget, TEXT_CAPABILITY } = await import(
			"./capabilityTarget"
		)
		const target = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY,
			pipelineConfig: { connectionId: conn.id }
		})
		expect(target.ok, JSON.stringify((target as any).problem)).toBe(true)
		if (!target.ok) return
		expect(target.connection.id).toBe(conn.id)
		expect(target.connection.completionTemplate?.key).toBe(CUSTOM_KEY)
		expect(target.connection.completionTemplate?.stopStrings).toEqual([
			"@@stop@@"
		])
	}, 60_000)
})

/**
 * The two resolutions on the pipeline path must answer identically.
 *
 * A pipeline reply resolves the template TWICE, and it has to: the RENDER runs
 * inside the executor, from `world.ts`'s projection (`completionTemplatesByKey`
 * → `renderers.ts`), while the SEND runs in the adapter, from what
 * `resolveCapabilityTarget` attached. They are two reads of one table, and the
 * failure if they ever disagree is the exact one this whole area exists to
 * remove — a prompt wrapped in one format's markers, stopped on another's, with
 * nothing raised anywhere.
 *
 * ⚠ So this compares the two EXPRESSIONS rather than trusting that they look
 * alike. `world.ts` answers `rows.get(key)` and lets `renderers.ts` fall through
 * to `completionTemplateOf(promptFormatOf(key))`; `withCompletionTemplate`
 * answers `resolveCompletionTemplate(db, key)`. Those are different spellings,
 * and only their agreement on every input makes the pairing safe.
 */
describe("the render and the stop strings resolve to one template", () => {
	it("agrees on an authored key, a built-in key, and all three absences", async () => {
		await db.insert(schema.completionTemplates).values({
			key: "agreement-check",
			name: "Agreement Check",
			renderMode: "flat",
			roles: { system: { prefix: "<<S", suffix: "S>>" } },
			fallbackRole: { prefix: "<<U", suffix: "U>>" },
			stopStrings: ["<<end>>"],
			isSelectable: true
		})

		const byKey = await completionTemplatesByKey(db)

		for (const promptFormat of [
			"agreement-check",
			"vicuna",
			"chatml",
			"",
			null,
			undefined,
			"no-such-template"
		]) {
			// What `world.ts` puts on the connection's metadata, resolved the
			// way `renderers.ts` resolves it.
			const rendered = completionTemplateOf(
				(promptFormat ? byKey.get(promptFormat) : undefined) ??
					promptFormatOf(promptFormat)
			)
			// What the adapter stops with.
			const stopped = (await withCompletionTemplate(db, { promptFormat }))
				.completionTemplate

			expect(stopped, String(promptFormat)).toEqual(rendered)
		}
	}, 60_000)
})
