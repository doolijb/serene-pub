/**
 * The image family's half of the multi-file seam.
 *
 * The engine's rules are tested against literal declarations in
 * `$lib/server/adapters/attachments.test.ts`. What matters here is that the
 * image family has the SAME seam as the text family rather than a second
 * arrangement of its own — `ImageEditRequest.init` is a `MediaRef[]` because
 * inpainting backends take reference sets, so this family has a multi-file input
 * the moment anything implements `editImage`, and two engines would be two
 * answers to "is this file too big".
 *
 * And one thing that can only be checked here: that `Translation` — which lives
 * in this module and is what every render already reports `applied`/`ignored`
 * through — is what an output cap reports into. Structurally, so the two do not
 * have to import each other; asserted, so the structure is not a coincidence.
 */

import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { BaseImageAdapter, Translation } from "./BaseImageAdapter"
import type { ImageGenResult } from "$lib/shared/imageGen/types"

/**
 * The return type is the real `ImageGenResult` and not `any`, even though the
 * body only throws — a fake free to widen an action's return is the same defect
 * the named actions exist to remove.
 */
class TestImageAdapter extends BaseImageAdapter {
	async generateImage(): Promise<ImageGenResult> {
		throw new Error("not used in these tests")
	}
}

const forType = (type: string) =>
	new TestImageAdapter({ id: 1, type, extraJson: {} } as any) as any

describe("the image family reads the same declarations", () => {
	test("no image entry declares limits today, and that is not a refusal", async () => {
		// Both image types deliberately declare nothing — see the manifest on why
		// claiming `out.image.maxFiles = 1` for KoboldCPP would be wrong in the
		// one adapter that also serves AUTOMATIC1111. So the seam has to be inert
		// rather than restrictive.
		for (const type of [
			CONNECTION_TYPE.A1111,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		]) {
			const adapter = forType(type)
			expect(adapter.io, type).toBeUndefined()
			const plan = await adapter.prepareAttachments([
				{ bytes: Buffer.alloc(64, 1), mime: "image/png" },
				{ bytes: Buffer.alloc(64, 2), mime: "image/png" }
			])
			expect(plan.ok, type).toBe(true)
			expect(plan.files.length, type).toBe(2)
		}
	})

	test("input order survives the seam", async () => {
		// `init` is a LIST because inpainting backends take reference sets, and a
		// reference set is ordered. Identified by content, not by length.
		const adapter = forType(CONNECTION_TYPE.A1111)
		const plan = await adapter.prepareAttachments([
			{ bytes: Buffer.alloc(4, 11), mime: "image/png" },
			{ bytes: Buffer.alloc(4, 22), mime: "image/png" },
			{ bytes: Buffer.alloc(4, 33), mime: "image/png" }
		])
		expect(plan.ok).toBe(true)
		expect(plan.files.map((f: any) => f.bytes[0])).toEqual([11, 22, 33])
	})
})

describe("an output cap reports through Translation", () => {
	test("Translation is what a clamp is reported into", () => {
		// The compile-time half is the call itself: if `Translation` stopped
		// satisfying `IgnoreReporter`, this line would fail `svelte-check`.
		const adapter = forType(CONNECTION_TYPE.A1111)
		const t = new Translation()
		expect(adapter.cappedOutputCount("image", 30, "batch", t)).toBe(30)
		// Nothing declared, so nothing reported — a render that asks for thirty
		// still asks for thirty, and a short answer is reported after the fact by
		// the adapter as it always was.
		expect(t.ignored).toEqual([])
		expect(t.applied).toEqual([])
	})
})
