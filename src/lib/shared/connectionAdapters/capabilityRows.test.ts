/**
 * The capability panel's row model.
 *
 * Every assertion here is against a failure that would be SILENT on screen: an
 * override written as `false` where it should have been deleted, a switch
 * offered for a capability the protocol cannot express, an untested connection
 * rendered as though something had confirmed it, a resolved answer that
 * contradicts the control with nothing saying so. None of those look wrong; they
 * look like a working panel with the wrong answer in it.
 */
import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	buildCapabilityRows,
	OVERRIDE_STATES,
	relativeAge,
	type CapabilityRow,
	type CapabilityRowsView
} from "./capabilityRows"

const find = (view: CapabilityRowsView, id: string): CapabilityRow => {
	const row = [...view.transforms, ...view.features].find((r) => r.id === id)
	if (!row) throw new Error(`no row for ${id}`)
	return row
}
const has = (view: CapabilityRowsView, id: string): boolean =>
	[...view.transforms, ...view.features].some((r) => r.id === id)

describe("the three states", () => {
	test("an absent override key is AUTO, not off", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: {}, overrides: {} }
		})
		expect(find(view, "text->image").state).toBe("auto")
	})

	test("`false` is OFF and never collapses into auto", () => {
		// The distinction the whole widget exists to keep: an absent key hands
		// authority back to the probe, `false` takes it away permanently.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { overrides: { "text->image": false } }
		})
		expect(find(view, "text->image").state).toBe("off")
	})

	test("a grade is ON", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { "text->image": 1 },
				resolved: { "text->image": 1 }
			}
		})
		expect(find(view, "text->image").state).toBe("on")
	})

	test("Auto is offered FIRST and sends null — never `false`", () => {
		// A `false` on the Auto position would look identical on screen and mean
		// the opposite: the row would stop hearing its own backend forever.
		expect(OVERRIDE_STATES[0].value).toBe("auto")
		expect(OVERRIDE_STATES[0].wire).toBeNull()
		expect(OVERRIDE_STATES.map((s) => s.wire)).toEqual([
			null,
			"native",
			false
		])
	})
})

describe("the adapter gates the key space", () => {
	test("a capability the adapter never declared gets no row, even when the column carries one", () => {
		// The reported bug, in its durable form: KOBOLDCPP_MANAGED declares no
		// text->image at all, so junk left in the column by an earlier type must
		// not resurrect as a switch.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			capabilities: {
				resolved: { "text->image": 1 },
				overrides: { "text->image": 1 }
			}
		})
		expect(has(view, "text->image")).toBe(false)
		expect(has(view, "text->text")).toBe(true)
	})

	test("a type no manifest entry declares renders nothing rather than guessing", () => {
		// ⚠ An out-of-tree id, not an embedding one. The three embedding types
		// have manifest entries: `connections:setDefault` judges every star with
		// `capabilityRefusal`, and a type the manifest does not describe can be
		// granted nothing, so an embedding endpoint without an entry would be
		// one nobody could register.
		const view = buildCapabilityRows({ type: "acme:imaginary" })
		expect(view.declared).toBe(false)
		expect(view.transforms).toEqual([])
		expect(view.features).toEqual([])
	})

	test("an embedding type renders exactly the one transform it declares", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS
		})
		expect(view.declared).toBe(true)
		expect(view.transforms.map((r) => r.id)).toEqual(["text->embedding"])
		// No features: an embedding request has no response format to constrain,
		// no tools and nothing to stream.
		expect(view.features).toEqual([])
	})
})

