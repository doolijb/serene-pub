/**
 * What a LOCAL ONNX model's two detail views say about one row — the headline,
 * the About grid, and the order the endpoint table lists rows in.
 *
 * Three pure functions over `ModelRow.local`, so the sentences a person reads
 * about their own disk are testable without mounting anything. The views own
 * the markup; nothing here knows a Tailwind class or a socket event.
 *
 * ⚠ **Active, never "default", for these two lanes.** There is one embedding
 * model and one entity model app-wide (§10 capability default), and "the
 * default embedding model" invites the question of what the non-default ones
 * are doing — they are doing nothing, because nothing else is ever reached for.
 * `ModelRow` says Active for the same reason; this keeps the two in one voice.
 *
 * ⚠ No time estimate is produced here, and none may be added. Neither lane
 * measures throughput, so "roughly N minutes" would be the one invented number
 * on a screen whose whole job is to state a cost honestly.
 */
import { formatBytes, formatMegabytes, formatTokens } from "./modelManagement"

/** The disk state that rides on a local ONNX model row. */
export type LocalOnnxState = Sockets.Connections.LocalModelState

/** The recommended list's entry for one model, as the wire carries it. */
export type OnnxCatalog = NonNullable<LocalOnnxState["catalog"]>

/**
 * Which lane a local ONNX endpoint feeds. The two `connections.modality`
 * values (§10) that have a lane, and no third — an endpoint of any other
 * modality never reaches these helpers.
 */
export type OnnxModality = "embeddings" | "ner"

/** The line a status card leads with, and the dot beside it. */
export interface OnnxHeadline {
	text: string
	/**
	 * The dot's colour. `success` is resident or on disk, `warning` is
	 * something a person has to act on, `muted` is neither.
	 */
	tone: "success" | "muted" | "warning"
	/** 0–100 while the files are coming down; null otherwise. */
	percent: number | null
}

const clampPercent = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** How far along a download is, from whichever of the two the server sent. */
function downloadPercent(local: LocalOnnxState): number {
	if (local.percent != null && Number.isFinite(local.percent))
		return clampPercent(local.percent)
	if (local.totalBytes)
		return clampPercent(
			((local.downloadedBytes ?? 0) / local.totalBytes) * 100
		)
	return 0
}

/** The size to quote: what is on disk, else what the list says it will be. */
export function onnxSizeLabel(
	local: LocalOnnxState | null | undefined
): string | null {
	if (!local) return null
	if (local.state === "on_disk") return formatBytes(local.sizeBytes)
	return (
		formatMegabytes(local.catalog?.sizeMb) ?? formatBytes(local.sizeBytes)
	)
}

/**
 * The headline for one model's status card.
 *
 * `isActive` is the capability default pointing at this pair — a fact about
 * `connection_defaults`, never about the disk, which is why it is an argument
 * rather than something read off `local`: an active model that was never
 * downloaded is exactly the state a person needs to see before the first job
 * stalls, and the two facts have to be able to disagree.
 */
export function onnxModelHeadline(
	local: LocalOnnxState | null | undefined,
	isActive: boolean
): OnnxHeadline {
	const state = local?.state
	if (isActive) {
		if (state === "downloading")
			return {
				text: `Active · downloading ${downloadPercent(local!)}%`,
				tone: "warning",
				percent: downloadPercent(local!)
			}
		if (state === "error")
			return {
				text: "Active · download failed",
				tone: "warning",
				percent: null
			}
		if (state === "on_disk")
			return local?.loaded
				? { text: "Active · loaded", tone: "success", percent: null }
				: {
						text: "Active · on disk, not loaded",
						tone: "muted",
						percent: null
					}
		// `not_downloaded`, and the same for a row the server has not answered
		// for: nothing is on disk, so nothing can run.
		return {
			text: "Active · not downloaded",
			tone: "warning",
			percent: null
		}
	}
	switch (state) {
		case "on_disk":
			return { text: "On disk", tone: "success", percent: null }
		case "downloading": {
			const percent = downloadPercent(local!)
			return { text: `Downloading ${percent}%`, tone: "muted", percent }
		}
		case "error":
			return { text: "Download failed", tone: "warning", percent: null }
		case "not_downloaded": {
			const size = onnxSizeLabel(local)
			return {
				text: size ? `Not downloaded · ${size}` : "Not downloaded",
				tone: "muted",
				percent: null
			}
		}
		default:
			// No `local` at all. The server has not answered for this row, and
			// a state guessed from silence is one the buttons would contradict.
			return { text: "Not checked yet", tone: "muted", percent: null }
	}
}

/** One row of the About grid. */
export interface OnnxFact {
	label: string
	value: string
}

const TIER_LABELS: Record<string, string> = {
	fast: "Fast",
	balanced: "Balanced",
	best: "Best"
}

/**
 * The About grid, in ONE order — the same order on both lanes, so a person
 * comparing two models is reading down the same column.
 *
 * Absent facts are DROPPED rather than rendered as "unknown": a row added by
 * Hub id carries whatever its config.json answered and nothing else, and a
 * grid of blanks says the app failed rather than that the list is quiet.
 */
