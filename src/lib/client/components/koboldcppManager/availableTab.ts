/**
 * The Available tab's two axes, expressed as rules rather than markup.
 *
 * KIND (text vs image) is the outer axis, and it is the one that can fail
 * silently. A Stable-Diffusion .gguf and a text-LLM .gguf are indistinguishable
 * by filename — the maintainer's own image catalog is all .gguf — so the tab the
 * user was standing in is the only evidence of what a file IS at download time.
 * Drop `kind` from the request and the server records its default ("text"), the
 * model lands in the wrong list, and nothing anywhere ever says why. That is the
 * reason downloadParams() exists instead of an object literal at the call site.
 *
 * SOURCE (recommended vs Hugging Face) is the inner axis and needs no rules; it
 * only decides which list is on screen.
 */

type Kind = Sockets.KoboldCPP.ModelKindFilter

/**
 * The download request, with the kind of the tab it was started from. Every
 * field the handler already relied on is passed through unchanged — this is
 * only about making the kind impossible to forget.
 */
export function downloadParams(
	model: Sockets.KoboldCPP.SearchModels.ModelResult,
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
		kind
	}
}

/**
 * A picker with one row asks a question that has exactly one answer. The
 * recommended image catalog is a repo of single-file SD1.5/SDXL models, so
 * every card there is one file and the dialog would be a click that teaches
 * nothing. Deliberately not gated on kind: a one-quant text repo is the same
 * dead dialog.
 */
export function skipsPicker(model: { pullOptions: unknown[] }): boolean {
	return model.pullOptions.length === 1
}

/**
 * Q4_K_M is a claim about llama.cpp quantization naming, and the modal makes it
 * in prose too. Image files carry no comparable convention — the labels there
 * are whole filenames (imgmodel_xl_q4_0, sdxs-512-tinySDdistilled_Q8_0) and the
 * choice is which checkpoint, not how hard it was squeezed — so the badge and
 * the wizard's glow are text-only rather than a substring match that would fire
 * on whatever happened to contain it.
 */
export function isRecommendedQuant(kind: Kind, label: string): boolean {
	return kind === "text" && label.includes("Q4_K_M")
}

export interface PickerCopy {
	title: string
	ariaLabel: string
	blurb: string
}

export const PICKER_COPY: Record<Kind, PickerCopy> = {
	text: {
		title: "Select Quantization",
		ariaLabel: "Select quantization",
		blurb: "Higher quantizations (Q8) preserve more quality but require more memory. Q4_K_M is a good balance for most systems."
	},
	image: {
		title: "Select Model",
		ariaLabel: "Select model",
		// The rows here are different checkpoints, not one model at different
		// precisions, so the tradeoff worth naming is family and VRAM.
		blurb: "SD1.5 models are small and fast, and run on almost any GPU. SDXL models produce larger, more detailed images but need considerably more VRAM and time per image."
	}
}

/**
 * Shown twice — as the search box's placeholder and as the prompt standing in
 * for results before the first search — so the two cannot drift apart on what
 * the box actually accepts.
 */
export const SEARCH_HINT: Record<Kind, string> = {
	text: "Search Hugging Face for GGUF models, then press Enter",
	image: "Search Hugging Face for Stable Diffusion models, then press Enter"
}

/**
 * "3 quants" is wrong on an image card: those rows are whole models, not
 * quantizations of one.
 */
export function pullOptionsLabel(count: number, kind: Kind): string {
	const noun = kind === "image" ? "file" : "quant"
	return `${count} ${noun}${count === 1 ? "" : "s"}`
}

export interface EmptyState {
	tone: "empty" | "error"
	title: string
	detail: string
}

/**
 * The image catalog is ONE upstream repo (koboldcpp/imgmodel) fetched live. If
 * it is renamed or unreachable the list comes back empty, and "No recommended
 * models available" would then read as a statement about image generation
 * itself — the user concludes KoboldCPP has no image models rather than that a
 * fetch failed. A failure has to name itself and point at the source that still
 * works.
 */
export function recommendedEmptyState(kind: Kind, failed: boolean): EmptyState {
	if (failed) {
		return {
			tone: "error",
			title:
				kind === "image"
					? "Couldn't load the recommended image models"
					: "Couldn't load the recommended models",
			detail: "The catalog is fetched from Hugging Face. Check the connection and try again, or switch the source to Hugging Face and search directly."
		}
	}
	return {
		tone: "empty",
		title:
			kind === "image"
				? "No recommended image models available."
				: "No recommended models available.",
		detail: "Switch the source to Hugging Face to search for models directly."
	}
}
