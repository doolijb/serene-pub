import type { LibraryCatalogItem } from "./types"

export function imageUrlFor(item: LibraryCatalogItem): string | null {
	if (item.source === "charavault") {
		// Proxied server-side — charavault.net's images are blocked by a
		// Cross-Origin-Resource-Policy header when loaded directly.
		// item.file is a raw, unescaped "folder/file" string (real CharaVault
		// names routinely contain spaces, parens, and unicode, and can contain
		// "#"/"?") — each segment must be percent-encoded or the browser's URL
		// parser can treat those characters as a fragment/query delimiter
		// before the request is even sent, silently breaking the image.
		const slashIndex = item.file.indexOf("/")
		const folder = item.file.slice(0, slashIndex)
		const file = item.file.slice(slashIndex + 1)
		return `/library/cardImage/charavault/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`
	}
	if (!item.file.endsWith(".png")) return null
	return `https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${item.file}`
}