describe("provenance — the answer to 'why is my LLM offering image generation'", () => {
	test("a hand-set value says so", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { "text->image": false },
				resolved: {}
			}
		})
		const row = find(view, "text->image")
		expect(row.decidedBy).toBe("override")
		expect(row.provenance).toMatch(/switched this off/i)
	})

	test("a probe says WHEN it answered", () => {
		const at = new Date("2026-08-28T00:00:00.000Z").toISOString()
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { "text->image": 1 },
				probe: { found: { "text->image": 1 }, at }
			},
			now: new Date("2026-08-31T00:00:00.000Z").getTime()
		})
		const row = find(view, "text->image")
		expect(row.decidedBy).toBe("probe")
		expect(row.provenance).toContain("3d ago")
		expect(row.assumed).toBe(false)
	})

	test("a probe answer to a question the adapter never asked is not credited", () => {
		// `streaming` is declared native outright, so resolution ignores a probe
		// for it — and a provenance line naming a layer that had no effect is a
		// wrong answer that reads like a right one.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { streaming: 1 },
				probe: {
					found: { streaming: 1 },
					at: "2026-08-30T00:00:00.000Z"
				}
			}
		})
		expect(find(view, "streaming").decidedBy).toBe("default")
	})

	// `json_schema` rather than `text->image`, which this used to assert: the
	// OPENAI entry no longer declares image generation for anyone (nothing
	// implements `generateImage` for that type, so the key cannot be derived) and
	// the `openai-official` preset no longer asserts it. `json_schema` is the
	// same shape of fact — declared `{unproven:true}` by the adapter, asserted
	// `true` by this preset — so the row is still decided by the preset layer.
	test("a preset is named by its display name, not its slug", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			preset: "openai-official",
			capabilities: { resolved: { json_schema: 2 } }
		})
		const row = find(view, "json_schema")
		expect(row.decidedBy).toBe("preset")
		expect(row.provenance).toContain("OpenAI (Official)")
	})

	test("an untested connection says so rather than looking authoritative", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->text": 1 } }
		})
		expect(view.tested).toBe(false)
		expect(view.testedText).toMatch(/nothing has tested/i)
		// text->image is `probed` with `until: none`, and nothing has answered.
		expect(find(view, "text->image").assumed).toBe(true)
		// text->text is declared native outright — an assumption about nothing.
		expect(find(view, "text->text").assumed).toBe(false)
	})

	test("a preset's assertion is a claim, not an assumption", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			preset: "openai-official",
			capabilities: { resolved: { json_schema: 2 } }
		})
		expect(find(view, "json_schema").assumed).toBe(false)
	})
})

describe("the state chip reports the grade the SERVER resolved", () => {
	test("emulated is named as ours rather than shown as plain On", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { tools: 1, grammar: 1 } }
		})
		expect(find(view, "tools").stateLabel).toBe("On · by Serene Pub")
		expect(find(view, "grammar").stateLabel).toBe("On")
	})

	test("a capability missing from `resolved` is Off, not blank", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->text": 1 } }
		})
		const row = find(view, "text->image")
		expect(row.grade).toBe(0)
		expect(row.on).toBe(false)
		expect(row.stateLabel).toBe("Off")
		expect(row.letter).toBeUndefined()
	})

	test("a grade is read against the capability's OWN top, never a shared one", () => {
		// The reason grades replaced the flat enum. Image generation at 1 is the
		// best image generation there is, and tool calling at 1 is Serene Pub
		// doing the work — the same number, two different readings, and the row
		// carries the scale so neither presentation has to know the difference.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->image": 1, tools: 1 } }
		})
		const image = find(view, "text->image")
		expect(image.grade).toBe(image.top)
		expect(image.letter).toBe("A")
		expect(image.stateLabel).toBe("On")

		const tools = find(view, "tools")
		expect(tools.top).toBe(2)
		expect(tools.letter).toBe("B")
		expect(tools.stateLabel).toBe("On · by Serene Pub")
	})
})

describe("contested rows — an explicit off that did not stick", () => {
	test("KoboldCPP's tools come back emulated and the row names the lever", () => {
		// Expected on day one: `closure()` re-supplies tools through the native
		// grammar, so switching them off does nothing until the grammar goes.
		// Whether an explicit `false` OUGHT to survive the closure is an SDK
		// ruling, deferred — so the row has to be honest instead of silent.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { tools: false },
				resolved: { tools: 1, grammar: 1 }
			}
		})
		const row = find(view, "tools")
		expect(row.contested).toBe(true)
		expect(row.derivedVia).toContain("grammar")
		expect(row.derived).toContain("Grammar constraints")
	})

	test("an off that DID stick is not contested", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { "text->image": false },
				resolved: { "text->text": 1 }
			}
		})
		const row = find(view, "text->image")
		expect(row.contested).toBe(false)
		expect(row.derived).toBeUndefined()
	})

	test("a transform is in neither closure table, so nothing claims to derive it", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->image": 1 } }
		})
		expect(find(view, "text->image").derivedVia).toEqual([])
	})
})

