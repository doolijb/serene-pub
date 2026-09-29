/**
 * Typed templates P6 (2026-09-27): the annex and `state` at RUN time match
 * what the typed scope says a template may reference.
 *
 * - `annex.<owner>.<key>` — every DECLARED key of every owner in scope (core,
 *   the enabled plugins, for the session's genre), from
 *   `core:query/session-annex@1` with `view: 'template'` on Assemble's
 *   `annex` port. An undeclared legacy key, a switched-off plugin's keys and
 *   an owner nobody declares never arrive (owner ruling Q1).
 * - `state` — projected to its type: tracked slots only, members and places
 *   by slug, no id indexes, no vocabulary, roles or version.
 * - Nothing a template may never reach (`FORBIDDEN_TEMPLATE_NAMES`) is in the
 *   run-time context, whatever a stored annex holds.
 *
 * A dotted owner is a Handlebars segment literal:
 * `{{annex.[showcase.twenty-questions].secret.secretEntryName}}`; in Liquid,
 * `{{ annex["showcase.twenty-questions"].secret.secretEntryName }}`.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { annexField, FORBIDDEN_TEMPLATE_NAMES } from "@serene-pub/sdk"
import {
	allocate,
	render,
	templateAnnexValue
} from "$lib/server/pipelines/prompt/assemble"
import {
	buildTemplateContext,
	templateState
} from "$lib/server/pipelines/prompt/templateContext"
import {
	registerRenderer,
	_resetRenderers,
	CORE_TEMPLATE_ENGINE,
	CORE_LIQUID_ENGINE
} from "$lib/server/pipelines/prompt/renderers"
import {
	templateAnnexFrom,
	type AnnexDeclaration
} from "$lib/server/sessions/annexFields"

const TQ = "showcase.twenty-questions"
const TQ_GENRE = `${TQ}:genre/game`

/** Twenty Questions' own declaration, as its manifest stores it. */
const tqSecret = annexField({
	key: "secret",
	shape: {
		type: "object",
		fields: {
			secretEntryId: { type: "integer", min: 0 },
			secretEntryName: { type: "string" },
			secretEntryText: { type: "string" },
			secretEntryAliases: { type: "list", item: { type: "string" } }
		}
	},
	see: ["ai"],
	genre: TQ_GENRE
})
const diceNote = annexField({
	key: "last-roll",
	shape: { type: "integer" },
	see: []
})

const declarations: AnnexDeclaration[] = [
	{ owner: "core", enabled: true, fields: [] },
	{ owner: TQ, enabled: true, fields: [tqSecret] },
	{ owner: "acme.dice", enabled: false, fields: [diceNote] }
]

const SECRET = {
	secretEntryId: 7,
	secretEntryName: "The Brass Lantern",
	secretEntryText: "A lantern that never goes out.",
	secretEntryAliases: ["lantern"]
}

/** What `sessions.annex` holds: declared keys, a legacy key, and owners out of scope. */
const stored: Record<string, unknown> = {
	[TQ]: { secret: SECRET, legacyNote: "written before the ruling" },
	"acme.dice": { "last-roll": 4 },
	"user:my-spec": { anything: "at all" }
}

const base = {
	allocation: allocate([], { budgetTotal: 100 }),
	engine: CORE_TEMPLATE_ENGINE,
	messages: [{ id: 1, role: "user", content: "is it alive?" }]
}

/** Renders through a capturing engine, returning the run-time context itself. */
async function contextOf(input: Partial<Parameters<typeof render>[0]>) {
	let seen: Record<string, unknown> = {}
	registerRenderer("p6.capture:v1@1", "p6.capture", (ctx) => {
		seen = ctx.variables as Record<string, unknown>
		return ""
	})
	await render({ ...base, template: "x", ...input, engine: "p6.capture:v1@1" })
	return seen
}

