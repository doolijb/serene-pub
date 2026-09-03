/**
 * Which types reach an image adapter at all.
 *
 * The routing table IS half of the fix for "the LLM managed connection is
 * showing up under image generation". The manifest half stops such a row from
 * ever advertising `text->image`; this half means that even a row that somehow
 * still claims it has nowhere to draw from — a managed TEXT connection names a
 * text GGUF, and handing it to the A1111 adapter would send an LLM's filename
 * to a backend as a checkpoint.
 *
 * Silent if it regresses: adding the type back to the switch produces a render
 * path that looks entirely functional right up to the point koboldcpp is asked
 * to draw with no image model resident.
 */
import { describe, expect, it, vi } from "vitest"
import { getImageAdapter } from "./getImageAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

// The managed image module reads the Manager's settings and the models table;
// resolving the adapter must not need either.
vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

describe("getImageAdapter", () => {
	it("routes the managed IMAGE type to its own module, not to A1111's", async () => {
		// The two share a render class, so `Adapter` alone cannot tell them
		// apart. What differs is everything around the render — hence the check
		// on testConnection.
		const a1111 = (await import("../imageAdapters/A1111Adapter")).default
		const managed = await getImageAdapter(
			CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		)
		expect(managed.Adapter).toBe(a1111.Adapter)
		expect(managed.testConnection).not.toBe(a1111.testConnection)
		expect(managed.listModels).not.toBe(a1111.listModels)
	})

	it("refuses the managed TEXT type", async () => {
		// It names a text model and cannot draw, whatever the process it points
		// at happens to be holding.
		await expect(
			getImageAdapter(CONNECTION_TYPE.KOBOLDCPP_MANAGED)
		).rejects.toThrow(/No image adapter/)
	})

	it("still routes plain KoboldCPP to A1111", async () => {
		// An external instance started with --sdmodel is a genuine
		// one-process-does-both case whose models this app does not manage, so
		// its probe is the authority and nothing here has to be loaded first.
		const a1111 = (await import("../imageAdapters/A1111Adapter")).default
		expect(await getImageAdapter(CONNECTION_TYPE.KOBOLDCPP)).toBe(a1111)
		expect(await getImageAdapter(CONNECTION_TYPE.A1111)).toBe(a1111)
	})
})