export function onnxFacts(
	catalog: OnnxCatalog | null | undefined,
	modality: OnnxModality
): OnnxFact[] {
	const out: OnnxFact[] = []
	if (!catalog) return out
	const tier = catalog.tier ? TIER_LABELS[catalog.tier] : null
	if (tier) out.push({ label: "Tier", value: tier })
	if (modality === "embeddings") {
		if (catalog.dimensions)
			out.push({ label: "Dimensions", value: String(catalog.dimensions) })
	} else if (catalog.labels?.length) {
		out.push({ label: "Labels", value: catalog.labels.join(" · ") })
	}
	const tokens = formatTokens(catalog.maxInputTokens)
	if (tokens) out.push({ label: "Max input", value: `${tokens} tokens` })
	if (modality === "embeddings" && catalog.pooling)
		out.push({ label: "Pooling", value: catalog.pooling })
	// The prefixes are QUOTED: they are literal text prepended to what is
	// embedded, trailing space and all, and an unquoted one reads as a label.
	if (catalog.prefixes?.query)
		out.push({
			label: "Query prefix",
			value: `"${catalog.prefixes.query}"`
		})
	if (catalog.prefixes?.document)
		out.push({
			label: "Document prefix",
			value: `"${catalog.prefixes.document}"`
		})
	if (catalog.languages)
		out.push({ label: "Languages", value: catalog.languages })
	// Licence, size and age are one line: three facts nobody reads separately,
	// and three grid rows each holding two words.
	const provenance = [
		catalog.license,
		catalog.parameterSize,
		catalog.released
	].filter((v): v is string => !!v && v.trim().length > 0)
	if (provenance.length)
		out.push({ label: "Licence", value: provenance.join(" · ") })
	return out
}

/** A row `tierOrder` can sort: its disk state is all it reads. */
export interface TierSortable {
	local?: LocalOnnxState | null
}

/** One header row of the endpoint table, with the rows under it. */
export interface TierGroup<R extends TierSortable> {
	tier: "fast" | "balanced" | "best" | "added" | null
	/** The header's words, or null for the trailing group that has none. */
	label: string | null
	rows: R[]
}

const TIER_SEQUENCE = ["fast", "balanced", "best"] as const

/**
 * The endpoint table's rows, grouped by tier and sized ascending inside each.
 *
 * Fast → Balanced → Best is the order the recommended list is written in and
 * the order a person chooses in: the cheapest thing that could work first.
 * **Added by you** comes last because it is not a tier at all — it is the rows
 * this install went and fetched, which the list has no opinion about.
 *
 * ⚠ A row the list says nothing about (no tier, not added by hand — a listing
 * the server has not answered for yet) lands in a trailing group with NO
 * header rather than being filed under a tier it was never given. A heading
 * invented for it would be the list claiming something it does not know.
 */
export function tierOrder<R extends TierSortable>(
	rows: readonly R[]
): TierGroup<R>[] {
	const buckets = new Map<string, R[]>()
	const push = (key: string, row: R) => {
		const existing = buckets.get(key)
		if (existing) existing.push(row)
		else buckets.set(key, [row])
	}
	for (const row of rows) {
		if (row.local?.addedByUser) push("added", row)
		else if (row.local?.catalog?.tier) push(row.local.catalog.tier, row)
		else push("", row)
	}
	const bySize = (a: R, b: R) => {
		// A size the list never quoted sorts last rather than as zero, which
		// would put the one row nobody measured at the top of every group.
		const left = a.local?.catalog?.sizeMb ?? Number.POSITIVE_INFINITY
		const right = b.local?.catalog?.sizeMb ?? Number.POSITIVE_INFINITY
		return left - right
	}
	const out: TierGroup<R>[] = []
	for (const tier of TIER_SEQUENCE) {
		const group = buckets.get(tier)
		if (group?.length)
			out.push({
				tier,
				label: TIER_LABELS[tier],
				rows: [...group].sort(bySize)
			})
	}
	const added = buckets.get("added")
	if (added?.length)
		out.push({
			tier: "added",
			label: "Added by you",
			rows: [...added].sort(bySize)
		})
	const untiered = buckets.get("")
	if (untiered?.length)
		out.push({ tier: null, label: null, rows: [...untiered].sort(bySize) })
	return out
}

/** The two halves of a local ONNX list: what is here, and what could be. */
export interface PresenceSplit<R extends TierSortable> {
	/**
	 * On disk, arriving, or failed — everything this machine holds or is
	 * fetching, the active model first, then by tier and size. A row the
	 * server has not answered for yet lands here too: it is not known to be
	 * missing, and filing it under "available" would claim it is.
	 */
	here: R[]
	/** Not downloaded, grouped by tier the way the recommended list is. */
	available: TierGroup<R>[]
	/** Rows in `available`, for the collapsed header's count. */
	availableCount: number
}

/**
 * Split an ONNX endpoint's rows by where the files are.
 *
 * The endpoint table grouped by tier alone, so three models on disk sat among
 * seven that were not, told apart by a chip in the second-last column (walk
 * 2026-09-24, plan C1). Every ONNX list — the table, the docked list, the
 * capability chooser, the finder — reads this one split.
 */
export function splitByPresence<R extends TierSortable>(
	rows: readonly R[],
	isActive: (row: R) => boolean = () => false
): PresenceSplit<R> {
	const here: R[] = []
	const notHere: R[] = []
	for (const row of rows) {
		if (row.local?.state === "not_downloaded") notHere.push(row)
		else here.push(row)
	}
	const tiered = tierOrder(here).flatMap((g) => g.rows)
	const active = tiered.filter(isActive)
	return {
		here: [...active, ...tiered.filter((r) => !isActive(r))],
		available: tierOrder(notHere),
		availableCount: notHere.length
	}
}
