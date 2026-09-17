/**
 * The chain, pinned.
 *
 * Two things are being held still here, and only one of them is about code.
 *
 * The first is the ORDER. `RESOLUTION_TIERS` and the executor's `SCOPE_ORDER`
 * are two expressions of one precedence, maintained in two repositories, and a
 * silent disagreement between them would mean a person's pick is honoured on the
 * pipeline path and ignored on the summarize path — with every screen agreeing
 * with them. So the tiers are walked and their scope positions are asserted to
 * move strictly one way. That test fails if someone reorders either list.
 *
 * The second is the RULING: nothing is chosen because it exists. That failure is
 * silent by construction — a run that quietly picks the only connection lying
 * around looks exactly like a run that was configured — so it is asserted with a
 * capable, saved, perfectly usable connection sitting in the table and nothing
 * registered, which must still refuse.
 *
 * ## The fake db
 *
 * Two tables and an id, so `eq()` is mocked to capture the value it was built
 * with (the same trick `dispatchImage.int.test.ts` uses, and for the same
 * reason: a drizzle predicate is opaque from out here). A real PGlite instance
 * would cost 30 seconds to assert three string comparisons and a walk over a
 * constant.
 *
 * It is asserted to `Db` at the one place it is built. The resolver takes the
 * real schema-typed handle now, and four chained builder calls returning canned
 * arrays cannot structurally be one — but the assertion is a fixture's, made
 * once, in a test file, and it does not travel: the module under test is
 * checked against the real schema regardless of what this hands it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { SCOPE_ORDER } from "@serene-pub/sdk"
import { transformIdOf } from "$lib/shared/capabilities/sides"

/** Captured as the predicate is built; this file only looks rows up by key. */
let lastWhereValue: unknown
/**
 * The last TWO, as a sliding window, for `connection_defaults`.
 *
 * Its key is `(input, output)` since 0183, so its lookup builds two equalities
 * where every other read here builds one — `and(eq(input, …), eq(output, …))`,
 * in that order. The fixture map below is still keyed by the transform ID,
 * because that is what the resolver asks for and what a reader of this file
 * recognises; the pair is put back together with the app's own `transformIdOf`.
 */
let lastWherePair: [unknown, unknown] = [undefined, undefined]

vi.mock("drizzle-orm", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		eq: (col: any, value: any) => {
			lastWhereValue = value
			lastWherePair = [lastWherePair[1], value]
			return actual.eq(col, value)
		}
	}
})

const tableName = (t: any): string =>
	t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? ""

let connections: Record<number, any> = {}
let connectionModels: Record<number, any> = {}
let samplingConfigs: Record<number, any> = {}
let connectionDefaults: Record<string, any> = {}

const db = {
	select: () => ({
		from: (table: any) => ({
			where: () => ({
				limit: async () => {
					const name = tableName(table)
					if (name === "connections") {
						const row = connections[lastWhereValue as number]
						return row ? [row] : []
					}
					if (name === "connection_models") {
						const row = connectionModels[lastWhereValue as number]
						return row ? [row] : []
					}
					if (name === "sampling_configs") {
						const row = samplingConfigs[lastWhereValue as number]
						return row ? [row] : []
					}
					if (name === "connection_defaults") {
						const [input, output] = lastWherePair as [
							string,
							string
						]
						const row =
							connectionDefaults[transformIdOf({ input, output })]
						return row ? [row] : []
					}
					return []
				}
			})
		})
	})
} as unknown as Db

/**
 * A saved, capable, entirely usable text connection.
 *
 * `capabilities: {}` is the UNDETERMINED state — a row nobody has probed — which
 * `capabilityGuard` judges by modality, so this passes the guard. That is
 * deliberate: the point of the no-pickup tests is that a connection which would
 * work is still not chosen, and a row that failed the guard would prove nothing.
 */
const textConnection = {
	id: 1,
	name: "Local Ollama",
	type: "ollama",
	capabilities: {}
}

/** The same, so "there are two capable ones" is expressible. */
const secondTextConnection = {
	id: 3,
	name: "Spare Ollama",
	type: "ollama",
	capabilities: {}
}

/**
 * Switched OFF for chat by a person, which outranks every probe.
 *
 * An explicit `false` override rather than an image TYPE, because the guard's
 * emptiness fallback would let an untested image row through on modality alone —
 * and this test is about the refusal, not about that fallback.
 */
const refusedConnection = {
	id: 2,
	name: "Drawing Only",
	type: "ollama",
	capabilities: { overrides: { "text->text": false } }
}

