/**
 * The recommended IMAGE list — `serene-pub-gguf-list/image.yaml` — read once
 * per process hour, like `recommendedGguf.ts` reads `recommended.yaml`.
 *
 * The files the KoboldCPP image finder offers come from `koboldcpp/imgmodel`
 * on Hugging Face, which carries nothing machine-readable about them: six
 * different models (an SDXL finetune, a photoreal SD 1.5, a 512 distill…)
 * all read the same repo caveat. Owner ruling 2026-11-08: the family, the
 * one-sentence why and the sampling preset each pairs with live in OUR list
 * repo, joined onto the Hugging Face file by name. A file the list does not
 * know keeps the generic description; a list that cannot be fetched costs
 * nothing but the sentences.
 */

export const RECOMMENDED_IMAGE_URL =
	"https://raw.githubusercontent.com/SerenePub/serene-pub-gguf-list/main/image.yaml"

export type ImageFamily = "sd15" | "sdxl" | "sd3" | "flux" | "hidream" | "distilled" | (string & {})

export interface RecommendedImageEntry {
	file: string
	family: ImageFamily
	display_name: string
	description: string
	/** The core sampling preset's seed key (`db/defaults.ts`). */
	sampling: string
	single_file: boolean
	/**
	 * Whole GB the model wants to DRAW at its preset's size — weights plus
	 * sampler and VAE working memory — the maintainer's figure, like
	 * `recommended.yaml`'s. 0 when the list gives none. The file size alone
	 * understates SDXL by half, which is why the finder is not left to it.
	 */
	recommended_vram: number
}

const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, "$1")

/** The same hand reader `recommended.yaml` has: flat `- key: value` entries, comments skipped. */
export function parseRecommendedImageYaml(text: string): RecommendedImageEntry[] {
	const entries: RecommendedImageEntry[] = []
	let cur: Partial<RecommendedImageEntry> | null = null
	const flush = () => {
		if (cur?.file) {
			entries.push({
				file: cur.file,
				family: cur.family ?? "",
				display_name: cur.display_name ?? cur.file,
				description: cur.description ?? "",
				sampling: cur.sampling ?? "",
				single_file: cur.single_file ?? true,
				recommended_vram: cur.recommended_vram ?? 0
			})
		}
		cur = null
	}
	for (const raw of text.split("\n")) {
		const line = raw.trim()
		if (!line || line.startsWith("#")) continue
		const entryStart = line.startsWith("- ")
		const body = entryStart ? line.slice(2) : line
		if (entryStart) flush(), (cur = {})
		if (!cur) continue
		const colon = body.indexOf(":")
		if (colon < 0) continue
		const key = body.slice(0, colon).trim()
		const value = unquote(body.slice(colon + 1))
		switch (key) {
			case "file":
			case "family":
			case "display_name":
			case "description":
			case "sampling":
				cur[key] = value
				break
			case "single_file":
				cur.single_file = value !== "false"
				break
			case "recommended_vram":
				cur.recommended_vram = parseInt(value, 10) || 0
				break
		}
	}
	flush()
	return entries
}

/** The family's name as a person reads it. */
export const IMAGE_FAMILY_LABEL: Record<string, string> = {
	sd15: "SD 1.5",
	sdxl: "SDXL",
	sd3: "SD 3",
	flux: "Flux",
	hidream: "HiDream",
	distilled: "Distilled SD"
}

export const imageFamilyLabel = (family: string): string =>
	IMAGE_FAMILY_LABEL[family] ?? family

let cached: { at: number; entries: RecommendedImageEntry[] } | null = null
const TTL_MS = 60 * 60 * 1000

/** The list, by file name; empty when it cannot be fetched (never throws). */
export async function recommendedImageEntries(): Promise<Map<string, RecommendedImageEntry>> {
	if (!cached || Date.now() - cached.at > TTL_MS) {
		try {
			const response = await fetch(RECOMMENDED_IMAGE_URL, { signal: AbortSignal.timeout(10_000) })
			if (!response.ok) throw new Error(`Recommended image list fetch failed: ${response.status}`)
			cached = { at: Date.now(), entries: parseRecommendedImageYaml(await response.text()) }
		} catch (err) {
			console.warn("[recommended image list]", err instanceof Error ? err.message : err)
			// Not cached: a blip must not cost an hour of generic cards.
			return new Map(cached?.entries.map((e) => [e.file, e]) ?? [])
		}
	}
	return new Map(cached.entries.map((e) => [e.file, e]))
}

/** For tests: forget the fetched list. */
export function resetRecommendedImageEntriesForTests(): void {
	cached = null
}