describe("disclosure", () => {
	test("transforms are always visible and features are the ones behind Advanced", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { "text->text": 1, tools: 1 }
			}
		})
		expect(view.transforms.every((r) => r.kind === "transform")).toBe(true)
		expect(view.features.every((r) => r.kind === "feature")).toBe(true)
		expect(view.transforms.map((r) => r.id)).toContain("text->image")
		// The summary names what is ON, and this fixture is a two-key cache on a
		// type that declares eight — so the rest are resolved from the layers
		// (`effectiveCapabilities`) and KoboldCPP's defaults are what is on.
		// `continue_reply` is defaulted too and still absent here: both wire modes
		// resolve on, the tie-break sends this as chat, and chat cannot prefill.
		expect(view.featuresOnLabels).toEqual([
			"Grammar constraints",
			"Tool calling",
			"Streaming",
			"Chat messages",
			"Text completion"
		])
	})

	test("`basic` PINS text->text first — it does not filter", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {}
		})
		expect(view.transforms[0].id).toBe("text->text")
		expect(view.transforms[0].basic).toBe(true)
	})

	test("an A1111 connection still gets rows, having no text->text at all", () => {
		// A strict basic-only cut would leave this connection with an empty
		// panel — the reason `isBasicCapability` pins rather than filters.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.A1111,
			capabilities: { resolved: { "text->image": 1 } }
		})
		// One row, and one only. This used to expect `text+image->image` and
		// `image->image` beside it, which A1111Adapter could not do and said so in
		// its own profile — the manifest's key space is now derived from the
		// actions a module implements, and nothing implements `editImage`.
		expect(view.transforms.map((r) => r.id)).toEqual(["text->image"])
		expect(view.transforms.every((r) => r.basic)).toBe(false)
	})

	test("rows are named, never addressed", () => {
		const view = buildCapabilityRows({ type: CONNECTION_TYPE.KOBOLDCPP })
		for (const row of [...view.transforms, ...view.features])
			expect(row.label).not.toContain("->")
	})
})

