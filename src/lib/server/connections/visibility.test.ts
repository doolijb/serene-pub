/**
 * The projection itself: what it removes, what it must not touch, and the two
 * properties the boundary depends on.
 *
 * The rule these pin is the user's, verbatim: "Connections must be invisible,
 * unmuteable and unchooseable to non-admins." Invisible is the one tested here
 * — the other two are enforced at the seams that read this module, and are
 * pinned where they live (`reviewGate.connectionVisibility.test.ts`,
 * `sessions.connectionChoice.int.test.ts`).
 */

import { describe, it, expect } from "vitest"
import {
	CONNECTION_IDENTITY_KEYS,
	CONNECTION_REFUSAL,
	ComposedError,
	connectionIdentity,
	connectionsVisibleTo,
	namesAConnection,
	redactConnections,
	withoutConnectionIdentity
} from "./visibility"

const admin = { isAdmin: true }
const user = { isAdmin: false }

/** A run receipt as `pipelines:run` serves it — the connection is three deep. */
const receipt = () => ({
	runId: "r-1",
	outcome: "ok",
	preview: {
		atNode: "generate",
		connection: { id: 7, kind: "text", contextLength: 8192 }
	},
	nodes: [
		{
			nodeKey: "generate",
			input: {
				prompt: "hello",
				connection: {
					id: 7,
					kind: "text",
					metadata: { model: "llama-3-8b" }
				},
				sampling: { temperature: 0.8 }
			}
		}
	]
})

describe("what a non-admin receives", () => {
	it("carries no connection at any depth of a run receipt", () => {
		const seen = redactConnections(receipt(), user)
		expect(seen.preview).not.toHaveProperty("connection")
		expect(seen.nodes[0]!.input).not.toHaveProperty("connection")
		// Everything the receipt is FOR is still there — this is a redaction,
		// not a refusal to answer.
		expect(seen.preview.atNode).toBe("generate")
		expect(seen.nodes[0]!.input.prompt).toBe("hello")
		expect(seen.nodes[0]!.input.sampling).toEqual({ temperature: 0.8 })
	})

	it("carries no record of what an adapter put on the wire", () => {
		// The exchange names the base URL, the model and the body the
		// administrator's compute was sent. `stops` and `structured` are the
		// reader's own account of their own reply and stay.
		const seen = redactConnections(
			{
				nodes: [
					{
						nodeKey: "generate",
						output: {
							text: "Hello there",
							wire: {
								request: {
									url: "http://192.168.1.50:5001/api/v1/generate",
									method: "POST",
									body: { model: "some-model-q4" }
								},
								response: { raw: "Hello there" },
								redacted: []
							},
							stops: { sent: [], dropped: [] },
							structured: { mode: "schema" }
						}
					}
				]
			},
			user
		)
		const output = seen.nodes[0]!.output as Record<string, unknown>
		expect(output).not.toHaveProperty("wire")
		expect(JSON.stringify(seen)).not.toContain("192.168.1.50")
		expect(output.text).toBe("Hello there")
		expect(output.stops).toEqual({ sent: [], dropped: [] })
		expect(output.structured).toEqual({ mode: "schema" })
	})

	it("leaves a receipt's pinned portrayals exactly as pinned (U5a)", () => {
		// Who portrays whom names members and characters — the audience of
		// the session's own member list — and never a connection. Nothing in
		// the map spells an identity key, so the projection passes it
		// untouched for the non-admin whose run it is.
		const portrayals = {
			owner: { by: "person", userId: "3" },
			"run-owner": { by: "person", userId: "3" },
			"character:12": { by: "ai" },
			"character:7": { by: "person", userId: "5" },
			"user:9": { by: "none" },
			"envoy:mascot": { by: "ai" }
		}
		const seen = redactConnections({ ...receipt(), portrayals }, user)
		expect(seen.portrayals).toEqual(portrayals)
		expect(withoutConnectionIdentity({ portrayals }).portrayals).toEqual(
			portrayals
		)
		// The same receipt still loses its connection three deep.
		expect(seen.preview).not.toHaveProperty("connection")
	})

	it("has no id to guess with — not from a session, a default, or a list", () => {
		const seen = redactConnections(
			{
				session: { id: 3, name: "A walk", connectionId: 12 },
				capabilityDefaults: {
					"text->text": { connectionId: 12, samplingConfigId: 4 }
				},
				connections: [{ id: 12, name: "Studio", model: "llama" }],
				systemSettings: { activeEmbeddingConnectionId: 12 }
			},
			user
		)
		expect(JSON.stringify(seen)).not.toContain("12")
		// The sampling half of a capability default is not connection
		// identity and must survive — the sampling sidebar reads it.
		expect(seen.capabilityDefaults["text->text"]).toEqual({
			samplingConfigId: 4
		})
		expect(seen.session).toEqual({ id: 3, name: "A walk" })
	})
})

