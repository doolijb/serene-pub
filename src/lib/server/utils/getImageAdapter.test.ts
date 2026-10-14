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
 * The two halves are no longer independent. `ADAPTER_REGISTRY` is the one map,
 * and the manifest is checked against it, so declaring `text->image` for a type
 * with no `image` thunk is a CI failure rather than a bind that resolves and
 * then throws from inside the loader. What is left to test here is the routing
 * itself: which entry a type lands on, and which types deliberately have none.
 *
 * Silent if it regresses: an `image` thunk added back to an entry produces a
 * render path that looks entirely functional right up to the point koboldcpp is
 * asked to draw with no image model resident.
 */
import { describe, expect, it, vi } from "vitest"
import { getImageAdapter } from "./getImageAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

// The managed image module reads the managed KoboldCPP's settings and the models table;
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

	it("routes the managed endpoint to the managed image module — it draws too", async () => {
		// One process, one endpoint: its image models render through the same
		// module the retired image type used. Which MODEL may draw is judged per
		// model (`capabilityRefusal` reads its modality), never by the type.
		const managed = (
			await import("../imageAdapters/KoboldCppManagedImageAdapter")
		).default
		expect(await getImageAdapter(CONNECTION_TYPE.KOBOLDCPP_MANAGED)).toBe(
			managed
		)
	})

	it("still routes plain KoboldCPP to A1111", async () => {
		// An external instance started with --sdmodel is a genuine
		// one-process-does-both case whose models this app does not manage, so
		// its probe is the authority and nothing here has to be loaded first.
		const a1111 = (await import("../imageAdapters/A1111Adapter")).default
		expect(await getImageAdapter(CONNECTION_TYPE.KOBOLDCPP)).toBe(a1111)
		expect(await getImageAdapter(CONNECTION_TYPE.A1111)).toBe(a1111)
	})

	it("routes OpenAI to the OpenAI-images dialect", async () => {
		// This used to be a refusal: the manifest granted `text->image` to OPENAI
		// with no image module behind it, and THIS threw minutes into a session.
		// The module exists now (DESIGN-image-generation §9.6), and the
		// conformance test keeps the manifest and the module agreeing.
		const openaiImages = (await import("../imageAdapters/OpenAIImagesAdapter"))
			.default
		// With the Gemini image dialect folded in (`withGeminiImages`): the
		// OpenAI-images module underneath, Gemini's fields beside its own.
		const routed = await getImageAdapter(CONNECTION_TYPE.OPENAI)
		expect(routed.sheet).toBe(openaiImages.sheet)
		expect(Object.keys(routed.profileSchema ?? {})).toEqual(
			expect.arrayContaining(["quality", "imageSize"])
		)
	})

	it("refuses a type with no image code of any kind", async () => {
		await expect(
			getImageAdapter(CONNECTION_TYPE.ANTHROPIC)
		).rejects.toThrow(/No image adapter/)
	})
})
