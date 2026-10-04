/**
 * Assemble: allocation and rendering.
 *
 * The assertion that matters most is the one about excluded allocations
 * surviving into the allocated context. A user asking "why isn't my lore showing up" is asking
 * about something *absent*, so an allocation that lists only what made it
 * cannot answer them — which is the state of the world today.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
	allocate,
	objectByRole,
	render,
	referencedVariables,
	type Allocation
} from "$lib/server/pipelines/prompt/assemble"
import { formatHistoryDateKey } from "$lib/server/pipelines/prompt/dateKeys"
import { entryDeclaration } from "$lib/server/entries/declarations"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { wrapFor } from "$lib/server/pipelines/entities/variableLayouts"
import type { Decision } from "$lib/server/pipelines/ranking/select"
import {
	registerRenderer,
	_resetRenderers,
	TemplateEngineError,
	CORE_TEMPLATE_ENGINE,
	CORE_LIQUID_ENGINE
} from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"

const decision = (over: Partial<Decision> = {}): Decision => ({
	candidate: {
		id: 1,
		source: "worldLore",
		tokens: 10,
		signals: {},
		payload: {
			name: "The Ashguard",
			content: "An order of oathbound riders."
		}
	},
	score: 0.6,
	reason: "filled_scored",
	included: true,
	why: "scored 0.600, 10 tokens",
	...over
})

describe("allocation", () => {
	it("sums only what was included", async () => {
		const a = allocate(
			[
				decision(),
				decision({ included: false, reason: "excluded_token_limit" })
			],
			{ budgetTotal: 100 }
		)
		expect(a.totalTokens).toBe(10)
		expect(a.budget.remaining).toBe(90)
	})

	it("keeps excluded allocations, because that is the question people ask", async () => {
		const a = allocate(
			[
				decision({
					included: false,
					reason: "excluded_budget",
					why: "cap reached"
				})
			],
			{ budgetTotal: 100 }
		)
		expect(a.blocks).toHaveLength(1)
		expect(a.blocks[0]!.included).toBe(false)
		expect(a.blocks[0]!.why.join(" ")).toMatch(/cap reached/)
	})

	it("carries the score and the reason on the allocation itself", async () => {
		// Not derived at render time: the numbers exist upstream and nowhere else
		// once the selection loop has moved on.
		const a = allocate([decision()], { budgetTotal: 100 })
		expect(a.blocks[0]!.why.join(" ")).toMatch(/score 0\.600/)
		expect(a.blocks[0]!.why).toContain("filled_scored")
	})

	it("never reports negative headroom", async () => {
		const a = allocate(
			[decision({ candidate: { ...decision().candidate, tokens: 500 } })],
			{
				budgetTotal: 100
			}
		)
		expect(a.budget.remaining).toBe(0)
	})
})

describe("rendering", () => {
	// The engine rides on `base` because it is required now: `render` takes a
	// concrete engine and `renderTemplate` throws on an absent one. These
	// templates are Handlebars, so they say so.
	const base = {
		allocation: allocate([decision()], { budgetTotal: 100 }),
		engine: CORE_TEMPLATE_ENGINE,
		messages: [{ id: 1, role: "user", content: "hello" }]
	}

	/**
	 * Chat wire mode: the render produces MESSAGES, from the guarded path only.
	 *
	 * `split_chat` is the one template with `renderMode: "role_array"`, and
	 * `wireMode: "chat"` selects it whatever the connection's own format says —
	 * a chat connection has no prompt format at all, so the delimiters it carries
	 * have nothing to wrap.
	 */
	describe("chat wire mode", () => {
		/** A template with role blocks in it — the only thing the parse can find. */
		const BLOCKS =
			"{{#systemBlock}}be terse{{/systemBlock}}" +
			"{{#each sessionMessages}}{{#userBlock}}{{this.content}}{{/userBlock}}{{/each}}"

		it("renders role-tagged messages instead of one flat string", async () => {
			const r = await render({
				...base,
				wireMode: "chat",
				template: BLOCKS
			})
			expect(r.rendered).toBeUndefined()
			expect(r.messages).toEqual([
				{ role: "system", content: "be terse" },
				{ role: "user", content: "hello" }
			])
			// No marker survives the parse — the neutraliser and the parser are
			// the guard, and a leaked `<@role:` would mean neither ran.
			for (const m of r.messages!)
				expect(m.content).not.toContain("<@role:")
		})

		it("ignores the connection's completion template entirely", async () => {
			// The mutation that matters: passing a REAL template row here and
			// getting none of its delimiters. Reading `input.completionTemplate`
			// in chat mode would put Vicuna's `### System:` inside a message.
			const r = await render({
				...base,
				wireMode: "chat",
				promptFormat: "chatml",
				template: BLOCKS
			})
			expect(JSON.stringify(r.messages)).not.toContain("<|im_start|>")
			// And the receipt names what was USED, not what the row said.
			expect(r.promptFormat).toBe("split_chat")
		})

		it("degrades a block-less template to one user message, loudly", async () => {
			// ⚠ The one way chat mode can still lose a prompt: the parse finds
			// its messages by the markers the block helpers emit, so a template
			// written without them renders good text and yields an EMPTY array.
			// Sending THAT is a conversation with nothing in it.
			//
			// This used to throw. That broke the project's governing rule in one
			// line — an unavailable mechanism SUBTRACTS A SIGNAL, it never
			// disables a path — and it disabled the path for exactly the person
			// least able to fix it: somebody upgrading, whose template worked
			// yesterday, mid-conversation. The prompt survives now and the
			// receipt carries the sentence the throw used to.
			const r = await render({
				...base,
				wireMode: "chat",
				template: "just some text, no blocks"
			})
			expect(r.messages).toEqual([
				{ role: "user", content: "just some text, no blocks" }
			])
			// Every byte, and no wrapper invented around it.
			expect(r.messages![0].content).toBe("just some text, no blocks")
			expect(r.rendered).toBeUndefined()
		})

		it("names the template AND the fix on the receipt", async () => {
			// The other half, and it is not decoration: keeping the bytes
			// without reporting it would be the quiet structure-loss the throw
			// rightly refused. The note has to say what was done and what to
			// change — dropping either clause makes it noise.
			const r = await render({
				...base,
				wireMode: "chat",
				template: "just some text, no blocks"
			})
			expect(r.notes).toHaveLength(1)
			const note = r.notes![0]
			expect(note).toContain("sent as one user message")
			expect(note).toContain("no role blocks")
			expect(note).toContain("{{#systemBlock}}")
			// The branch: a chat CONNECTION is fixed on the connection, a
			// role-array TEMPLATE by picking a different one. Same wording the
			// throw carried.
			expect(note).toContain("this connection is chat wire mode")
			expect(note).toContain(
				"set this connection to completion wire mode"
			)
		})

		it("names the OTHER fix when it is the template, not the connection", async () => {
			// `wireMode` absent and a role-array completion template selected:
			// the same degradation, and a different sentence, because telling
			// this person to change their wire mode would send them nowhere.
			const r = await render({
				...base,
				promptFormat: PromptFormats.SPLIT_CHAT,
				template: "just some text, no blocks"
			})
			expect(r.messages).toEqual([
				{ role: "user", content: "just some text, no blocks" }
			])
			expect(r.notes![0]).toContain(
				"completion template renders role messages"
			)
			expect(r.notes![0]).toContain("pick a flat completion template")
		})

		it("says nothing at all on the ordinary path", async () => {
			// ABSENT, not `[]`. A receipt that carries an empty notes array on
			// every healthy turn teaches a reader to stop looking at the field,
			// and it moves the payload every parity golden was taken against.
			const r = await render({
				...base,
				wireMode: "chat",
				template: BLOCKS
			})
			expect(r.notes).toBeUndefined()
		})

		it("leaves an EMPTY render alone rather than refusing it", async () => {
			// The mutation on the guard's second half. Nothing was lost here —
			// the template rendered nothing — and "this session is empty" is a
			// different problem with a different owner. Dropping the
			// `rendered.trim() !== ""` half would turn every empty render into
			// this error.
			const r = await render({
				...base,
				wireMode: "chat",
				template: "   "
			})
			expect(r.messages).toEqual([])
		})

		it("is not entered for a completion connection", async () => {
			// The other half of the guard: `wireMode` absent, or `completion`,
			// renders exactly as it always has. Dropping the `=== "chat"` test
			// would send every connection down the role-array branch.
			for (const wireMode of [undefined, "completion" as const]) {
				const r = await render({
					...base,
					wireMode,
					template: BLOCKS
				})
				expect(typeof r.rendered).toBe("string")
				expect(r.messages).toBeUndefined()
			}
		})
	})

	it("gives world lore to the template as name-keyed JSON", async () => {
		// Not an array. The default story strings render `{{{worldLore}}}` and
		// expect `{"<name>": "<content>"}` — this test used to assert an array
		// iterated with `{{#each}}`, which is what the code did and what the
		// templates do not. The parity corpus caught it: a variable with the
		// right name and the wrong shape still renders, and the prompt is
		// quietly missing its lore.
		const r = await render({ ...base, template: "{{{worldLore}}}" })
		// Through its shipped layout, which since 0.6 carries the heading and
		// fence the context template used to write. The shape under them is
		// what this test is about and is unchanged: a name-keyed object.
		const lore = { "The Ashguard": "An order of oathbound riders." }
		expect(r.rendered).toBe(wrapFor("worldLore")!(JSON.stringify(lore)))
	})

	it("omits world lore entirely when nothing was included", async () => {
		// `undefined`, not `"{}"` — a template writing `{{#if worldLore}}` has
		// to see the same falsiness the legacy engines produced, and an empty
		// object is truthy.
		const r = await render({
			...base,
			allocation: allocate([], { budgetTotal: 100 }),
			template: "{{#if worldLore}}HAS{{else}}NONE{{/if}}"
		})
		expect(r.rendered).toBe("NONE")
	})

	it("exposes blocks under the names existing templates already use", async () => {
		// Renaming a variable would silently break every custom story string, and
		// the user's template is the migration's input.
		const r = await render({
			...base,
			template: "{{#each sessionMessages}}{{this.content}}{{/each}}"
		})
		expect(r.rendered).toBe("hello")
	})

	it("excluded allocations do not reach the template", async () => {
		const r = await render({
			allocation: allocate([decision({ included: false })], {
				budgetTotal: 100
			}),
			engine: CORE_TEMPLATE_ENGINE,
			messages: [],
			template: "[{{#each worldLore}}{{this}}{{/each}}]"
		})
		expect(r.rendered).toBe("[]")
	})

	it("hands the budget to the template, so a story string can react to it", async () => {
		const r = await render({ ...base, template: "{{budget.remaining}}" })
		expect(r.rendered).toBe("90")
	})

	it("a split-chat format yields role-tagged messages rather than one string", async () => {
		// Decided here rather than by the caller, so the preview and the send
		// cannot disagree about which shape they are comparing.
		//
		// ⚠ The template emits BLOCKS. It used to be a hand-written ChatML
		// string, which contains no role markers at all — so this passed on
		// `Array.isArray([])`, an empty conversation, which is now refused by
		// name. The template's own `renderMode` is still what selects this
		// branch here (no `wireMode` is supplied), which is the case worth
		// keeping: a connection may point at a `role_array` template
		// independently of how it is called.
		const r = await render({
			...base,
			promptFormat: "split_chat",
			template: "{{#systemBlock}}hi{{/systemBlock}}"
		})
		expect(r.rendered).toBeUndefined()
		expect(r.messages).toEqual([{ role: "system", content: "hi" }])
	})

	it("reports what the template referenced", async () => {
		const r = await render({
			...base,
			template:
				"{{system}} {{#each worldLore}}{{this}}{{/each}} {{budget.total}}"
		})
		expect(r.usedVariables).toContain("system")
		expect(r.usedVariables).toContain("worldLore")
		expect(r.usedVariables).toContain("budget.total")
	})

	it("prompts land as template variables", async () => {
		const r = await render({
			...base,
			prompts: { systemPrompt: "You are a narrator." },
			template: "{{systemPrompt}}"
		})
		expect(r.rendered).toBe("You are a narrator.")
	})
})