describe("which wire mode is in effect", () => {
	// Two switches that can both read "On" and a tie-break nothing showed. The
	// switches themselves are honest — both modes really are offered — so the
	// failure is not a control without an effect but an OUTCOME without a line.
	test("both on names the winner and says the other is on too", () => {
		// OPENAI defaults to both, which is the ordinary case rather than an
		// edge one: every connection of this type lands here on day one.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			capabilities: {
				resolved: { wire_chat: 1, wire_completion: 1 }
			}
		})
		expect(view.wireMode).toBe("chat")
		// Both halves. Naming only the winner would read as "completion is off",
		// which is the opposite of true; naming only the pair leaves the outcome
		// exactly as invisible as the two switches already left it.
		expect(view.wireModeText).toContain(
			"Chat messages and Text completion are on"
		)
		expect(view.wireModeText).toContain("sent as Chat messages")
		expect(view.wireModeText).toContain("tie-break")
	})

	test("one on follows the RESOLUTION, not the declaration order", () => {
		// `openai-official` switches `wire_completion` off at the preset layer, so
		// this is that inverse: somebody who said "send this as completions".
		// Reading the tie-break order instead of the resolved set would answer
		// "chat" here and be wrong on the one connection whose owner cared enough
		// to say so.
		//
		// The `wire_chat: false` is what SAYS so, and it is not decoration: OPENAI
		// defaults both wire modes, so a cache merely omitting `wire_chat` is a
		// column no rewrite could produce, and the key is resolved from the layers
		// (`effectiveCapabilities`) rather than read as off.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			capabilities: {
				resolved: { wire_completion: 1 },
				overrides: { wire_chat: false }
			}
		})
		expect(view.wireMode).toBe("completion")
		expect(view.wireModeText).toBe(
			"Sent as Text completion — the only wire mode on."
		)
	})

	test("neither on says it is a fallback rather than stating a mode flatly", () => {
		// Both switched off by hand. `wireModeFor` still answers, from the type's
		// declaration, and a line that printed that answer as a fact would be the
		// assumption the panel's own "nothing has tested this" sentence exists to
		// refuse.
		//
		// This used to be a cache written before the wire keys existed, which is
		// no longer the same state: `effectiveCapabilities` resolves a declared
		// key the cache does not name, so that column now reports the modes the
		// layers give it rather than falling back. The hand-switched pair is what
		// still reaches this line, and it is the case that matters — a fallback
		// sentence must not be reachable by a column that has a real answer.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			capabilities: {
				resolved: { "text->text": 1 },
				overrides: { wire_chat: false, wire_completion: false }
			}
		})
		expect(view.wireMode).toBe("chat")
		expect(view.wireModeText).toContain("No wire mode is on")
		expect(view.wireModeText).toContain("falls back")
	})

	test("a type that declares no wire mode gets no line", () => {
		// A1111 is not "sent as chat messages". Answering anyway would be a fresh
		// untruth in the panel built to remove them.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.A1111,
			capabilities: { resolved: { "text->image": 1 } }
		})
		expect(view.wireMode).toBeUndefined()
		expect(view.wireModeText).toBeUndefined()
	})

	test("a type with only completion RESOLVED says so without a tie-break", () => {
		// LLAMACPP declares both wires but defaults only `wire_completion`, so
		// this is the resolved set an untouched row has: one mode on, nothing to
		// lose to a tie-break and nothing to explain away.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.LLAMACPP,
			capabilities: { resolved: { wire_completion: 1 } }
		})
		expect(view.wireMode).toBe("completion")
		expect(view.wireModeText).not.toContain("wins")
	})
})

describe("relativeAge", () => {
	const base = new Date("2026-08-31T12:00:00.000Z").getTime()
	const ago = (ms: number) => new Date(base - ms).toISOString()

	test("reads in the steps a person thinks in", () => {
		expect(relativeAge(ago(5_000), base)).toBe("just now")
		expect(relativeAge(ago(5 * 60_000), base)).toBe("5m ago")
		expect(relativeAge(ago(3 * 3_600_000), base)).toBe("3h ago")
		expect(relativeAge(ago(3 * 86_400_000), base)).toBe("3d ago")
	})

	test("an unparseable timestamp does not render NaN at somebody", () => {
		expect(relativeAge("not a date", base)).toBe("at an unknown time")
	})
})

