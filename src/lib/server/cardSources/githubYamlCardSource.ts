import type { LibraryCatalogItem } from "$lib/shared/library/types"
import type {
	CardKind,
	CardSource,
	CardSourceContext,
	CardSourceSearchParams,
	CardSourceSearchResult
} from "./types"
import { CardSourceUnavailableError } from "./types"
import { TtlCache } from "./cache"
import { getOrFetchCardBytes } from "./diskCache"

const REPO_BASE =
	"https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main"

interface GithubYamlEntry {
	name: string
	description: string
	tags: string[]
	author: string
	version: string
	spec: string
	file: string
	category: string
}

/**
 * Hand-rolled parser for the flat YAML shape used by
 * serene-pub-chara-list's characters.yaml / personas.yaml. Not a general
 * YAML parser — deliberately narrow to this repo's known layout.
 */
function parseGithubYaml(yamlText: string): GithubYamlEntry[] {
	const entries: GithubYamlEntry[] = []

	const lines = yamlText.split("\n")
	let currentCard: GithubYamlEntry | null = null
	let inDescriptionBlock = false
	let descriptionBuffer = ""

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmed = line.trim()

		// Card start (top level array item)
		if (trimmed.startsWith("- name:") && line.match(/^  - name:/)) {
			if (currentCard) {
				if (inDescriptionBlock) {
					currentCard.description = descriptionBuffer.trim()
					inDescriptionBlock = false
					descriptionBuffer = ""
				}
				entries.push(currentCard)
			}
			currentCard = {
				name: trimmed.replace("- name:", "").trim(),
				description: "",
				tags: [],
				author: "",
				version: "",
				spec: "V3",
				file: "",
				category: "Uncategorized"
			}
		} else if (currentCard) {
			if (trimmed.startsWith("description:")) {
				const afterColon = trimmed.replace("description:", "").trim()
				if (afterColon === "|-" || afterColon === "|") {
					inDescriptionBlock = true
					descriptionBuffer = ""
				} else {
					currentCard.description = afterColon
				}
			} else if (inDescriptionBlock) {
				if (line.match(/^    [^ ]/) && !line.match(/^      /)) {
					currentCard.description = descriptionBuffer.trim()
					inDescriptionBlock = false
					descriptionBuffer = ""
					i--
					continue
				} else if (line.match(/^      /)) {
					descriptionBuffer += line.substring(6) + "\n"
				}
			} else if (trimmed.startsWith("tags:") && line.match(/^    tags:/)) {
				let j = i + 1
				while (j < lines.length && lines[j].match(/^      - /)) {
					const tag = lines[j].trim().replace("- ", "")
					if (tag) currentCard.tags.push(tag)
					j++
				}
			} else if (trimmed.startsWith("author:") && line.match(/^    author:/)) {
				currentCard.author = trimmed.replace("author:", "").trim()
			} else if (trimmed.startsWith("version:") && line.match(/^    version:/)) {
				currentCard.version = trimmed.replace("version:", "").trim()
			} else if (trimmed.startsWith("file:") && line.match(/^    file:/)) {
				currentCard.file = trimmed.replace("file:", "").trim()
			} else if (
				trimmed.startsWith("category:") &&
				line.match(/^    category:/)
			) {
				const cat = trimmed.replace("category:", "").trim()
				if (cat && cat !== "null") {
					currentCard.category = cat
				}
			}
		}
	}

	if (currentCard) {
		if (inDescriptionBlock) {
			;(currentCard as GithubYamlEntry).description = descriptionBuffer.trim()
		}
		entries.push(currentCard)
	}

	return entries
}

// Caches the fetched+parsed catalog per kind (not per search query) — the
// parser above is synchronous and walks the entire YAML file, which would
// otherwise block Node's single event loop thread on every single
// keystroke-triggered search (each partial search string is a different
// query, so a cache keyed on the query never hits for incremental typing).
// Caching the parsed catalog itself means the expensive fetch+parse only
// happens once per TTL window; every search after that is a cheap in-memory
// filter over the cached array.
const catalogCache = new TtlCache<GithubYamlEntry[]>(60 * 60_000)

async function fetchYamlEntries(kind: CardKind): Promise<GithubYamlEntry[]> {
	return catalogCache.getOrFetch(kind, async () => {
		const filename = kind === "character" ? "characters.yaml" : "personas.yaml"
		let response: Response
		try {
			response = await fetch(`${REPO_BASE}/${filename}`)
		} catch (e) {
			throw new CardSourceUnavailableError(
				`Failed to reach GitHub: ${(e as Error).message}`
			)
		}
		if (!response.ok) {
			throw new CardSourceUnavailableError(`GitHub API error: ${response.status}`)
		}
		return parseGithubYaml(await response.text())
	})
}

function toLibraryCatalogItem(entry: GithubYamlEntry): LibraryCatalogItem {
	return {
		...entry,
		source: "github-serenepub",
		sourceRef: { file: entry.file },
		// The catalog YAML doesn't encode lorebook presence — a known,
		// accepted gap unless that repo's format is extended later.
		hasLorebook: undefined
	}
}

export const githubYamlCardSource: CardSource = {
	id: "github-serenepub",
	label: "Serene Pub Community Library",
	description:
		"Curated cards contributed by the community and designed for Serene Pub, hosted as a free, open GitHub repository.",
	url: "https://github.com/doolijb/serene-pub-chara-list",
	requiresAuthForBestResults: false,
	supports(_kind: CardKind) {
		return true
	},
	async search(
		params: CardSourceSearchParams,
		_ctx: CardSourceContext
	): Promise<CardSourceSearchResult> {
		const entries = await fetchYamlEntries(params.kind)

		let filtered = entries
		if (params.searchTerm) {
			const searchLower = params.searchTerm.toLowerCase()
			filtered = filtered.filter(
				(e) =>
					e.name.toLowerCase().includes(searchLower) ||
					e.description.toLowerCase().includes(searchLower) ||
					e.category.toLowerCase().includes(searchLower) ||
					e.tags.some((t) => t.toLowerCase().includes(searchLower))
			)
		}
		if (params.category) {
			filtered = filtered.filter((e) => e.category === params.category)
		}

		return {
			items: filtered.map(toLibraryCatalogItem),
			hasMore: false
		}
	},
	async getCardBytes(ref: unknown, _ctx: CardSourceContext): Promise<Buffer> {
		const { file } = ref as { file: string }
		return getOrFetchCardBytes(`github-serenepub:${file}`, () =>
			fetchGithubCardBytes(file)
		)
	}
}

async function fetchGithubCardBytes(file: string): Promise<Buffer> {
	let response: Response
	try {
		response = await fetch(`${REPO_BASE}/${file}`)
	} catch (e) {
		throw new CardSourceUnavailableError(
			`Failed to reach GitHub: ${(e as Error).message}`
		)
	}
	if (!response.ok) {
		throw new CardSourceUnavailableError(
			`Failed to fetch character file: ${response.status}`
		)
	}
	return Buffer.from(await response.arrayBuffer())
}