describe("variable extraction", () => {
	it("finds dotted paths and each-blocks, and ignores this", async () => {
		expect(
			referencedVariables("{{a.b}} {{#each xs}}{{this}}{{/each}}")
		).toEqual(["a.b", "xs"])
	})

	it("an empty template references nothing", async () => {
		expect(referencedVariables("")).toEqual([])
	})
})

describe("the engine is data, not an assumption", () => {
	beforeEach(() => _resetRenderers())

	const base = {
		allocation: allocate([decision()], { budgetTotal: 100 }),
		engine: CORE_TEMPLATE_ENGINE,
		messages: [] as any[]
	}

	it("refuses to render when no engine arrives, rather than assuming core's", async () => {
		// ⚠ This test used to assert the OPPOSITE — "a null engine means core's
		// default" — on the reading that the column was nullable so an
		// untouched config stayed distinguishable from a deliberate choice.
		//
		// That default is what let the delivery bug survive a release.
		// `world.ts` dereferenced a template row for its `source` and dropped
		// the `engine` beside it, so this branch was taken on EVERY run on
		// every install: every context template rendered in Handlebars whatever
		// it declared, silently, and a plugin's template would have reached the
		// model as raw markup. Both template tables store `engine` NOT NULL
		// now, so an absent one can only mean a caller lost it — a fault, and
		// raised as one.
		//
		// If this test ever goes red because somebody restored the fallback to
		// make it pass: that is the bug, not the fix.
		await expect(
			render({
				...base,
				engine: undefined as any,
				template: "{{budget.total}}"
			})
		).rejects.toThrow(/no template engine/i)
	})

	it("an extension can register its own engine and render its own templates", async () => {
		registerRenderer("chariot.mustache:v1@1", "chariot.mustache", (ctx) =>
			ctx.template.replace(
				"<<total>>",
				String((ctx.variables as any).budget.total)
			)
		)
		const r = await render({
			...base,
			engine: "chariot.mustache:v1@1",
			template: "budget is <<total>>"
		})
		expect(r.rendered).toBe("budget is 100")
	})

	it("an unknown engine refuses rather than rendering as Handlebars", async () => {
		// A fallback would mostly "work" — emitting the foreign syntax intact —
		// and send a model a prompt full of markup nobody meant to include.
		await expect(
			render({ ...base, engine: "nobody.owns:this@1", template: "x" })
		).rejects.toThrow(/no renderer for template engine/)
	})

	it("the refusal names what is registered, so the fix is visible", async () => {
		try {
			await render({
				...base,
				engine: "nobody.owns:this@1",
				template: "x"
			})
		} catch (e) {
			expect((e as Error).message).toMatch(
				/core:template\/handlebars@1 \(core\)/
			)
		}
	})

	it("nobody can take over an engine somebody else owns", async () => {
		// Including core's. A plugin that could redefine how everyone's templates
		// render would change every prompt on the instance without appearing in
		// any spec.
		expect(() =>
			registerRenderer(CORE_TEMPLATE_ENGINE, "chariot.sneaky", () => "")
		).toThrow(TemplateEngineError)

		registerRenderer("chariot.a:engine@1", "chariot.a", () => "")
		expect(() =>
			registerRenderer("chariot.a:engine@1", "chariot.b", () => "")
		).toThrow(/already rendered by 'chariot.a'/)
	})
})