describe("what an admin receives", () => {
	it("is exactly what they received before — the same object, untouched", () => {
		const full = receipt()
		expect(redactConnections(full, admin)).toBe(full)
		expect(full.nodes[0]!.input.connection.id).toBe(7)
	})

	it("includes a single-user install, whose fallback user is an admin", () => {
		// `sockets/auth.ts` attaches the first ADMIN user when accounts are
		// disabled, so the posture that must not regress cannot reach the
		// redacting branch at all.
		expect(connectionsVisibleTo({ isAdmin: true })).toBe(true)
		expect(connectionsVisibleTo({ isAdmin: false })).toBe(false)
		expect(connectionsVisibleTo(undefined)).toBe(false)
		expect(connectionsVisibleTo({})).toBe(false)
	})
})

describe("the projection is cheap and total", () => {
	it("returns the very same object when there was nothing to hide", () => {
		// The property the broadcast path depends on: a per-chunk message row
		// costs one walk and no admin lookup, because identity is absent.
		const message = { id: 4, content: "hi", meta: { tokens: 3 } }
		expect(withoutConnectionIdentity(message)).toBe(message)
		expect(withoutConnectionIdentity(message).meta).toBe(message.meta)
	})

	it("rebuilds only the path down to what it removed", () => {
		const kept = { deep: true }
		const payload = { kept, run: { connectionId: 1, other: kept } }
		const seen = withoutConnectionIdentity(payload)
		expect(seen).not.toBe(payload)
		expect(seen.kept).toBe(kept)
		expect(seen.run.other).toBe(kept)
	})

	it("leaves values that are not containers alone", () => {
		const when = new Date(0)
		const seen = withoutConnectionIdentity({
			when,
			bytes: Buffer.from("x"),
			nothing: null,
			connection: { id: 1 }
		}) as Record<string, unknown>
		expect(seen.when).toBe(when)
		expect(seen.nothing).toBeNull()
		expect(seen).not.toHaveProperty("connection")
	})

	it("survives a payload that reaches itself", () => {
		const cyclic: any = { connectionId: 1, nested: {} }
		cyclic.nested.back = cyclic
		expect(() => withoutConnectionIdentity(cyclic)).not.toThrow()
		expect(withoutConnectionIdentity(cyclic)).not.toHaveProperty(
			"connectionId"
		)
	})

	it("reaches into arrays, which is where lists of runs live", () => {
		const seen = withoutConnectionIdentity([
			{ runId: "a", connectionId: 1 },
			{ runId: "b" }
		])
		expect(seen).toEqual([{ runId: "a" }, { runId: "b" }])
	})
})

describe("the refusal tells nobody anything", () => {
	it("is one sentence, and names no connection", () => {
		expect(CONNECTION_REFUSAL).toMatch(/stays? with the administrator/i)
		expect(CONNECTION_REFUSAL).not.toMatch(/\bnot found\b|\bno such\b/i)
		// Nothing in it varies with the id, so an id that exists and one that
		// never did produce the identical answer.
		expect(CONNECTION_REFUSAL).not.toMatch(/\d/)
	})
})

// A session names no connection, so there is no fixed-shape write left to
// guard; what a non-admin may still not do is submit one through a FORM,
// which is the block below.

