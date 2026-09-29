/**
 * The recommended GGUF list — `serene-pub-gguf-list/recommended.yaml` — read ONCE.
 *
 * Both the Ollama and the KoboldCPP handlers show recommendations from this one
 * file, through this one reader. Two parsers for one file drift — on what a
 * malformed number reads as (here: 0, never `NaN`), and on which fields survive.
 * The list's `tags` are a curated vocabulary (`roleplay`, `vision`,
 * `long-context`, …) that every card shows, so they are read, never dropped.
 *
 * ## Embedding models live in the same list
 *
 * Owner ruling 2026-09-25: one Ollama connection per host serves chat AND
 * embeddings, and its Get tab has an Embeddings scope. The list's schema
 * already describes an embedding model completely (name, pull, size, VRAM,
 * parameter size, quantisation, description); it only lacked a way to say
 * which entries ARE embedding models. That is the `role` axis of its own tag
 * vocabulary: an entry tagged `embedding` is an embedding model.
 *
 * ⚠ **KoboldCPP must never be offered one.** It reads this same file for its
 * text list, and an embedding entry's `pull` is an Ollama library name
 * (`nomic-embed-text`) no KoboldCPP can fetch. `chatEntries` is the filter
 * every chat consumer goes through.
 *
 * Deliberately a hand parser, not a YAML library: the file is one flat list of
 * one shape, the same parser shipped for years, and a dependency to read it
 * would be the first YAML parser in the server.
 */

export const RECOMMENDED_GGUF_URL =
	"https://raw.githubusercontent.com/SerenePub/serene-pub-gguf-list/main/recommended.yaml"

/** The tag that marks an entry as an embedding model. */
export const EMBEDDING_TAG = "embedding"

export interface RecommendedEntry {
	name: string
	pull: string
	/** GB, as the list quotes it; 0 when it quotes none or garbles it. */
	size: number
	recommended_vram: number
	/** The list's own controlled vocabulary. Empty when an entry has none. */
	tags: string[]
	details: {
		parameter_size: string
		quantization_level: string
		modified_at: string
		description: string
	}
}

const unquote = (value: string) => value.trim().replace(/"/g, "")

/** `[a, b, c]` — the list writes its tags as one inline array. */
function readTags(value: string): string[] {
	const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "")
	return inner
		.split(",")
		.map((t) => unquote(t))
		.filter((t) => t.length > 0)
}

export function parseRecommendedYaml(text: string): RecommendedEntry[] {
	const entries: RecommendedEntry[] = []
	let cur: RecommendedEntry | null = null
	let inDetails = false
	for (const line of text.split("\n")) {
		const t = line.trim()
		if (t.startsWith("#")) continue
		if (t.startsWith("- name:")) {
			if (cur) entries.push(cur)
			cur = {
				name: t.replace("- name:", "").trim(),
				pull: "",
				size: 0,
				recommended_vram: 0,
				tags: [],
				details: {
					parameter_size: "",
					quantization_level: "",
					modified_at: "",
					description: ""
				}
			}
			inDetails = false
			continue
		}
		if (!cur) continue
		if (t.startsWith("pull:")) cur.pull = t.replace("pull:", "").trim()
		else if (t.startsWith("size:"))
			cur.size = parseFloat(t.replace("size:", "").trim()) || 0
		else if (t.startsWith("recommended_vram:"))
			cur.recommended_vram =
				parseInt(t.replace("recommended_vram:", "").trim()) || 0
		else if (t.startsWith("tags:")) cur.tags = readTags(t.replace("tags:", ""))
		else if (t === "details:") inDetails = true
		else if (inDetails) {
			if (t.startsWith("parameter_size:"))
				cur.details.parameter_size = unquote(t.replace("parameter_size:", ""))
			else if (t.startsWith("quantization_level:"))
				cur.details.quantization_level = unquote(
					t.replace("quantization_level:", "")
				)
			else if (t.startsWith("modified_at:"))
				cur.details.modified_at = unquote(t.replace("modified_at:", ""))
			else if (t.startsWith("description:"))
				cur.details.description = unquote(t.replace("description:", ""))
		}
	}
	if (cur) entries.push(cur)
	return entries
}

export const isEmbeddingEntry = (e: { tags: readonly string[] }) =>
	e.tags.includes(EMBEDDING_TAG)

/** Everything a chat consumer may offer — never an embedding model. */
export const chatEntries = <T extends { tags: readonly string[] }>(
	entries: readonly T[]
): T[] => entries.filter((e) => !isEmbeddingEntry(e))

export const embeddingEntries = <T extends { tags: readonly string[] }>(
	entries: readonly T[]
): T[] => entries.filter(isEmbeddingEntry)

export async function fetchRecommendedGguf(): Promise<RecommendedEntry[]> {
	const response = await fetch(RECOMMENDED_GGUF_URL)
	if (!response.ok)
		throw new Error(`Recommended list fetch failed: ${response.status}`)
	return parseRecommendedYaml(await response.text())
}