/**
 * `objectByRole` — the type chooses the projection.
 *
 * The two bodies inside it are the two that were `objectByName` and
 * `objectByDate`; what moved is *which one runs*, from a hardcoded call site to
 * the declaration. So the assertions here are about the choosing, and about the
 * one thing the roles vocabulary does **not** buy: the order key's formatting,
 * which is still core's and is asserted against `formatHistoryDateKey` byte for
 * byte.
 */
const allocation = (over: Partial<Allocation> = {}): Allocation => ({
	source: "worldLore",
	id: 1,
	content: "content",
	tokens: 1,
	why: [],
	included: true,
	...over
})

const worldLoreRoles = entryDeclaration(WORLD_LORE_TYPE_ID)!.roles
const historyRoles = entryDeclaration(HISTORY_TYPE_ID)!.roles

describe("objectByRole", () => {
	it("keys by the title role, in arrival order, for a type that declares one", () => {
		const out = objectByRole(
			[
				allocation({ id: 1, name: "B", content: "second" }),
				allocation({ id: 2, name: "A", content: "first" })
			],
			worldLoreRoles
		)
		expect(Object.keys(out!)).toEqual(["B", "A"])
		expect(out).toEqual({ B: "second", A: "first" })
	})

	it("skips a titled block with no title and one with no content", () => {
		expect(
			objectByRole(
				[
					allocation({ id: 1, content: "orphaned" }),
					allocation({ id: 2, name: "Named", content: "" })
				],
				worldLoreRoles
			)
		).toBeUndefined()
	})

	it("returns undefined rather than {} so `{{#if worldLore}}` still skips", () => {
		// An empty object is truthy, which is the whole reason this is not `{}`.
		expect(objectByRole([], worldLoreRoles)).toBeUndefined()
	})

	it("sorts by the declared order keys and heads by the order key itself", () => {
		const dated = (
			year: number,
			month: number | null,
			day: number | null
		) =>
			allocation({
				source: "history",
				id: `${year}-${month}-${day}`,
				content: `${year}`,
				meta: { year, month, day }
			})
		const out = objectByRole(
			[dated(410, 3, null), dated(412, null, null), dated(410, 1, 5)],
			historyRoles
		)
		// Newest first, absent parts last — today's assembly sort, stated as
		// data on the type rather than as arithmetic in this module.
		expect(Object.keys(out!)).toEqual(["Year 412", "410-03", "410-01-05"])
	})

	it("keeps a year-only date in its place, newest first (plan A20 b)", () => {
		// A bare "413" is an integer-like key, and an object lists those
		// ascending ahead of every other key: the oldest year-only entry led.
		const out = objectByRole(
			[
				allocation({ source: "history", id: 1, content: "old", meta: { year: 3 } }),
				allocation({ source: "history", id: 2, content: "mid", meta: { year: 7, month: 2 } }),
				allocation({ source: "history", id: 3, content: "new", meta: { year: 9 } })
			],
			historyRoles
		)
		expect(Object.values(out!)).toEqual(["new", "mid", "old"])
		expect(Object.keys(out!)).toEqual(["Year 9", "7-02", "Year 3"])
	})

	it("keeps every entry sharing a date, each under its own heading (plan A20 a)", () => {
		const out = objectByRole(
			[
				allocation({ source: "history", id: 1, content: "The bridge fell.", meta: { year: 7 } }),
				allocation({ source: "history", id: 2, content: "The tower burned.", meta: { year: 7 } }),
				allocation({ source: "history", id: 3, content: "Ice.", meta: { year: 7, month: 2 } }),
				allocation({ source: "history", id: 4, content: "Snow.", meta: { year: 7, month: 2 } })
			],
			historyRoles
		)
		expect(out).toEqual({
			"7-02": "Ice.",
			"7-02 (2)": "Snow.",
			"Year 7": "The bridge fell.",
			"Year 7 (2)": "The tower burned."
		})
	})

	it("produces what formatHistoryDateKey produced wherever a month or a day is set", () => {
		// ⚠ The one thing roles do not buy: core formats the order key, and a
		// second ordered type wants a named policy rather than a branch. A
		// year alone is the one departure: it reads "Year 412", never an
		// integer-like "412" (plan A20 b).
		const cases = [
			{ year: 412, month: 3, day: 7 },
			{ year: 412, month: 3, day: null },
			// The odd one, preserved deliberately: an absent middle part does
			// not terminate the key, it is skipped.
			{ year: 412, month: null, day: 5 },
			{ year: 0, month: 12, day: 31 }
		]
		for (const meta of cases) {
			const out = objectByRole(
				[allocation({ source: "history", content: "x", meta })],
				historyRoles
			)
			expect(Object.keys(out!)).toEqual([formatHistoryDateKey(meta)])
		}
		const yearOnly = objectByRole(
			[allocation({ source: "history", content: "x", meta: { year: -30 } })],
			historyRoles
		)
		expect(Object.keys(yearOnly!)).toEqual(["Year -30"])
	})

	it("skips blank-after-trim content for an ordered type, which the titled form does not", () => {
		// The two emptiness rules genuinely differ and are preserved rather
		// than tidied: tidying one is a change to what a prompt contains.
		expect(
			objectByRole(
				[
					allocation({
						source: "history",
						content: "   ",
						meta: { year: 1 }
					})
				],
				historyRoles
			)
		).toBeUndefined()
	})

	it("falls back to the titled form for a source no type declares", () => {
		expect(
			objectByRole([allocation({ name: "N", content: "c" })], undefined)
		).toEqual({ N: "c" })
	})
})