/**
 * One model on each endpoint, because a selection is a PAIR and an endpoint on
 * its own is an incomplete one. Numbered `10 * connectionId` so a reader can
 * tell at a glance which endpoint a model belongs to.
 */
const modelOn = (connectionId: number) => ({
	id: connectionId * 10,
	connectionId,
	model: `model-${connectionId}`,
	name: `Model ${connectionId}`,
	enabled: true,
	missingSince: null,
	capabilities: null
})

/** The pair for an endpoint, spread into a tier's candidate. */
const pair = (connectionId: number) => ({
	connectionId,
	connectionModelId: modelOn(connectionId).id
})

const samplingA = { id: 10, name: "Creative", shape: "core:shape/text-gen@1" }
const samplingB = { id: 11, name: "Precise", shape: "core:shape/text-gen@1" }

const load = async () => await import("./capabilityTarget")

beforeEach(() => {
	vi.resetModules()
	lastWhereValue = undefined
	lastWherePair = [undefined, undefined]
	connections = {
		1: textConnection,
		2: refusedConnection,
		3: secondTextConnection
	}
	connectionModels = {
		10: modelOn(1),
		20: modelOn(2),
		30: modelOn(3)
	}
	samplingConfigs = { 10: samplingA, 11: samplingB }
	connectionDefaults = {}
})

describe("the chain and the executor's scopes agree about order", () => {
	it("every tier maps to a scope the executor actually resolves", async () => {
		const { RESOLUTION_TIERS, SCOPE_FOR_TIER } = await load()
		for (const tier of RESOLUTION_TIERS)
			expect(
				SCOPE_ORDER.includes(SCOPE_FOR_TIER[tier]),
				`${tier} maps to "${SCOPE_FOR_TIER[tier]}", which is not in SCOPE_ORDER — ` +
					`the executor would never resolve a value written at that scope.`
			).toBe(true)
	})

	it("SCOPE_ORDER position falls strictly as precedence rises", async () => {
		const { RESOLUTION_TIERS, scopeIndexForTier } = await load()
		// SCOPE_ORDER is highest-precedence-FIRST (`session` at 0) while
		// RESOLUTION_TIERS is lowest-precedence-first, so the indices must
		// decrease. Strictly: two tiers sharing a scope would resolve in
		// whichever order the overrides array happened to be built in, which is
		// exactly the D7 inversion — a session's own column outranking a
		// session-scope override because it was pushed first.
		const positions = RESOLUTION_TIERS.map(scopeIndexForTier)
		for (let i = 1; i < positions.length; i++)
			expect(
				positions[i],
				`${RESOLUTION_TIERS[i]} (scope index ${positions[i]}) must outrank ` +
					`${RESOLUTION_TIERS[i - 1]} (scope index ${positions[i - 1]}).`
			).toBeLessThan(positions[i - 1])
	})

	it("the chain is exactly the three tiers the ruling names", async () => {
		const { RESOLUTION_TIERS } = await load()
		// Pinned by value, not by length. A fourth tier is the thing this whole
		// change exists to delete — `dispatch.ts`'s `?? defaultSampling` and
		// `scenes.ts`'s `?? connection` were each one, and each was invisible
		// until the two sides stopped reading the same column.
		expect([...RESOLUTION_TIERS]).toEqual([
			"capabilityDefault",
			"pipelineConfig",
			"sessionOverride"
		])
	})

	it("a PAIR is two tiers, and a session is not one of them", async () => {
		const { PAIR_TIERS } = await load()
		// The 2026-09-15 ruling, pinned as data: "the session-level connection
		// override is retired. Overrides are always by model, never by
		// connection." Three tiers still walk SAMPLING — `sessions
		// .sampling_config_id` stays — so the length of the list above is not
		// what says this, and pinning it there would go green the moment
		// somebody re-added an endpoint to the session tier.
		expect([...PAIR_TIERS]).toEqual(["capabilityDefault", "pipelineConfig"])
	})

	it("no refusal can send anybody to a session to set a connection", async () => {
		// The sentences are built from `WHERE_SET`, which is keyed by `PairTier`
		// — so this is the type system's rule read back out at run time. It went
		// unpinned before because there WAS a session entry and it was correct.
		const mod = await load()
		const res = await mod.resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: { connectionId: 404 }
		})
		if (res.ok) throw new Error("expected a refusal")
		expect(res.problem.message).not.toMatch(/session/i)
	})
})

