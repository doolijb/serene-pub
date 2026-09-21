/**
 * How much memory the machine has, as the one number the finder can reason
 * with.
 *
 * Every recommended list quotes a size, and a size means nothing on its own: a
 * 6 GB file is the obvious pick on a 24 GB card and unloadable on a 4 GB one.
 * The two managers' Available tabs each printed "8GB VRAM · Mainstream" beside
 * a model and left the arithmetic to the reader. The **memory tier** is that
 * arithmetic done once — the person says roughly what they have, and every
 * size on screen turns into "Fits", "Tight" or "Too big".
 *
 * ## Why a per-viewer convenience and not a column
 *
 * It is a fact about the machine in front of the person, not about the pub —
 * an install reached from a phone and from a desktop has two answers to it and
 * neither is the instance's. `localStorage` is therefore right for v1, with
 * the caveats that go with it: it can throw (private windows, blocked site
 * data), it can come back empty, and it never reaches the server. Every read
 * and write here is wrapped, and "Not sure" is what a failed read answers —
 * which is also the default, so a browser that stores nothing simply gets a
 * finder with no fit hints rather than a broken one.
 *
 * ⚠ **Not sure is a real answer, not a missing one.** It suppresses every fit
 * hint deliberately: a guess about somebody's hardware, rendered in moss
 * green, is worse than saying nothing.
 */

/** The five answers. `unsure` is the default and means "no fit hints". */
export type MemoryTier = "4gb" | "8gb" | "12gb" | "24gb" | "unsure"

export const MEMORY_TIERS: readonly { value: MemoryTier; label: string }[] = [
	{ value: "4gb", label: "4 GB" },
	{ value: "8gb", label: "8 GB" },
	{ value: "12gb", label: "12 GB" },
	{ value: "24gb", label: "24 GB+" },
	{ value: "unsure", label: "Not sure" }
]

export const DEFAULT_MEMORY_TIER: MemoryTier = "unsure"

/** The one key. Per viewer, per browser — see the header. */
export const MEMORY_TIER_KEY = "serene-pub:memoryTier"

const GIB = 1024 * 1024 * 1024

/**
 * Binary, not decimal: this is a number a person read off a graphics card,
 * and cards are sold in GiB.
 */
const BUDGETS: Record<MemoryTier, number | null> = {
	"4gb": 4 * GIB,
	"8gb": 8 * GIB,
	"12gb": 12 * GIB,
	"24gb": 24 * GIB,
	unsure: null
}

/** What the tier is called on screen. */
export function tierLabel(tier: MemoryTier): string {
	return MEMORY_TIERS.find((t) => t.value === tier)?.label ?? "Not sure"
}

/** Bytes this tier can hold, or null when the person did not say. */
export function tierBudget(tier: MemoryTier): number | null {
	return BUDGETS[tier] ?? null
}

/** A value off the wire or out of storage, or the default. */
export function parseMemoryTier(value: string | null | undefined): MemoryTier {
	return MEMORY_TIERS.some((t) => t.value === value)
		? (value as MemoryTier)
		: DEFAULT_MEMORY_TIER
}

export type Fit = "fits" | "tight" | "too_big" | "unknown"

/**
 * The weights are not the whole cost.
 *
 * A model loaded onto a card still needs room for its context, and the display
 * is already holding some of the card before either. A file at 100% of the
 * budget therefore does not fit — it is *tight*, which is a real and useful
 * state (it will load, it will be slow or short of context) and not the same
 * answer as "yes". 0.8 is the headroom; a 6.4 GB file is the largest one this
 * says outright fits on an 8 GB card.
 */
const HEADROOM = 0.8

export function fitFor(
	bytes: number | null | undefined,
	tier: MemoryTier
): Fit {
	const budget = tierBudget(tier)
	if (budget == null) return "unknown"
	if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "unknown"
	if (bytes <= budget * HEADROOM) return "fits"
	if (bytes <= budget) return "tight"
	return "too_big"
}

/** "Fits in 8 GB" / "Tight in 8 GB" / "Too big for 8 GB", or null. */
export function fitSentence(fit: Fit, tier: MemoryTier): string | null {
	const label = tierLabel(tier)
	switch (fit) {
		case "fits":
			return `Fits in ${label}`
		case "tight":
			return `Tight in ${label}`
		case "too_big":
			return `Too big for ${label}`
		default:
			return null
	}
}

/**
 * Does the list's own recommendation fit this tier?
 *
 * The shared GGUF YAML quotes `recommended_vram` in whole GB — the
 * maintainer's judgement about the model rather than a measurement of one
 * file — so it is compared against the budget directly rather than through
 * `fitFor`'s headroom, which would second-guess a number that already has the
 * headroom in it.
 */
export function matchesTier(
	recommendedVramGb: number | null | undefined,
	tier: MemoryTier
): boolean {
	const budget = tierBudget(tier)
	if (budget == null) return false
	if (recommendedVramGb == null || !Number.isFinite(recommendedVramGb))
		return false
	return recommendedVramGb * GIB <= budget
}

/**
 * ⚠ Both accessors are wrapped: `localStorage` is a getter that THROWS in a
 * browser with site data blocked, so `typeof localStorage` is not enough on
 * its own and a bare read would take the whole finder down with it.
 */
export function readMemoryTier(): MemoryTier {
	try {
		return parseMemoryTier(localStorage.getItem(MEMORY_TIER_KEY))
	} catch {
		return DEFAULT_MEMORY_TIER
	}
}

export function writeMemoryTier(tier: MemoryTier): void {
	try {
		localStorage.setItem(MEMORY_TIER_KEY, tier)
	} catch {
		// A viewer whose browser will not store it still gets the tier they
		// picked for this visit; there is nothing to tell them about.
	}
}