/**
 * A band core has no variable for and its source never DECLARED — Twenty
 * Questions' `secret-entry` before it declared one — has no template name, so
 * it is named on the receipt rather than dropped without trace. Bands are
 * top-level names only; there is no `bands` object.
 *
 * The fixture is the TQ respond path in miniature: world lore beside the
 * script-picked secret in its own `priority: 'always'` band, and a `briefing`
 * band the ranker excluded.
 */
describe("plugin bands", () => {
	beforeEach(() => _resetRenderers())

	const secret = decision({
		candidate: {
			id: "secret-entry:7",
			source: "secret-entry",
			tokens: 6,
			signals: {},
			payload: {
				id: "secret-entry:7",
				name: "The Brass Lantern",
				content: "A lantern that never goes out."
			}
		},
		reason: "reserved_minimum"
	})
	const briefing = decision({
		candidate: {
			id: "briefing:1",
			source: "briefing",
			tokens: 4,
			signals: {},
			payload: { name: "Rules", content: "Answer yes or no." }
		},
		included: false,
		reason: "excluded_token_limit"
	})
	const withBands = {
		allocation: allocate([decision(), secret, briefing], {
			budgetTotal: 100
		}),
		engine: CORE_TEMPLATE_ENGINE,
		messages: [{ id: 1, role: "user", content: "is it alive?" }]
	}
	const coreOnly = {
		...withBands,
		allocation: allocate([decision()], { budgetTotal: 100 })
	}
	const SECRET_JSON = JSON.stringify({
		"The Brass Lantern": "A lantern that never goes out."
	})

	it("puts no `bands` object in the context", async () => {
		const r = await render({
			...withBands,
			template:
				"[{{bands.secret-entry}}][{{bands.briefing}}][{{bands.worldLore}}]"
		})
		expect(r.rendered).toBe("[][][]")
	})

	it("names an included band the template never renders on the receipt", async () => {
		const r = await render({ ...withBands, template: "{{{worldLore}}}" })
		expect(r.notes).toEqual([
			"band 'secret-entry' was ranked and included but no template can " +
				"render it: its source does not declare it. Declare it on that " +
				"source (bands: { secretEntry: … }) and place it with {{{secretEntry}}}"
		])
	})

	it("leaves core's three byte-identical, through the shipped template", async () => {
		const templates = [
			SHIPPED_CONTEXT_TEMPLATE,
			"{{{worldLore}}}|{{{history}}}|{{{currentDate}}}|{{characterLore}}"
		]
		for (const template of templates) {
			const a = await render({ ...coreOnly, template })
			const b = await render({ ...withBands, template })
			expect(b.rendered).toBe(a.rendered)
		}
	})
})