describe("nothing is chosen because it merely exists", () => {
	it("refuses with a capable connection saved and nothing registered", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("unset")
		// The compensation, asserted: deleting the auto-star turns "quietly uses
		// the connection you have" into "fails on first Send", and a refusal
		// that does not say where to go reads as a regression.
		expect(res.problem.message).toContain("Admin → Defaults")
	})

	it("refuses even when there is exactly ONE connection on the instance", async () => {
		// The single-connection shortcut, which is the most tempting of the
		// eleven implicit pickups: with one row saved, "the default" and "the
		// only one" are the same connection every time somebody tests it, and
		// the shortcut looks free right up until a second row appears.
		const { resolveCapabilityTarget } = await load()
		connections = { 1: textConnection }

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(false)
		if (!res.ok) expect(res.problem.kind).toBe("unset")
	})

	it("registering the default is what makes it run", async () => {
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			...pair(1),
			samplingConfigId: 10
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.id).toBe(1)
		// The identifier that goes on the wire is the MODEL's, merged onto the
		// endpoint row — registering an endpoint alone resolves as unconfigured.
		expect(res.connection.model).toBe("model-1")
		expect(res.sampling?.id).toBe(10)
		expect(res.connectionVia).toBe("capabilityDefault")
	})
})

describe("precedence: later tier wins", () => {
	beforeEach(() => {
		connectionDefaults["text->text"] = {
			capability: "text->text",
			...pair(1),
			samplingConfigId: 10
		}
	})

	it("the pipeline config outranks the capability default", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: pair(3)
		})

		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.id).toBe(3)
		expect(res.connection.model).toBe("model-3")
		expect(res.connectionVia).toBe("pipelineConfig")
		// The half the pipeline did NOT set still comes from below it — the two
		// halves are walked independently, so naming a connection does not clear
		// the instance's sampling profile.
		expect(res.sampling?.id).toBe(10)
		expect(res.samplingVia).toBe("capabilityDefault")
	})

	it("a session's sampling rides ON TOP of the pipeline config's pair", async () => {
		// THE retirement, from the resolver's side (0130). The session used to
		// be a whole candidate and it outranked everything: naming a sampling
		// profile here also decided, by being the winning tier, which connection
		// the run went to. Now the two halves come from two different tiers at
		// once — which they could not before, because the session either won
		// both or was not consulted at all.
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: { ...pair(3), samplingConfigId: 10 },
			sessionSampling: 11
		})

		expect(res.ok).toBe(true)
		if (!res.ok) return
		// The pipeline config's pair, unmoved by the session above it.
		expect(res.connection.id).toBe(3)
		expect(res.connection.model).toBe("model-3")
		expect(res.connectionVia).toBe("pipelineConfig")
		// And the session's sampling, which outranks the config's own.
		expect(res.sampling?.id).toBe(11)
		expect(res.samplingVia).toBe("sessionOverride")
	})

	it("a session that chooses no sampling leaves the tier below it alone", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: { ...pair(3), samplingConfigId: 10 },
			// What a session with nothing set hands over. `null` is "said
			// nothing", never "said none" — the same reading every other tier
			// gets, and reading it otherwise would make clearing a session's
			// sampling override silently disable the config's too.
			sessionSampling: null
		})

		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.sampling?.id).toBe(10)
		expect(res.samplingVia).toBe("pipelineConfig")
	})

	it("a tier that says nothing does not clear the tier below it", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			// Explicit nulls, which is what a cleared slot looks like coming out
			// of the config layer. `null` means "this tier said nothing", never
			// "this tier said none" — a slot cannot express the latter, and
			// reading it that way would make clearing an override fatal.
			pipelineConfig: { connectionId: null, samplingConfigId: null },
			sessionSampling: null
		})

		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.id).toBe(1)
		expect(res.connectionVia).toBe("capabilityDefault")
	})
})

