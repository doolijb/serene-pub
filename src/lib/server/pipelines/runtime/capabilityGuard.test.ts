/**
 * The bind guard, and the one thing about it that fails silently.
 *
 * Everything here is about a CACHE OUTLIVING THE THING IT CACHES.
 * `connections.capabilities.resolved` is a stored collapse of the four
 * resolution layers, written at test time and at edit time. Withdrawing a key
 * from `ADAPTER_MANIFEST` stops resolution from ever GRANTING it again — and
 * does nothing whatever about the rows that were granted it before.
 *
 * That is not hypothetical. OPENAI declared `text->image` as `probed` and
 * the `openai-official` preset asserted it `true`, so every OpenAI connection
 * anyone tested resolved `text->image: 1` and wrote it to the row. Both
 * declarations are now gone — nothing implements `generateImage` for that type,
 * so the manifest cannot declare the key — but the cached `native` is still
 * sitting in the column. Read straight, it clears this guard, an image slot
 * accepts the connection, and `getImageAdapter` throws `No image adapter for
 * connection type` minutes later, in a stack that names none of this.
 *
 * `storedCapabilities` therefore INTERSECTS the cache with the live key space on
 * read, which makes the manifest authoritative at the point of use rather than
 * at the point of writing — and stays correct for every future key that is ever
 * withdrawn, which a one-time migration would not.
 *
 * ⚠ And the intersection has a guard of its own, which is the sharper hazard and
 * has its own test below: it must apply ONLY to a type some manifest entry
 * declares.
 */

import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { capabilityRefusal, storedCapabilities } from "./capabilityGuard"

// `Record<string, number>` rather than `CapabilitySet`, deliberately: the thing
// under test reads a loose JSON column, and a fixture typed as the strict set
// would not be able to express the stale keys these tests are about.
const row = (
	type: string,
	resolved?: Record<string, number>,
	name = "Test connection"
) => ({
	name,
	type,
	capabilities: resolved ? { resolved } : undefined
})

describe("a withdrawn capability cannot be revived by a stale cache", () => {
	test("an OpenAI row that already resolved text->image is refused for it", () => {
		// The exact live bug, in the state a real upgraded install is in: the row
		// was tested under the old declaration and the column still carries the
		// key at full grade.
		const stale = row(CONNECTION_TYPE.OPENAI, {
			"text->text": 1,
			"text->image": 1
		})
		expect(capabilityRefusal(stale, "text->image")).toMatch(
			/cannot do Image generation/i
		)
		// ...and it must still be usable for the thing it can actually do. A fix
		// that refused the whole row would be a worse bug than the one it replaced.
		expect(capabilityRefusal(stale, "text->text")).toBeNull()
	})

	test("the refusal names the capability the way the panel does, never its id", () => {
		// Somebody who switched "Image generation" off has no way to connect
		// `text->image` back to the toggle they touched.
		const message = capabilityRefusal(
			row(CONNECTION_TYPE.OPENAI, { "text->image": 1 }),
			"text->image"
		)
		expect(message).toContain("Image generation")
		expect(message).not.toContain("->")
	})

	test("the intersection drops keys, not grades", () => {
		// It is a KEY-SPACE gate. A declared key keeps whatever the four layers
		// resolved it to — clamping or upgrading a grade here would be this file
		// re-implementing resolution, which is the divergence the server-owned
		// column exists to prevent.
		const have = storedCapabilities(
			row(CONNECTION_TYPE.KOBOLDCPP, {
				"text->text": 1,
				tools: 1,
				"text->image": 1,
				// Declared by nothing since the actions landed: KoboldCPP reports the
				// flag over /api/extra/version, and no adapter implements embedText.
				"text->embedding": 1
			})
		)
		expect(have).toEqual({
			"text->text": 1,
			tools: 1,
			"text->image": 1
		})
	})
})