describe("the Continue a reply row", () => {
	test("reads OFF in a wire that cannot carry it, however the layers resolved", () => {
		// The row's whole hazard: `continue_reply` resolves ON for every
		// OpenAI-compatible connection (it is in the type's defaults), and in
		// chat wire nothing can prefill. A row saying "On" beside a Continue
		// button the server refuses is the screen-says-one-thing failure.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			capabilities: {
				resolved: {
					continue_reply: 1,
					wire_chat: 1,
					wire_completion: 1
				}
			}
		})
		const row = find(view, "continue_reply")
		expect(row.on).toBe(false)
		expect(row.grade).toBe(0)
		expect(row.stateLabel).toBe("Off")
	})

	test("and says WHY, naming the wire rather than the capability", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			capabilities: {
				resolved: {
					continue_reply: 1,
					wire_chat: 1,
					wire_completion: 1
				}
			}
		})
		const row = find(view, "continue_reply")
		expect(row.derived).toContain("Chat messages")
		expect(row.derived).toContain("Text completion")
	})

	test("reads ON in the wire that does carry it, with no explanation to give", () => {
		// `wire_chat: false` by hand rather than merely absent from the cache:
		// OPENAI defaults both wire modes, so an unnamed key is resolved from the
		// layers now (`effectiveCapabilities`) and this connection would be back
		// in chat wire, which is a different test.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			capabilities: {
				resolved: { continue_reply: 1, wire_completion: 1 },
				overrides: { wire_chat: false }
			}
		})
		const row = find(view, "continue_reply")
		expect(row.on).toBe(true)
		expect(row.stateLabel).toBe("On")
		expect(row.derived).toBeUndefined()
	})

	test("is a FEATURE row, labelled in plain language and never by its id", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { continue_reply: 1, wire_completion: 1 }
			}
		})
		const row = find(view, "continue_reply")
		expect(row.kind).toBe("feature")
		expect(row.label).toBe("Continue a reply")
	})

	test("an image-only type gets no row at all — the adapter gates the space", () => {
		expect(
			has(
				buildCapabilityRows({
					type: CONNECTION_TYPE.A1111,
					capabilities: { resolved: { continue_reply: 1 } }
				}),
				"continue_reply"
			)
		).toBe(false)
	})

	test("Anthropic's row is present, off, and marked Assumed rather than decided", () => {
		// Declared `{unproven: true, until: "none"}` and not defaulted: the
		// Messages API prefills, and whether the MODEL accepts one is per-model
		// (Claude 4.6 and later return a 400). An untested connection must not
		// look authoritative about it.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.ANTHROPIC,
			capabilities: { resolved: { wire_chat: 1 } }
		})
		const row = find(view, "continue_reply")
		expect(row.on).toBe(false)
		expect(row.assumed).toBe(true)
	})

	test("switched on by hand, Anthropic's row reads On and stays uncontested", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.ANTHROPIC,
			capabilities: {
				overrides: { continue_reply: 1 },
				resolved: { continue_reply: 1, wire_chat: 1 }
			}
		})
		const row = find(view, "continue_reply")
		expect(row.state).toBe("on")
		expect(row.on).toBe(true)
		expect(row.contested).toBe(false)
	})
})

