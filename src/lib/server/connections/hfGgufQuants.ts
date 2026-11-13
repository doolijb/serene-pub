/**
 * The one place a Hugging Face repo's file list becomes a quant list.
 *
 * KoboldCPP's resolver and search (`sockets/koboldcpp.ts`) and Ollama's
 * recommended rows (`sockets/ollama.ts`) both read the same HF `siblings`
 * array; this module owns the mapping so the two cannot drift.
 */

/** A quant label: Q4_K_M, IQ3_XS, BF16, F16 … */
export const GGUF_QUANT_RE = /^(Q|IQ|BF|F)\d/i

export interface HfGgufOption {
	/** The last hyphen segment of the file stem — "Q4_K_M". */
	label: string
	filename: string
	downloadUrl: string
	sizeBytes?: number
}

/** The sibling fields this module reads. */
export interface HfSibling {
	rfilename: string
	size?: number
}

/**
 * Auxiliary files end in a quant label too but are never a model of their
 * own: a vision projector (`mmproj-…-F16.gguf`) and a speculative-decoding
 * drafter (`MTP/mtp-…-Q8_0.gguf`, unsloth's gemma-4 repos) — MV V2.
 */
const AUXILIARY_GGUF_RE = /mmproj|(^|\/)mtp[-_/]/i