describe("the model half of the pair", () => {
	beforeEach(() => {
		connectionDefaults["text->text"] = {
			capability: "text->text",
			...pair(1),
			samplingConfigId: 10
		}
	})

	it("refuses a registration that names only an endpoint", async () => {
		// Connections have no default model, so there is nothing to fall back
		// to and nothing is guessed. The sentence carries the fix.
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			connectionId: 1,
			connectionModelId: null,
			samplingConfigId: 10
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("model")
		expect(res.problem.via).toBe("capabilityDefault")
		expect(res.problem.message).toMatch(/Pick a model on that connection/)
	})

	it("keeps the model when a higher tier re-states the SAME endpoint", async () => {
		// A great deal of stored configuration names an endpoint and no model:
		// a slot value authored before the split, the executor handing the
		// instance default's own id down as tier 2, the legacy per-config
		// override columns. The endpoint did not change, so both halves still
		// name one connection and the choice below stands.
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: { connectionId: 1 }
		})

		expect(res.ok, JSON.stringify((res as any).problem)).toBe(true)
		if (!res.ok) return
		expect(res.connection.model).toBe("model-1")
		expect(res.connectionVia).toBe("pipelineConfig")
	})

	it("clears it when a higher tier names a DIFFERENT endpoint", async () => {
		// The hazard the reset exists for: a model row belongs to one endpoint,
		// so carrying model-1 onto connection 3 would build a pair whose halves
		// name two connections. Refused, with the fix, rather than run.
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: { connectionId: 3 }
		})

		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("model")
		expect(res.problem.via).toBe("pipelineConfig")
	})

	it("refuses a model that belongs to another connection", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: { connectionId: 3, connectionModelId: 10 }
		})

		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("model")
		expect(res.problem.message).toMatch(/belongs to a different connection/)
	})

	it("refuses a model its host has stopped listing", async () => {
		const { resolveCapabilityTarget } = await load()
		connectionModels[10] = { ...modelOn(1), missingSince: new Date() }

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("model")
		expect(res.problem.message).toMatch(/no longer listed by its host/)
	})

	it("judges the model BEFORE the capability, as `connections:setDefault` does", async () => {
		// What a pair can DO is the model's answer layered over the endpoint's,
		// so there is nothing to judge until the model is in hand — one host
		// serves a vision checkpoint and a text-only one at the same base URL.
		// A connection that cannot chat AND names no model therefore reports
		// the missing half, which is also the half a person fixes first.
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			connectionId: 2,
			connectionModelId: null,
			samplingConfigId: null
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("model")
	})
})

describe("the five refusals", () => {
	it("unset — no row at all", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->image"
		})
		expect(res.ok).toBe(false)
		if (!res.ok) expect(res.problem.kind).toBe("unset")
	})

	it("cleared — a row with a sampling half and no connection", async () => {
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			connectionId: null,
			samplingConfigId: 10
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.problem.kind).toBe("cleared")
			expect(res.problem.message).toContain("Admin → Defaults")
		}
	})

	it("cleared says 'Chat' by default, and for a standard-genre session, but 'text generation' for any other genre — wording only", async () => {
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			connectionId: null,
			samplingConfigId: 10
		}

		// No genre given at all (an admin-facing caller, e.g. Defaults itself):
		// unaffected, still "Chat" — the transform's own label.
		const noGenre = await resolveCapabilityTarget(db, { capability: "text->text" })
		if (noGenre.ok) throw new Error("expected a refusal")
		expect(noGenre.problem.message).toContain("No connection is set for Chat.")

		// A session actually on the standard chat genre: "Chat" is the truth,
		// not a misnomer, so it stays.
		const standard = await resolveCapabilityTarget(db, {
			capability: "text->text",
			genreId: "core:genre/chat"
		})
		if (standard.ok) throw new Error("expected a refusal")
		expect(standard.problem.message).toContain("No connection is set for Chat.")

		// A session on any other genre: "Chat" would read as if it named the
		// session's own genre, so the wording steps around it.
		const other = await resolveCapabilityTarget(db, {
			capability: "text->text",
			genreId: "acme:genre/lodge"
		})
		if (other.ok) throw new Error("expected a refusal")
		expect(other.problem.message).toContain(
			"No connection is set for text generation."
		)
		expect(other.problem.message).not.toContain("Chat")
		// Nothing else about the sentence moves.
		expect(other.problem.message).toContain(
			"Choose one in Admin → Defaults — a connection is never picked " +
				"automatically, and deleting one releases every capability it held."
		)

		// A non-text capability's label already names what it does — no genre
		// can make "Image generation" ambiguous, so it is left alone.
		const image = await resolveCapabilityTarget(db, {
			capability: "text->image",
			genreId: "acme:genre/lodge"
		})
		if (image.ok) throw new Error("expected a refusal")
		expect(image.problem.message).toContain("Image generation")
	})

	it("cleared does not DIAGNOSE a deletion, because a fresh install lands here", async () => {
		// The state above is reachable two ways, and the sentence has to be true
		// of both. `connection_defaults.connection_id` is ON DELETE SET NULL, so
		// deleting a connection releases every capability it held — that is one.
		// The other is a completely fresh install: `db/defaults.ts` seeds the
		// shipped SAMPLING default for `text->text` and `text->image` on every
		// boot while unset, and `setCapabilityDefault` INSERTS the row when
		// there is none, so both capabilities carry a null-connection row before
		// anybody has touched anything.
		//
		// This is pinned as its own test because the wording is the whole
		// finding: an earlier draft said "most likely the connection it pointed
		// at was deleted", which is a confident lie on first run and would have
		// sent a new user hunting for a connection they never had.
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			connectionId: null,
			samplingConfigId: 10
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		if (res.ok) throw new Error("expected a refusal")
		expect(res.problem.message).not.toMatch(/was cleared|was deleted/)
		expect(res.problem.message).toMatch(/never picked automatically/)
	})

	it("missing — the id names no row, and the sentence says which tier set it", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "text->text",
			pipelineConfig: { connectionId: 404 }
		})

		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.problem.kind).toBe("missing")
			expect(res.problem.via).toBe("pipelineConfig")
			expect(res.problem.connectionId).toBe(404)
			expect(res.problem.message).toContain(
				"the pipeline's configuration"
			)
		}
	})

	it("incapable — a connection that was chosen but cannot do it", async () => {
		const { resolveCapabilityTarget } = await load()
		// A COMPLETE pair, because the model half is judged first — see the
		// describe block below. An endpoint-only registration never reaches the
		// capability guard, and asserting `incapable` against one would be
		// asserting a refusal this resolver no longer produces for that input.
		connectionDefaults["text->text"] = {
			capability: "text->text",
			...pair(2),
			samplingConfigId: null
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.problem.kind).toBe("incapable")
			// The guard's own wording, which names the capability the way the
			// connection screen labelled it — never its id.
			expect(res.problem.message).toContain("Chat")
			expect(res.problem.message).toContain("Admin → Defaults")
			// ...and never the CONNECTION. This sentence ends up in
			// `Error.message` and in `Receipt.haltReason`, both plain strings
			// that no projection can reach into, and both of which a non-admin
			// reads. The identity rides beside it instead, under the one key
			// `withoutConnectionIdentity` removes.
			expect(res.problem.message).not.toContain("Drawing Only")
			expect(res.problem.connection).toMatchObject({
				id: 2,
				name: "Drawing Only",
				type: "ollama"
			})
		}
	})

	it("unknown — a capability no default could ever be keyed by", async () => {
		const { resolveCapabilityTarget } = await load()
		const res = await resolveCapabilityTarget(db, {
			capability: "strict_schema"
		})

		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.problem.kind).toBe("unknown")
			// A feature qualifies a request; it is not a thing a node goes
			// shopping for a connection to provide, and `connection_defaults`
			// registers transforms only. Reporting it as "nothing is set" would
			// send somebody to a screen that can never satisfy it.
			expect(res.problem.message).toMatch(/transform/)
		}
	})
})