describe("a cache written before the capability existed", () => {
	/**
	 * What KOBOLDCPP's manifest declared BEFORE `continue_reply` landed — which
	 * is exactly what the column holds on every upgrading install, since
	 * `capabilities.resolved` is a cache rewritten only by a test or a save.
	 *
	 * `wire_chat` is absent because these rows also carry `overrides.wire_chat:
	 * false` below: a defaulted key missing from the cache with nothing having
	 * switched it off is a column state no rewrite could produce, and a fixture
	 * asserting one would be testing an install that cannot exist.
	 */
	const BEFORE_CONTINUE = {
		"text->text": 1,
		grammar: 1,
		tools: 1,
		streaming: 1,
		wire_completion: 1
	}

	test("a key the cache never heard of resolves from the layers, not to Off", () => {
		// The reported defect. Reading silence as off left the row's chip saying
		// "Off" under a provenance line saying "On by default for this connection
		// type" — a row contradicting itself, on every connection, until each one
		// happened to be tested or saved again. Meanwhile every server-side
		// answer resolved live and said the opposite.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: BEFORE_CONTINUE,
				overrides: { wire_chat: false }
			}
		})
		const row = find(view, "continue_reply")
		expect(row.on).toBe(true)
		expect(row.grade).toBe(1)
		expect(row.stateLabel).toBe("On")
	})

	test("...and the provenance names the layer that decided it, never a test that never asked", () => {
		// The honesty half. A filled key is decided by the adapter's defaults or
		// a preset, and saying "the backend reported this" about a question the
		// probe was never asked would be a fresh untruth in the panel that exists
		// to remove them.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: BEFORE_CONTINUE,
				overrides: { wire_chat: false },
				// A real probe from before the key existed: it answered the two
				// questions the adapter declared probed, and this was not one.
				probe: {
					found: { "text->image": 0, "text+image->text": 0 },
					at: "2026-01-01T00:00:00.000Z"
				}
			}
		})
		const row = find(view, "continue_reply")
		// The pairing is the assertion: the grade came from a layer, and the
		// sentence under it names that layer. Either half alone was already true
		// before the fill — which is how the row came to contradict itself.
		expect(row.on).toBe(true)
		expect(row.decidedBy).toBe("default")
		expect(row.provenance).toBe("On by default for this connection type.")
		expect(row.provenance).not.toMatch(/tested/i)
		// Declared outright rather than unproven: nothing here is an assumption.
		expect(row.assumed).toBe(false)
	})

	test("a stored override still wins over the fill — an explicit off stays off", () => {
		// Layer 4 is read from the same column the cache lives in, so the fill
		// cannot outrank it. If it could, switching a capability off would come
		// back on by itself on the next render.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: BEFORE_CONTINUE,
				overrides: { wire_chat: false, continue_reply: false }
			}
		})
		const row = find(view, "continue_reply")
		expect(row.state).toBe("off")
		expect(row.on).toBe(false)
		expect(row.grade).toBe(0)
		expect(row.decidedBy).toBe("override")
		expect(row.provenance).toBe("You switched this off.")
		expect(row.contested).toBe(false)
	})

	test("an override switched ON is no longer contested by a cache that predates the key", () => {
		// Before the fill this read `on: false` with "Off anyway: this connection
		// type has no way to express it" — printed under a switch the person had
		// just moved, about a capability KOBOLDCPP declares `native`.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: BEFORE_CONTINUE,
				overrides: { wire_chat: false, continue_reply: 1 }
			}
		})
		const row = find(view, "continue_reply")
		expect(row.state).toBe("on")
		expect(row.on).toBe(true)
		expect(row.contested).toBe(false)
	})

	test("the fill does not outrank the wire: a filled key still reads Off where the wire cannot carry it", () => {
		// Both wire modes on, so the tie-break sends this as chat, and KOBOLDCPP
		// continues only in completion. The row must stay Off — and now it says
		// WHY, which is the difference: an unfilled key was silently off with
		// nothing to read.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { ...BEFORE_CONTINUE, wire_chat: 1 } }
		})
		const row = find(view, "continue_reply")
		expect(row.on).toBe(false)
		expect(row.derived).toContain("Chat messages")
		expect(row.derived).toContain("Text completion")
	})

	test("the preset layer speaks in the fill, and is credited for it", () => {
		// All four layers, not just the adapter's defaults: OPENAI declares
		// `json_schema` probed and the `openai-official` preset asserts it, so a
		// column written before that assertion must show the preset's answer and
		// name the preset for it.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI,
			preset: "openai-official",
			capabilities: {
				resolved: {
					"text->text": 1,
					json_object: 1,
					tools: 1,
					streaming: 1,
					wire_chat: 1
				},
				probe: {
					found: { "text+image->text": 1 },
					at: "2026-01-01T00:00:00.000Z"
				}
			}
		})
		const row = find(view, "json_schema")
		expect(row.on).toBe(true)
		expect(row.decidedBy).toBe("preset")
		expect(row.provenance).toMatch(/preset sets this/)
	})

	test("the fill grants nothing the layers do not: an unproven, undefaulted key stays off", () => {
		// ANTHROPIC declares `continue_reply` unproven and does not default it —
		// the API prefills, and whether the MODEL accepts one is per-model. A
		// fill that read "declared" as "on" would promise a 400.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.ANTHROPIC,
			capabilities: { resolved: { "text->text": 1, wire_chat: 1 } }
		})
		const row = find(view, "continue_reply")
		expect(row.on).toBe(false)
		expect(row.assumed).toBe(true)
		expect(row.decidedBy).toBe("adapter")
	})

	test("a key the cache DOES name is shown as given, never re-resolved", () => {
		// The fill reads SILENCE only. KOBOLDCPP declares `text->image` unproven
		// and does not default it, so a live resolution of this row would answer
		// 0 — and correcting the stored answer out from under the panel is the
		// prediction the module header forbids.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { ...BEFORE_CONTINUE, "text->image": 1 }
			}
		})
		expect(find(view, "text->image").on).toBe(true)
		expect(find(view, "text->image").grade).toBe(1)
	})
})
