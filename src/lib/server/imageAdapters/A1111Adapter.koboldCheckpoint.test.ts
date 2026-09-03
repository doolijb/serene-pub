/**
 * Bugfix: the checkpoint override, and the one backend that has no checkpoints.
 *
 * `sd_model_checkpoint` names a file A1111/Forge/SD.Next will switch to. KoboldCPP
 * has no such list — it holds exactly one image model, decided before the request
 * by the .kcpps its Manager wrote or by the `--sdmodel` it was started with — so
 * the field is a per-request answer to a question nobody can ask it.
 *
 * All three KoboldCPP type ids, for two different reasons. On KOBOLDCPP and
 * KOBOLDCPP_MANAGED `connection.model` is the TEXT gguf, so the adapter was
 * asking KoboldCPP to draw with "MN-12B-Lyra-v4-Q4_K_M.gguf" as its checkpoint.
 * On KOBOLDCPP_MANAGED_IMAGE it genuinely IS the image model, and sending it
 * would still be wrong — it would claim the backend can switch to it mid-request,
 * when what actually loads it is a full model swap through the Manager. The
 * second case is the one worth a test: it is the one where the value looks right.
 *
 * Silent today: this build ignores an override it doesn't recognise, so the image
 * comes back looking correct and nothing anywhere says the field was nonsense. A
 * stricter build would reject the render instead, and the error would name a
 * model for a reason nobody could reconstruct.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import a1111 from "./A1111Adapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		name: "kobold",
		type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		modality: "text-gen",
		baseUrl: "http://localhost:5001",
		// The TEXT model — what a managed KoboldCPP connection actually stores.
		model: "MN-12B-Lyra-v4-Q4_K_M.gguf",
		extraJson: {},
		...over
	}) as unknown as SelectConnection

const PNG = "iVBORw0KGgo="

function stubTxt2Img(): { body: () => any } {
	let sent: any
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes("txt2img")) sent = JSON.parse(init!.body as string)
			return {
				ok: true,
				status: 200,
				json: async () => ({ images: [PNG], info: "" }),
				text: async () => ""
			} as unknown as Response
		})
	)
	return { body: () => sent }
}

afterEach(() => vi.unstubAllGlobals())

describe("A1111Adapter — the checkpoint override against KoboldCPP", () => {
	for (const type of [
		CONNECTION_TYPE.KOBOLDCPP,
		CONNECTION_TYPE.KOBOLDCPP_MANAGED
	]) {
		test(`sends no checkpoint for a ${type} connection, whose model field is a text gguf`, async () => {
			const req = stubTxt2Img()
			await new a1111.Adapter(conn({ type })).generate({ prompt: "x" })
			// Not "the checkpoint is right" but "nothing was said about it" —
			// KoboldCPP picks the image model itself, so any value here is a
			// claim the adapter has no business making.
			expect(req.body().override_settings?.sd_model_checkpoint).toBeUndefined()
		})
	}

	test("sends no checkpoint for a managed IMAGE connection either, whose model field really is the image model", async () => {
		// The case the two above cannot catch. Here `connection.model` names a
		// real image model, so the value would look entirely plausible on the
		// wire — and it is still a lie: KoboldCPP cannot switch to it per
		// request, and it is already the model the Manager loaded before this
		// render was allowed to start. A suppression keyed on "the model field
		// holds the wrong kind of file" rather than on "this backend has no
		// checkpoint list" would have let this one through.
		const req = stubTxt2Img()
		await new a1111.Adapter(
			conn({
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
				modality: "image-gen",
				model: "sdxl-turbo-q8.gguf"
			})
		).generate({ prompt: "x" })
		expect(
			req.body().override_settings?.sd_model_checkpoint
		).toBeUndefined()
	})

	test("still sends the checkpoint for a real A1111-family backend", async () => {
		// The skip has to be narrow. Dropping the override for everything would
		// silently pin every A1111/Forge/SD.Next render to whichever checkpoint
		// the server happened to have loaded last.
		const req = stubTxt2Img()
		await new a1111.Adapter(
			conn({ type: CONNECTION_TYPE.A1111, model: "juggernautXL.safetensors" })
		).generate({ prompt: "x" })
		expect(req.body().override_settings.sd_model_checkpoint).toBe(
			"juggernautXL.safetensors"
		)
	})

	test("reports a REQUESTED model as ignored rather than dropping it quietly", async () => {
		// The caller naming a model is a promise this backend can't keep, and the
		// result's `ignored` list is how that reaches the receipt. The fallback to
		// connection.model isn't reported, because nobody asked for it.
		stubTxt2Img()
		const asked = await new a1111.Adapter(conn()).generate({
			prompt: "x",
			model: "dreamshaperXL.safetensors"
		})
		expect(asked.ignored).toContain("model")

		const unasked = await new a1111.Adapter(conn()).generate({ prompt: "x" })
		expect(unasked.ignored).not.toContain("model")
		expect(unasked.applied).not.toContain("model")
	})

	test("other override_settings still reach the backend", async () => {
		// The skip is scoped to the one key. A KoboldCPP connection with a
		// profile override would otherwise lose it to an early return.
		const req = stubTxt2Img()
		await new a1111.Adapter(
			conn({
				extraJson: {
					profile: {
						overrideSettings: { CLIP_stop_at_last_layers: 2 }
					}
				}
			})
		).generate({ prompt: "x" })
		expect(req.body().override_settings.CLIP_stop_at_last_layers).toBe(2)
		expect(req.body().override_settings.sd_model_checkpoint).toBeUndefined()
	})
})
