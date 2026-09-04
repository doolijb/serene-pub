/**
 * The bind guard, and the one thing about it that fails silently.
 *
 * Everything here is about a CACHE OUTLIVING THE THING IT CACHES.
 * `connections.capabilities.resolved` is a stored collapse of the four
 * resolution layers, written at test time and at edit time. Withdrawing a key
 * from `ADAPTER_MANIFEST` stops resolution from ever GRANTING it again — and
 * does nothing whatever about the rows that were granted it before.
 *
 * That is not hypothetical. OPENAI_CHAT declared `text->image` as `probed` and
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
		const stale = row(CONNECTION_TYPE.OPENAI_CHAT, {
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
			row(CONNECTION_TYPE.OPENAI_CHAT, { "text->image": 1 }),
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
	// modality fallback. `modalityAllows` says yes to everything that is not an
	// image capability, so an EMBEDDINGS connection would quietly become
	// acceptable for chat. `persistCapabilities` guards the identical hazard with
	// the identical `declares` test; the comment there covers the other half.
	const EMBEDDINGS_ROW = row("openai-embeddings", {
		"text->embedding": 1
	})

	test("a type nobody declares keeps its backfilled cache", () => {
		// 0175 backfilled `text->embedding` for these rows from the old modality
		// column and 0184 re-graded it, and no manifest entry describes their type.
		expect(storedCapabilities(EMBEDDINGS_ROW)).toEqual({
			"text->embedding": 1
		})
		expect(capabilityRefusal(EMBEDDINGS_ROW, "text->embedding")).toBeNull()
	})

	test("...and is still refused for chat, which is what the guard buys", () => {
		// THE REGRESSION NET. Delete the `declared` check in `storedCapabilities`
		// and this is the assertion that goes red: the set collapses to `{}`, the
		// modality fallback takes over, and an embeddings endpoint is offered a
		// chat slot.
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