describe("a form submission that names a connection", () => {
	it("is an attempt whatever the value, because the field was never shown", () => {
		expect(namesAConnection({ prompt: "x" })).toBe(false)
		expect(namesAConnection({ prompt: "x", connection: "{}" })).toBe(true)
		expect(namesAConnection({ connectionId: null })).toBe(true)
		expect(namesAConnection(undefined)).toBe(false)
	})
})

describe("the key list", () => {
	it("names every spelling the wire uses for a connection", () => {
		// A regression guard rather than a tautology: each of these was found
		// on a payload reaching a non-admin during the 0.6 audit, and dropping
		// one from the set silently reopens that surface.
		for (const key of [
			"connection",
			"connections",
			"connectionId",
			"connectionName",
			"connectionScripts",
			"activeConnection",
			"activeEmbeddingConnectionId"
		])
			expect(CONNECTION_IDENTITY_KEYS.has(key)).toBe(true)
	})
})

describe("identity that would otherwise be spelled into a sentence", () => {
	/**
	 * The second half of the rule, and the one a key-shaped projection cannot
	 * reach on its own: `"KoboldCPP API error at http://…: model 'x' not
	 * loaded"` names a connection as surely as a field does. The answer is not a
	 * text-shaped rule beside this one — it is to keep identity OUT of the
	 * sentence, so the same key, walked by the same code, removes it.
	 */
	const row = {
		id: 7,
		name: "Studio",
		model: "/home/admin/models/sd-1.5.safetensors",
		type: "a1111"
	}

	it("gathers a whole row so a caller cannot forget a field", () => {
		expect(connectionIdentity(row)).toEqual({
			id: 7,
			name: "Studio",
			model: "/home/admin/models/sd-1.5.safetensors",
			type: "a1111"
		})
		// A service's own words are identity written by somebody else — they
		// name the base URL and the model path — so they go INSIDE the bag,
		// where one walk removes them along with everything around them.
		expect(
			connectionIdentity(row, "HTTP 401 at http://10.0.0.4").detail
		).toBe("HTTP 401 at http://10.0.0.4")
	})

	it("leaves a non-admin a payload with nothing of the connection in it", () => {
		const payload = {
			message: "Loading the image model…",
			connection: connectionIdentity(row, "HTTP 401 at http://10.0.0.4")
		}
		const seen = redactConnections(payload, user)
		expect(seen).toEqual({ message: "Loading the image model…" })
		expect(JSON.stringify(seen)).not.toContain("10.0.0.4")
		expect(JSON.stringify(seen)).not.toContain("safetensors")
		// The same payload, untouched, for the person it belongs to.
		expect(redactConnections(payload, admin)).toBe(payload)
	})
})

describe("an error whose words are ours", () => {
	/**
	 * The distinction `persistGenerationErrorRow` keys on: a sentence this
	 * codebase composed names no connection and may be stored and shown as
	 * written, while a service's does neither. It is a TYPE rather than a flag
	 * on the string because there is no way to tell the two apart by looking.
	 */
	it("is an Error, so every existing catch still sees one", () => {
		const err = new ComposedError("the run stopped")
		expect(err).toBeInstanceOf(Error)
		expect(err.message).toBe("the run stopped")
		// `name` is deliberately untouched: `friendlyErrorFromUnknown` falls
		// back to it for the code shown beside a failed message.
		expect(err.name).toBe("Error")
	})

	it("carries the identity it was about as a field, never in the message", () => {
		const err = new ComposedError(
			"This connection cannot do Image generation.",
			connectionIdentity({ id: 7, name: "Studio" })
		)
		expect(err.message).not.toContain("Studio")
		expect(err.connection).toMatchObject({ id: 7, name: "Studio" })
		expect(
			redactConnections(
				{ error: err.message, connection: err.connection },
				user
			)
		).toEqual({ error: "This connection cannot do Image generation." })
	})

	it("is not something an unmarked error can be mistaken for", () => {
		// Unmarked is unsafe, and forgetting the marker costs a duller sentence
		// rather than a leak — the only direction this default can fail in.
		expect(
			new Error("KoboldCPP API error at http://10.0.0.4")
		).not.toBeInstanceOf(ComposedError)
	})
})