/**
 * Typed templates P2: a band its source DECLARES is a top-level template name.
 *
 * The resolved band set reaches `render` as the keys of the `variables` slot
 * — `world.ts` resolves one per band `rendersAt` found upstream, with no
 * layout (`{ engine }`) until somebody selects one. The fixture is the Twenty
 * Questions secret under its identifier key, `secretEntry`.
 */
describe("declared bands", () => {
	beforeEach(() => _resetRenderers())

	const secret = decision({
		candidate: {
			id: "secret-entry:7",
			source: "secretEntry",
			tokens: 6,
			signals: {},
			payload: {
				id: "secret-entry:7",
				name: "The Brass Lantern",
				content: "A lantern that never goes out."
			}
		},
		reason: "reserved_minimum"
	})
	const SECRET_JSON = JSON.stringify({
		"The Brass Lantern": "A lantern that never goes out."
	})
	const declared = {
		allocation: allocate([decision(), secret], { budgetTotal: 100 }),
		engine: CORE_TEMPLATE_ENGINE,
		messages: [{ id: 1, role: "user", content: "is it alive?" }],
		// What world.ts resolves for a declared band nobody gave a layout.
		variables: { secretEntry: { engine: CORE_TEMPLATE_ENGINE } }
	}

	it("exposes a declared band at the top level, through the in-code floor", async () => {
		const r = await render({ ...declared, template: "{{{secretEntry}}}" })
		expect(r.rendered).toBe(SECRET_JSON)
		expect(r.notes).toBeUndefined()
	})

	it("renders a declared band through its selected layout", async () => {
		const r = await render({
			...declared,
			variables: {
				secretEntry: {
					engine: CORE_TEMPLATE_ENGINE,
					source:
						"{{#each secretEntry}}Secret: {{@key}} — {{this}}{{/each}}"
				}
			},
			template: "<{{{secretEntry}}}>"
		})
		expect(r.rendered).toBe(
			"<Secret: The Brass Lantern — A lantern that never goes out.>"
		)
	})

	it("loops every declared band, each through its own layout", async () => {
		const briefing = decision({
			candidate: {
				id: "briefing:1",
				source: "briefing",
				tokens: 4,
				signals: {},
				payload: { name: "Rules", content: "Answer yes or no." }
			}
		})
		const r = await render({
			...declared,
			allocation: allocate([decision(), secret, briefing], {
				budgetTotal: 100
			}),
			variables: {
				secretEntry: { engine: CORE_TEMPLATE_ENGINE },
				briefing: {
					engine: CORE_TEMPLATE_ENGINE,
					source: "{{#each briefing}}{{this}}{{/each}}"
				}
			},
			template: "{{{secretEntry}}}|{{{briefing}}}"
		})
		expect(r.rendered).toBe(`${SECRET_JSON}|Answer yes or no.`)
	})

	it("is falsy when nothing of the band was included", async () => {
		const r = await render({
			...declared,
			allocation: allocate([decision()], { budgetTotal: 100 }),
			template: "{{#if secretEntry}}yes{{else}}no{{/if}}"
		})
		expect(r.rendered).toBe("no")
	})

	it("names the top-level spelling when a declared band is not placed", async () => {
		const r = await render({ ...declared, template: "{{{worldLore}}}" })
		expect(r.notes).toEqual([
			"band 'secretEntry' was ranked and included but the template does " +
				"not render it — place it with {{{secretEntry}}}"
		])
	})

	it("refuses a declared band that collides with the template context, naming both", async () => {
		await expect(
			render({
				...declared,
				templateContext: { secretEntry: "from the builder" },
				template: "{{{secretEntry}}}"
			})
		).rejects.toThrow(
			/band 'secretEntry'.*collides with 'secretEntry' from the template context/
		)
	})

	it("never promotes a shipped layout key into a band", async () => {
		// A preview hands in every shipped layout (`bareLayouts`) — `characters`
		// among them. It is a core variable, not a band, and stays the
		// template context's.
		const r = await render({
			...declared,
			variables: {
				...declared.variables,
				characters: { engine: CORE_TEMPLATE_ENGINE, source: "X" }
			},
			templateContext: { characters: "the cast" },
			template: "{{{characters}}}"
		})
		expect(r.rendered).toBe("the cast")
	})

	it("leaves core's three byte-identical when a band is declared", async () => {
		const coreOnly = {
			...declared,
			allocation: allocate([decision()], { budgetTotal: 100 }),
			variables: undefined
		}
		const templates = [
			SHIPPED_CONTEXT_TEMPLATE,
			"{{{worldLore}}}|{{{history}}}|{{{currentDate}}}|{{characterLore}}"
		]
		for (const template of templates) {
			const a = await render({ ...coreOnly, template })
			const b = await render({ ...declared, template })
			expect(b.rendered).toBe(a.rendered)
		}
	})
})

