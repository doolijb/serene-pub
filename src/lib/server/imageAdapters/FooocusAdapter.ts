/**
 * Fooocus adapter — talks to **Fooocus-API** (the FastAPI wrapper; Fooocus
 * itself has no HTTP server) over its NATIVE endpoints, so Fooocus's own
 * vocabulary is first-class rather than the flat A1111 subset:
 *
 *   POST /v1/generation/text-to-image   — render (sync, base64)
 *   GET  /v1/engines/all-models         — checkpoints + loras (list + health)
 *
 * Native params Fooocus exposes that A1111 does not: `performance_selection`
 * (Speed / Quality / Extreme Speed / Lightning / Hyper-SD), `style_selections`,
 * `sharpness`, and an aspect-ratio *string* rather than free width/height. Those
 * ride `ImageGenParams.extra`; the neutral fields (cfg, seed, batch, model) map
 * straight through.
 *
 * Sync generation (`async_process: false`, `require_base64: true`) — the request
 * blocks until the images are ready and returns base64 directly, so there is no
 * job to poll. A backend under heavy load can make this a long request; async
 * job polling is a later refinement, not needed to connect and generate.
 */
import {
	BaseImageAdapter,
	CONNECTION_TYPE,
	type GeneratedImage,
	type ImageAdapterExports,
	type ImageGenParams,
	type ImageGenResult
} from "./BaseImageAdapter"

const DEFAULT_BASE_URL = "http://localhost:8888"

/** Fooocus's shipped defaults, surfaced in the UI and used when a field is unset. */
const GENERATION_DEFAULTS = {
	performance: "Speed", // Speed | Quality | Extreme Speed | Lightning | Hyper-SD
	styles: ["Fooocus V2"],
	aspectRatio: "1152*896",
	sharpness: 2,
	cfg: 4,
	batch: 1
}

/** The optional `X-API-KEY` header, when Fooocus-API was started with --apikey. */
function authHeaders(connection: SelectConnection): Record<string, string> {
	const key = (connection.extraJson as any)?.apiKey
	return typeof key === "string" && key ? { "X-API-KEY": key } : {}
}

function base(connection: SelectConnection): string {
	return (connection.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
}

class FooocusAdapter extends BaseImageAdapter {
	async generate(
		params: ImageGenParams,
		signal?: AbortSignal
	): Promise<ImageGenResult> {
		this.controller = new AbortController()
		if (signal)
			signal.addEventListener("abort", () => this.controller?.abort(), {
				once: true
			})
		const extra = params.extra ?? {}

		// Fooocus takes an aspect-ratio STRING ("W*H"), not free width/height —
		// build one from the request, else the caller's/Fooocus's default.
		const aspect =
			(extra.aspectRatio as string) ??
			(params.width && params.height
				? `${params.width}*${params.height}`
				: GENERATION_DEFAULTS.aspectRatio)

		const body: Record<string, unknown> = {
			prompt: params.prompt,
			negative_prompt: params.negativePrompt ?? "",
			performance_selection:
				(extra.performance as string) ?? GENERATION_DEFAULTS.performance,
			style_selections:
				(extra.styles as string[]) ?? GENERATION_DEFAULTS.styles,
			aspect_ratios_selection: aspect,
			image_number: params.batch ?? GENERATION_DEFAULTS.batch,
			image_seed: params.seed ?? -1,
			sharpness: (extra.sharpness as number) ?? GENERATION_DEFAULTS.sharpness,
			guidance_scale: params.cfg ?? GENERATION_DEFAULTS.cfg,
			// Omit base_model_name entirely when unset, so Fooocus keeps its own
			// default checkpoint rather than being handed `undefined`.
			...(params.model || this.connection.model
				? { base_model_name: params.model ?? this.connection.model }
				: {}),
			require_base64: true,
			async_process: false
		}

		let res: Response
		try {
			res = await fetch(`${base(this.connection)}/v1/generation/text-to-image`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...authHeaders(this.connection)
				},
				body: JSON.stringify(body),
				signal: this.controller.signal
			})
		} catch (e) {
			if (this.controller.signal.aborted)
				return { images: [], isAborted: true }
			throw new Error(
				`Fooocus request failed: ${e instanceof Error ? e.message : String(e)}`
			)
		}

		if (!res.ok) {
			const text = await res.text().catch(() => "")
			throw new Error(
				`Fooocus generation failed (${res.status}): ${text.slice(0, 300)}`
			)
		}

		// Sync + require_base64 → an array of results, each with a base64 payload.
		const results = (await res.json()) as Array<{
			base64?: string | null
			url?: string | null
			seed?: string | number
			finish_reason?: string
		}>

		const images: GeneratedImage[] = (
			Array.isArray(results) ? results : []
		)
			.filter((r) => typeof r.base64 === "string" && r.base64)
			.map((r) => ({
				base64: r.base64 as string,
				mime: "image/png",
				seed: r.seed,
				meta: r.finish_reason ? { finishReason: r.finish_reason } : undefined
			}))

		return { images, isAborted: false }
	}
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: string[]; error?: string }> {
	try {
		const res = await fetch(`${base(connection)}/v1/engines/all-models`, {
			headers: authHeaders(connection)
		})
		if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
		const data = (await res.json()) as { model_filenames?: string[] }
		return { models: data.model_filenames ?? [] }
	} catch (e) {
		return {
			models: [],
			error: e instanceof Error ? e.message : String(e)
		}
	}
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await fetch(`${base(connection)}/v1/engines/all-models`, {
			headers: authHeaders(connection)
		})
		return res.ok
			? { ok: true }
			: { ok: false, error: `HTTP ${res.status}` }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

const exports: ImageAdapterExports = {
	Adapter: FooocusAdapter,
	listModels,
	testConnection,
	generationDefaults: GENERATION_DEFAULTS
}

// Referenced so the type import isn't dropped and the mapping is discoverable.
void CONNECTION_TYPE.IMAGE_FOOOCUS

export default exports