/** Quant-labelled .gguf siblings → pull options, in sibling order. */
export function ggufQuantOptions(
	repoId: string,
	siblings: HfSibling[] | undefined | null
): HfGgufOption[] {
	return (siblings ?? [])
		.filter((s) => s.rfilename.endsWith(".gguf"))
		.filter((s) => !AUXILIARY_GGUF_RE.test(s.rfilename))
		.filter((s) =>
			GGUF_QUANT_RE.test(
				s.rfilename
					.replace(".gguf", "")
					.split("-")
					.pop()
					?.toUpperCase() ?? ""
			)
		)
		.map((s) => ({
			label:
				s.rfilename.replace(".gguf", "").split("-").pop() ??
				s.rfilename,
			filename: s.rfilename,
			downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${s.rfilename}`,
			sizeBytes: typeof s.size === "number" ? s.size : undefined
		}))
}

/**
 * The Hub's search endpoint lists siblings without byte counts; the repo read
 * (`fetchHfRepoSiblings`) has them. Fills each option's missing size by file
 * name, so a picker can say Fits / Tight / Too big instead of "Size not listed".
 */
export function withSiblingSizes<
	T extends { filename: string; sizeBytes?: number }
>(options: T[], siblings: HfSibling[] | null | undefined): T[] {
	if (!siblings?.length) return options
	const sizes = new Map(siblings.map((s) => [s.rfilename, s.size]))
	return options.map((o) => {
		const size = sizes.get(o.filename)
		return o.sizeBytes == null && typeof size === "number"
			? { ...o, sizeBytes: size }
			: o
	})
}

const TTL_MS = 10 * 60 * 1000
const CARD_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; siblings: HfSibling[] | null }>()
const cardCache = new Map<string, { at: number; card: HfRepoCard }>()

/** The card facts the Hub states for a repo; an unknown one is omitted. */
export interface HfRepoCard {
	license?: string
	languages?: string[]
	contextLength?: number
	baseModel?: string
	downloads?: number
	lastModified?: string
}

/** The Hub's repo JSON → its card facts. Pure; every field omitted when unknown. */
export function hfRepoCardFrom(m: any): HfRepoCard {
	const card: HfRepoCard = {}
	const data = m?.cardData
	const strings = (v: unknown): string[] =>
		(Array.isArray(v) ? v : [v]).filter(
			(x): x is string => typeof x === "string" && x.trim() !== ""
		)

	let license = strings(data?.license).join(", ")
	if (!license && Array.isArray(m?.tags)) {
		const tag = m.tags.find(
			(t: unknown) =>
				typeof t === "string" &&
				t.startsWith("license:") &&
				t.length > 8
		)
		if (tag) license = tag.slice(8)
	}
	if (license) card.license = license

	const languages = strings(data?.language)
	if (languages.length) card.languages = languages

	const ctx = m?.gguf?.context_length
	if (typeof ctx === "number" && Number.isFinite(ctx) && ctx > 0)
		card.contextLength = ctx

	const base = strings(data?.base_model)[0]
	if (base) card.baseModel = base

	if (
		typeof m?.downloads === "number" &&
		Number.isFinite(m.downloads) &&
		m.downloads >= 0
	)
		card.downloads = m.downloads

	if (typeof m?.lastModified === "string" && m.lastModified !== "")
		card.lastModified = m.lastModified

	return card
}

/** Test seam. Clears the siblings cache and the card cache. */
export function clearHfSiblingsCache(): void {
	cache.clear()
	cardCache.clear()
}

/**
 * The one HTTP read of a repo. Refreshes the siblings cache always, and the
 * card cache on a successful public read (private, gated and failed reads
 * store no card).
 */
async function readHfRepo(
	repoId: string
): Promise<{ card: HfRepoCard | null; siblings: HfSibling[] | null }> {
	let siblings: HfSibling[] | null = null
	let card: HfRepoCard | null = null
	try {
		const resp = await fetch(
			`https://huggingface.co/api/models/${repoId}?blobs=true`,
			{ signal: AbortSignal.timeout(10_000) }
		)
		if (resp.ok) {
			const m: any = await resp.json()
			if (!m.private && m.gated !== true && m.gated !== "auto") {
				siblings = Array.isArray(m.siblings) ? m.siblings : []
				card = hfRepoCardFrom(m)
			}
		}
	} catch {
		siblings = null
		card = null
	}
	const now = Date.now()
	cache.set(repoId, { at: now, siblings })
	if (card) cardCache.set(repoId, { at: now, card })
	return { card, siblings }
}

/**
 * A repo's siblings (with sizes) by id. Null on any failure, and for private
 * or gated repos. Cached ten minutes, failures included (briefly retried by
 * the TTL).
 */
export async function fetchHfRepoSiblings(
	repoId: string
): Promise<HfSibling[] | null> {
	const hit = cache.get(repoId)
	if (hit && Date.now() - hit.at < TTL_MS) return hit.siblings
	return (await readHfRepo(repoId)).siblings
}

function freshSiblings(repoId: string) {
	const hit = cache.get(repoId)
	return hit && Date.now() - hit.at < TTL_MS ? hit : null
}

function freshCard(repoId: string) {
	const hit = cardCache.get(repoId)
	return hit && Date.now() - hit.at < CARD_TTL_MS ? hit.card : null
}

/**
 * True exactly when `fetchHfRepoCard` would answer without HTTP.
 */
export function hfRepoReadCached(repoId: string): boolean {
	const sib = freshSiblings(repoId)
	if (!sib) return false
	return sib.siblings === null || freshCard(repoId) !== null
}

/**
 * A repo's card facts and siblings from one read: the card is cached a day,
 * the siblings ten minutes (failures included, which stops a retry storm).
 */
export async function fetchHfRepoCard(
	repoId: string
): Promise<{ card: HfRepoCard | null; siblings: HfSibling[] | null }> {
	const sib = freshSiblings(repoId)
	const card = freshCard(repoId)
	if (sib && sib.siblings === null) return { card, siblings: null }
	if (sib && card) return { card, siblings: sib.siblings }
	return readHfRepo(repoId)
}

// ── Ollama's view of the same list ──────────────────────────────────────────

export interface OllamaQuantRow {
	label: string
	/** `hf.co/<repo>:<quant>` as Ollama accepts it. */
	tag: string
	filename: string
	sizeBytes?: number
	recommended: boolean
}

const SPLIT_RE = /-\d{5}-of-\d{5}/i

/**
 * The repo's single-file quants as `hf.co/<repo>:<quant>` tags. Ollama matches
 * the quant against the file name case-insensitively, and a `UD-` prefix on
 * the stem is part of the quant. Split files and mmproj files are not quants.
 * Exactly one row is `recommended`: the one matching `wantedTag`; if none
 * does, none is, and `wantedTag` is appended as its own row.
 */
export function ollamaQuantRows(
	repoId: string,
	siblings: HfSibling[],
	wantedTag: string
): OllamaQuantRow[] {
	const wanted = wantedTag.toLowerCase()
	const rows: OllamaQuantRow[] = ggufQuantOptions(repoId, siblings)
		.filter(
			(o) => !SPLIT_RE.test(o.filename) && !/mmproj/i.test(o.filename)
		)
		.map((o) => {
			const parts = (o.filename.split("/").pop() ?? o.filename)
				.replace(/\.gguf$/, "")
				.split("-")
			const ud = parts.length > 1 && parts[parts.length - 2] === "UD"
			const quant = (ud ? "UD-" : "") + o.label
			return {
				label: quant,
				tag: `hf.co/${repoId}:${quant}`,
				filename: o.filename,
				sizeBytes: o.sizeBytes,
				recommended: false
			}
		})
	const hit = rows.find((r) => r.label.toLowerCase() === wanted)
	if (hit) hit.recommended = true
	else if (wantedTag)
		rows.push({
			label: wantedTag,
			tag: `hf.co/${repoId}:${wantedTag}`,
			filename: "",
			recommended: true
		})
	return rows
}