describe("⚠ the undeclared-type guard", () => {
	// Without `if (!declared) return cached`, intersecting a type no manifest
	// entry describes collapses it to `{}` — which the emptiness test below reads
	// as "nobody has determined this yet" and answers with the transitional
	// modality fallback. `persistCapabilities` guards the identical hazard with
	// the identical `declares` test; the comment there covers the other half.
	//
	// ⚠ The embedding types are no longer the worked example of an undeclared
	// type: they have manifest entries now, because a star is a
	// `connections:setDefault` and that judges every row with `capabilityRefusal`
	// — a type nothing declares can be granted nothing. What is asserted below is
	// therefore the intersection KEEPING a key the manifest does declare, which
	// is the same outcome by a different route, plus the modality half in the
	// suite above.
	const EMBEDDINGS_ROW = row("openai-embeddings", {
		"text->embedding": 1
	})

	test("a resolved embedding row keeps the key its manifest declares", () => {
		expect(storedCapabilities(EMBEDDINGS_ROW)).toEqual({
			"text->embedding": 1
		})
		expect(capabilityRefusal(EMBEDDINGS_ROW, "text->embedding")).toBeNull()
	})

	test("...and is still refused for chat, which is what the guard buys", () => {
		// THE REGRESSION NET, from the cached side: the row carries no
		// `text->text` and the manifest declares none, so there is nothing for the
		// intersection to keep and nothing for `satisfies` to grant.
		expect(capabilityRefusal(EMBEDDINGS_ROW, "text->text")).toMatch(
			/cannot do Chat/i
		)
	})

	test("local-onnx is the same row shape and gets the same answer", () => {
		const onnx = row("local-onnx", { "text->embedding": 1 })
		expect(capabilityRefusal(onnx, "text->embedding")).toBeNull()
		expect(capabilityRefusal(onnx, "text->text")).toMatch(/cannot do Chat/i)
	})
})

describe("⚠ an UNDETERMINED row is still judged by its modality", () => {
	/**
	 * The other half of the same hazard, and the one the embedding star opened.
	 *
	 * The rows above carry a backfilled cache, so the emptiness fallback is never
	 * reached. A row created by migration 0127 does NOT: the singleton projects
	 * into a connection with `capabilities = '{}'`, because SQL cannot run
	 * `resolveConnectionCapabilities`. With the embedding types now DECLARED in
	 * the manifest, `storedCapabilities` intersects that empty cache down to `{}`
	 * and the modality fallback takes over — and the fallback used to answer
	 * "yes" to every capability that is not `text->image`, which would make a
	 * freshly migrated embeddings connection starrable as the chat default.
	 *
	 * So the fallback now asks the section table: a capability that is SOME
	 * section's star belongs to that section's modality and to no other.
	 * Everything else keeps the old permissive answer, which an undetermined text
	 * row still depends on (vision, documents, speech).
	 */
	const undetermined = (type: string) => ({ name: "Fresh", type })

	test("an embeddings row nobody has resolved is not offered chat", () => {
		for (const type of [
			CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			CONNECTION_TYPE.OLLAMA_EMBEDDINGS
		]) {
			expect(storedCapabilities(undetermined(type))).toEqual({})
			expect(
				capabilityRefusal(undetermined(type), "text->text"),
				`${type} with no resolved set was offered the chat star.`
			).toMatch(/cannot do Chat/i)
			expect(
				capabilityRefusal(undetermined(type), "text->image")
			).toMatch(/cannot do/i)
			// And is accepted for the one thing it is for, which is what keeps
			// the migration's own star legal.
			expect(
				capabilityRefusal(undetermined(type), "text->embedding")
			).toBeNull()
		}
	})

	test("an undetermined text row is not offered the embedding star", () => {
		// The same rule from the other side. `OpenAIChatAdapter` implements no
		// `embedText`, so a chat endpoint registered for `text->embedding` would
		// resolve to a loader that throws.
		expect(
			capabilityRefusal(
				undetermined(CONNECTION_TYPE.OPENAI),
				"text->embedding"
			)
		).toMatch(/cannot do Embeddings/i)
	})

	test("...while every capability that is nobody's star stays permissive", () => {
		// The transitional behaviour this must not break: 0175 wrote an empty set
		// for every row it could not resolve, and refusing those outright would
		// break working setups on upgrade until each had been re-tested.
		const fresh = undetermined(CONNECTION_TYPE.OPENAI)
		expect(capabilityRefusal(fresh, "text+image->text")).toBeNull()
		expect(capabilityRefusal(fresh, "text->audio")).toBeNull()
		expect(capabilityRefusal(fresh, "tools")).toBeNull()
	})
})

describe("a row nothing has determined yet is judged the way it was before the column", () => {
	// Transitional and deliberate: 0175 wrote an empty set for every row it could
	// not resolve, and refusing those outright would break working setups on
	// upgrade until each had been re-tested. The emptiness stops the first time
	// something resolves the row.
	test("an untested text connection still answers chat", () => {
		expect(
			capabilityRefusal(row(CONNECTION_TYPE.KOBOLDCPP), "text->text")
		).toBeNull()
	})

	test("an untested text connection is still not an image connection", () => {
		expect(
			capabilityRefusal(row(CONNECTION_TYPE.KOBOLDCPP), "text->image")
		).toMatch(/cannot do Image generation/i)
	})

	test("an untested image connection answers image generation", () => {
		expect(
			capabilityRefusal(row(CONNECTION_TYPE.A1111), "text->image")
		).toBeNull()
	})

	test("a column with junk in place of an object is read as undetermined", () => {
		// The column is JSON and has been through two migrations; a reader that
		// threw on a shape it did not expect would take a session down over a
		// bookkeeping field.
		expect(
			storedCapabilities({
				type: CONNECTION_TYPE.KOBOLDCPP,
				capabilities: "not an object"
			})
		).toEqual({})
		expect(storedCapabilities({ type: CONNECTION_TYPE.KOBOLDCPP })).toEqual(
			{}
		)
	})
})

