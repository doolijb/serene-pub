/**
 * 🚧 A model's **per-picture price**, from its stored facts
 * (`ModelPricing.perImage`), as one number and the words for it — read by the
 * action forms' cost line (`sprites/fillAction.ts`, `characters/portrait.ts`)
 * and the Loadouts grid tile (DESIGN-image-generation §6.3, §14).
 *
 * A model billed by tokens, or one whose service publishes no list price
 * (Gemini), has no `perImage` and shows nothing.
 */
import { readStoredFacts } from "./modelFacts"

export interface PerImagePrice {
	each: number
	/** ISO 4217 — never assumed to be dollars. */
	currency: string
}

/**
 * The price of one picture: the `medium` level where a service prices by
 * quality, else `standard`, `default`, the `1k` tier, else the first listed.
 */
export function perImagePriceOf(facts: unknown): PerImagePrice | null {
	const pricing = readStoredFacts(facts)?.pricing
	const per = pricing?.perImage
	if (!per) return null
	const each =
		per.medium ?? per.standard ?? per.default ?? per["1k"] ?? Object.values(per)[0]
	return typeof each === "number"
		? { each, currency: pricing?.currency ?? "USD" }
		: null
}

/** "$0.04" — a price in its own currency. */
export function money(n: number, currency = "USD"): string {
	try {
		return new Intl.NumberFormat("en", {
			style: "currency",
			currency,
			maximumFractionDigits: n < 1 ? 3 : 2
		}).format(n)
	} catch {
		return `${n} ${currency}`
	}
}

/** *≈ $0.05 per picture* — the Loadouts tile's quiet facts line. */
export function perPictureLine(price: PerImagePrice | null | undefined): string | null {
	return price ? `≈ ${money(price.each, price.currency)} per picture` : null
}