/**
 * `recalledLines` — older transcript lines `core:query/entity-search@1`
 * recalls on its `messages` out-port, in their own declared band (owner
 * ruling 2026-09-27, option b). They sat in the transcript's `messages` band
 * before, budgeted and rendered nowhere; now a template places them with
 * `{{{recalledLines}}}`, per genre, through the shipped "Lines" layout, and a
 * template that does not place them gets the declared-band note. Nothing
 * places them automatically, and no shipped template does.
 *
 * The fixture is entity-search's own candidate shape: lines from turns 3 and
 * 9 recalled on a shared entity (ranked newest-first), beside a recent window
 * of turns 40–41. `variables` is what the world resolves at an Assemble the
 * band reaches — the key, with the shipped row or no source at all.
 */
describe("recalled lines", () => {
	beforeEach(() => _resetRenderers())

	const LINE_3 = "I hid the brass key under the chapel floor."
	const LINE_9 = "The chapel? It burned."
	const recalledLine = (id: number, turn: number, name: string, content: string) =>
		decision({
			candidate: {
				id,
				source: "recalledLines",
				tokens: 12,
				signals: { entityCooccurrence: 1 },
				presetScore: 0.8,
				payload: {
					id,
					name,
					content,
					turn,
					foundBy: "entity-search",
					sharedEntities: ["brass key"]
				}
			}
		})
	const input = {
		allocation: allocate(
			[
				decision(),
				recalledLine(9, 9, "Ada", LINE_9),
				recalledLine(3, 3, "Mira", LINE_3)
			],
			{ budgetTotal: 200 }
		),
		engine: CORE_TEMPLATE_ENGINE,
		messages: [
			{ id: 40, role: "user", name: "Ada", content: "", message: "Where is the key?" },
			{ id: 41, role: "assistant", name: "Mira", content: "", message: "Mira shrugs." }
		],
		variables: { recalledLines: { engine: CORE_TEMPLATE_ENGINE } }
	}
	const PLACED =
		"{{#if recalledLines}}Earlier in this conversation:\n{{{recalledLines}}}\n{{/if}}" +
		"{{#each sessionMessages}}{{{name}}}: {{{message}}}\n{{/each}}"

	it("renders where a template places {{{recalledLines}}}, oldest first, through the Lines layout", async () => {
		const r = await render({ ...input, template: PLACED })
		expect(r.rendered).toBe(
			"Earlier in this conversation:\n" +
				`Earlier (turn 3) — Mira: ${LINE_3}\n` +
				`Earlier (turn 9) — Ada: ${LINE_9}\n` +
				"Ada: Where is the key?\nMira: Mira shrugs.\n"
		)
		expect(r.notes).toBeUndefined()
	})

	it("renders through the selected layout when one is chosen", async () => {
		const r = await render({
			...input,
			variables: {
				recalledLines: {
					engine: CORE_TEMPLATE_ENGINE,
					source: "{{#each recalledLines}}[{{{turn}}}] {{{speaker}}}: {{{text}}};{{/each}}"
				}
			},
			template: "{{{recalledLines}}}"
		})
		expect(r.rendered).toBe(`[3] Mira: ${LINE_3};[9] Ada: ${LINE_9};`)
	})

	it("unplaced, it is budgeted and the receipt names the fix", async () => {
		expect(input.allocation.budget.used).toBe(34)
		const r = await render({ ...input, template: SHIPPED_CONTEXT_TEMPLATE })
		expect(r.rendered).not.toContain(LINE_3)
		expect(r.rendered).toContain("Where is the key?")
		expect(r.notes).toEqual([
			"band 'recalledLines' was ranked and included but the template does " +
				"not render it — place it with {{{recalledLines}}}"
		])
	})

	it("is absent when no line was included, so {{#if recalledLines}} is false", async () => {
		const r = await render({
			...input,
			allocation: allocate([decision()], { budgetTotal: 200 }),
			template: PLACED
		})
		expect(r.rendered).toBe("Ada: Where is the key?\nMira: Mira shrugs.\n")
		expect(r.notes).toBeUndefined()
	})
})
