import type { LibraryCatalogItem } from "./types"

export function imageUrlFor(item: LibraryCatalogItem): string | null {
	if (item.source === "charavault") {
		// Proxied server-side — charavault.net's images are blocked by a
		// Cross-Origin-Resource-Policy header when loaded directly.
		return `/library/cardImage/charavault/${item.file}`
	}
	if (!item.file.endsWith(".png")) return null
	return `https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${item.file}`
}