describe("a missing sampling config is not a failure", () => {
	it("resolves with sampling null when no tier named one", async () => {
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			...pair(1),
			samplingConfigId: null
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		// `resolveSampling(null)` is "send nothing and let the backend use its
		// own defaults" — a working run, and the same thing the seeded
		// "Disabled" config expresses.
		expect(res.ok).toBe(true)
		if (res.ok) {
			expect(res.sampling).toBeNull()
			expect(res.samplingVia).toBeNull()
		}
	})

	it("degrades a DANGLING sampling id to null rather than refusing", async () => {
		const { resolveCapabilityTarget } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			...pair(1),
			samplingConfigId: 999
		}

		const res = await resolveCapabilityTarget(db, {
			capability: "text->text"
		})

		expect(res.ok).toBe(true)
		if (res.ok) expect(res.sampling).toBeNull()
	})
})

describe("capabilityIsSetUp", () => {
	it("is false while a capable connection sits unregistered", async () => {
		// The question it answers is "does this instance have this capability",
		// and under the ruling that means REGISTERED, not "something could do
		// it". A screen answering from capability would advertise the feature
		// and then fail on first use.
		const { capabilityIsSetUp } = await load()
		expect(await capabilityIsSetUp(db, "text->text")).toBe(false)
	})

	it("is false for a row whose connection was cleared", async () => {
		const { capabilityIsSetUp } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			connectionId: null,
			samplingConfigId: 10
		}
		expect(await capabilityIsSetUp(db, "text->text")).toBe(false)
	})

	it("is true once a connection is registered", async () => {
		const { capabilityIsSetUp } = await load()
		connectionDefaults["text->text"] = {
			capability: "text->text",
			connectionId: 1,
			samplingConfigId: null
		}
		expect(await capabilityIsSetUp(db, "text->text")).toBe(true)
	})
})