/** Every key anywhere in a value — what a template could address. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(value)) for (const v of value) keysOf(v, out)
	else if (value && typeof value === "object")
		for (const [k, v] of Object.entries(value)) {
			out.add(k)
			keysOf(v, out)
		}
	return out
}

describe("P6 · the template view of the annex", () => {
	it("keeps every declared key of an owner in scope", () => {
		const annex = templateAnnexFrom(stored, declarations, TQ_GENRE)
		expect(annex[TQ]?.secret).toEqual(SECRET)
	})

	it("never carries an undeclared legacy key", () => {
		const annex = templateAnnexFrom(stored, declarations, TQ_GENRE)
		expect(annex[TQ]).not.toHaveProperty("legacyNote")
	})

	it("never carries an owner out of scope: a switched-off plugin, an owner nobody declares", () => {
		const annex = templateAnnexFrom(stored, declarations, TQ_GENRE)
		expect(Object.keys(annex)).toEqual([TQ])
	})

	it("a key declared for another genre is not in force here", () => {
		expect(templateAnnexFrom(stored, declarations, "core:genre/chat")).toEqual({})
	})
})

describe("P6 · annex in a rendered template", () => {
	beforeEach(() => _resetRenderers())
	const annex = templateAnnexFrom(stored, declarations, TQ_GENRE)

	it("renders the Twenty Questions secret through the dotted-owner segment literal", async () => {
		const r = await render({
			...base,
			annex,
			template: `Thinking of: {{annex.[${TQ}].secret.secretEntryName}}`
		})
		expect(r.rendered).toBe("Thinking of: The Brass Lantern")
	})

	it("renders it in Liquid with a bracketed key", async () => {
		const r = await render({
			...base,
			engine: CORE_LIQUID_ENGINE,
			annex,
			template: `Thinking of: {{ annex["${TQ}"].secret.secretEntryName }}`
		})
		expect(r.rendered).toBe("Thinking of: The Brass Lantern")
	})

	it("an undeclared legacy key and an out-of-scope owner render as nothing", async () => {
		const r = await render({
			...base,
			annex,
			template: `[{{annex.[${TQ}].legacyNote}}][{{annex.[acme.dice].last-roll}}]`
		})
		expect(r.rendered).toBe("[][]")
	})

	it("with the port unwired there is no annex at all", async () => {
		const seen = await contextOf({})
		expect(seen).not.toHaveProperty("annex")
		const r = await render({ ...base, template: "{{#if annex}}yes{{else}}no{{/if}}" })
		expect(r.rendered).toBe("no")
	})

	it("refuses a builder key or prompts field that also claims `annex`", () => {
		expect(() => templateAnnexValue(annex, undefined, { annex: {} })).toThrow(
			/'annex' also arrives from the template context its builder supplied/
		)
		expect(() => templateAnnexValue(annex, { annex: "x" }, undefined)).toThrow(
			/a field of this node's prompts slot/
		)
	})
})

// ── state ───────────────────────────────────────────────────────────────────

/** What `core:query/session-state@1` publishes (`stateFor`), abridged. */
const verity = {
	id: 12,
	key: "verity",
	name: "Verity",
	hp: 14,
	adventure_hp: 14,
	mood: "wary",
	stray: "not a tracked slot"
}
const crypt = { id: 40, key: "the_crypt", name: "The Crypt", loot: "Rusty key" }
const resolved = {
	world: { weather: "storm", adventure_weather: "storm", untracked: "left over" },
	cast: { byId: { "12": verity }, verity },
	locations: { byId: { "40": crypt }, the_crypt: crypt },
	slots: [
		{ id: "adventure:slot/weather@1", key: "weather", type: "text", appliesTo: ["world"] },
		{ id: "adventure:slot/hp@1", key: "hp", type: "integer", appliesTo: ["cast"] },
		{ id: "adventure:slot/mood@1", key: "mood", type: "text", appliesTo: ["cast"] },
		{ id: "adventure:slot/loot@1", key: "loot", type: "text", appliesTo: ["location"] }
	],
	who: { speaker: verity, active: [verity] },
	version: 3
}

describe("P6 · state as its type", () => {
	it("keeps tracked slots, members and places by slug — nothing else", () => {
		expect(templateState(resolved)).toEqual({
			world: { weather: "storm", adventure_weather: "storm" },
			cast: {
				verity: {
					id: 12,
					key: "verity",
					name: "Verity",
					hp: 14,
					adventure_hp: 14,
					mood: "wary"
				}
			},
			locations: {
				the_crypt: { id: 40, key: "the_crypt", name: "The Crypt", loot: "Rusty key" }
			}
		})
	})

	it("the builder puts the projection on the context, and it renders typed", async () => {
		const built = await buildTemplateContext({
			characters: [{ name: "Verity" }],
			personas: [{ name: "Bob" }],
			characterNames: ["Verity"],
			personaNames: ["Bob"],
			charName: "Verity",
			personaName: "Bob",
			state: resolved
		})
		expect(built.state).toEqual(templateState(resolved))
		const r = await render({
			...base,
			templateContext: built as unknown as Record<string, unknown>,
			template:
				"{{state.world.weather}}|{{state.cast.verity.hp}}|{{state.locations.the_crypt.loot}}|" +
				"{{#if (eq state.cast.verity.hp 14)}}hurt{{/if}}|[{{state.cast.verity.stray}}][{{state.version}}]"
		})
		expect(r.rendered).toBe("storm|14|Rusty key|hurt|[][]")
	})

	it("no state wired → no state on the context", async () => {
		const built = await buildTemplateContext({
			characters: [],
			personas: [],
			characterNames: [],
			personaNames: [],
			charName: "A",
			personaName: "B"
		})
		expect(built).not.toHaveProperty("state")
	})
})

// ── nothing forbidden at run time ───────────────────────────────────────────

describe("P6 · the run-time context carries no forbidden kind", () => {
	beforeEach(() => _resetRenderers())

	it("serialised, with annex and state wired, no key is a forbidden name", async () => {
		const built = await buildTemplateContext({
			characters: [{ name: "Verity", description: "A knight." }],
			personas: [{ name: "Bob" }],
			characterNames: ["Verity"],
			personaNames: ["Bob"],
			charName: "Verity",
			personaName: "Bob",
			state: resolved
		})
		// An older stored declaration could name one; the run-time half of the
		// rule drops it at any depth.
		const annex = {
			...templateAnnexFrom(stored, declarations, TQ_GENRE),
			"acme.leaky": { model: "gpt-x", notes: { connection: 3, apiKey: "k", fine: 1 } }
		}
		const seen = await contextOf({
			templateContext: built as unknown as Record<string, unknown>,
			annex,
			prompts: { system: "Be brief." }
		})
		const serialised = JSON.parse(JSON.stringify(seen))
		const forbidden = new Set(FORBIDDEN_TEMPLATE_NAMES.map((n) => n.toLowerCase()))
		const hits = [...keysOf(serialised)].filter((k) => forbidden.has(k.toLowerCase()))
		expect(hits).toEqual([])
		// …and what is allowed is still there.
		expect(serialised.annex[TQ].secret.secretEntryName).toBe("The Brass Lantern")
		expect(serialised.annex["acme.leaky"].notes).toEqual({ fine: 1 })
		expect(serialised.state.cast.verity.hp).toBe(14)
	})
})
