/**
 * The KoboldCPP download request's one rule, as a function rather than an
 * object literal at each call site. (This module was the KoboldCPP manager's
 * Available tab; that tab is retired — the model finder, `finder.ts`, owns
 * every search, list and quant choice now — and this is what is left.)
 *
 * KIND is the rule, and it is the one that can fail silently. A
 * Stable-Diffusion .gguf and a text-LLM .gguf are indistinguishable by
 * filename — the maintainer's own image catalog is all .gguf — so the scope
 * the person was shopping in is the only evidence of what a file IS at
 * download time. Drop `kind` from the request and the server records its
 * default ("text"), the model lands in the wrong list, and nothing anywhere
 * ever says why. That is the reason downloadParams() exists.
 */

type Kind = Sockets.KoboldCPP.ModelKindFilter

/**
 * The download request, with the kind of the tab it was started from. Every
 * field the handler already relied on is passed through unchanged — this is
 * only about making the kind impossible to forget.
 */
export function downloadParams(
	model: Sockets.KoboldCPP.SearchModels.ModelResult & {
		visionProjector?: Sockets.KoboldCPP.VisionProjectorPull
	},
	opt: Sockets.KoboldCPP.SearchModels.PullOption,
	kind: Kind
): Sockets.KoboldCPP.DownloadModel.Params {
	return {
		modelName: model.name,
		filename: opt.filename,
		downloadUrl: opt.downloadUrl,
		modelUrl: model.url,
		description: model.description,
		quantization: opt.label,
		sizeBytes: opt.sizeBytes,
		kind,
		// A recommended vision model names its projector; the server fetches
		// it after the model and pairs the two (★A, 2026-11-11).
		...(kind === "text" && model.visionProjector
			? { visionProjector: model.visionProjector }
			: {})
	}
}