describe("the refusal names the capability and never the connection", () => {
	/**
	 * The rule this pins is the user's: "Connections must be invisible,
	 * unmuteable and unchooseable to non-admins."
	 *
	 * This one sentence used to open `"Studio" cannot do Image generation.` and
	 * feed six sinks, four of them reachable by somebody who is not an
	 * administrator — the draft preview's error, the three dispatch error
	 * classes, `receipt.haltReason`, the activity cards. It travels through
	 * `Error.message` and the SDK's `Receipt.haltReason`, both plain strings, so
	 * nothing downstream can take a name back out of it. The name is therefore
	 * never put in; the identity travels beside it as a field, and the
	 * projection that has always removed that key decides who is told.
	 */
	const STUDIO = {
		id: 7,
		name: "Studio",
		model: "sd-1.5",
		type: CONNECTION_TYPE.OPENAI,
		capabilities: { resolved: { "text->image": 1 } }
	}

	test("a non-admin reads a sentence, and learns nothing from it", async () => {
		const refusal = capabilityRefusal(STUDIO, "text->image")!
		expect(refusal).toBeTruthy()
		// Not blanked — it still says what is wrong and what to do about it.
		expect(refusal).toMatch(/cannot do Image generation/i)
		expect(refusal).toMatch(/choose one that can/i)
		// And it identifies nobody: not the name, not the id, not the model.
		expect(refusal).not.toContain("Studio")
		expect(refusal).not.toContain("sd-1.5")
		expect(refusal).not.toMatch(/\b7\b/)

		// The sentence is safe wherever it lands, which is the property that
		// matters: it goes on to be concatenated into larger strings and stored.
		const { redactConnections } = await import(
			"$lib/server/connections/visibility"
		)
		expect(
			JSON.stringify(
				redactConnections({ error: refusal }, { isAdmin: false })
			)
		).not.toContain("Studio")
	})

	test("an administrator gets the same sentence and the identity beside it", async () => {
		const { connectionIdentity, redactConnections } = await import(
			"$lib/server/connections/visibility"
		)
		const payload = {
			error: capabilityRefusal(STUDIO, "text->image"),
			connection: connectionIdentity(STUDIO)
		}

		const seenByAdmin = redactConnections(payload, { isAdmin: true })
		expect(seenByAdmin.connection).toMatchObject({
			id: 7,
			name: "Studio",
			model: "sd-1.5"
		})

		// Same payload, same rule, one place: the non-admin's copy has no
		// connection at all, and their sentence is unchanged by its absence.
		const seenByUser = redactConnections(payload, { isAdmin: false })
		expect(seenByUser).not.toHaveProperty("connection")
		expect(seenByUser.error).toBe(payload.error)
	})
})

describe("⚠ the panel's live fill stops at the display", () => {
	/**
	 * The other direction of the same staleness, and the boundary is deliberate.
	 *
	 * A cache written by an older build cannot name a capability that build had
	 * never heard of — `continue_reply` is exactly that — so the capability
	 * panel's row model resolves a DECLARED key its cache does not name through
	 * the four layers rather than reading silence as off
	 * (`shared/connectionAdapters/capabilityRows.ts`, `effectiveCapabilities`).
	 * This guard deliberately does not, and "make them agree" is the obvious next
	 * edit, so:
	 *
	 *   - it is handed `{type, capabilities}` and NO PRESET, so it cannot resolve
	 *     those four layers at all. Whatever it filled would be a poorer answer
	 *     wearing the same name, which is worse than the gap;
	 *   - it GRANTS where the panel displays. Filling here changes which
	 *     connections may run, and on a never-resolved row it would also take the
	 *     emptiness fallback above out of play — refusing setups that work today,
	 *     on upgrade, which is the thing that fallback exists to prevent.
	 *
	 * The cure for the gap is a WRITE path rewriting the column — `persistCapabilities`
	 * is its only writer — not a second, weaker live read here.
	 */
	test("a declared key the cache does not name is still absent here", () => {
		// `tools` is in KOBOLDCPP's defaults, so the layers would resolve it on
		// and the panel shows it on. This cache predates it and this reads the
		// cache.
		const predates = row(CONNECTION_TYPE.KOBOLDCPP, { "text->text": 1 })
		expect(storedCapabilities(predates)).toEqual({ "text->text": 1 })
		expect(capabilityRefusal(predates, "tools")).toMatch(/cannot do/i)
	})
})
