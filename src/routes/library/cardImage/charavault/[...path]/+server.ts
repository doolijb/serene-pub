// Proxies CharaVault card thumbnail/PNG requests through the server.
//
// charavault.net's image responses are blocked by the browser when loaded
// directly as <img src="https://charavault.net/..."> — the network panel
// shows "blocked:CORP not 'same-site'", meaning their server sends a
// Cross-Origin-Resource-Policy header that disallows cross-site embeds.
// That's a server-side HTTP response policy, not something CSP's img-src
// can work around (img-src just controls which origins the browser is
// ALLOWED to request from — CORP is the target server refusing the
// cross-site load regardless). A server-side fetch isn't subject to CORP
// at all (it's a browser-enforced restriction), so proxying through this
// route is the fix, mirroring why CharaVault's JSON/API calls are already
// entirely server-side.
import type { RequestHandler } from "@sveltejs/kit"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import { fetchCharaVaultCardResponse } from "$lib/server/cardSources/charaVault/charaVaultSource"
import { CardSourceRateLimitedError, CardSourceUnavailableError } from "$lib/server/cardSources/types"
import { getCachedCardBytes, setCachedCardBytes } from "$lib/server/cardSources/diskCache"

export const GET: RequestHandler = async (event) => {
	const user = await authenticateRequest(event)
	if (!user) {
		return new Response("Unauthorized", { status: 401 })
	}

	const { path } = event.params
	if (!path) return new Response("Not found", { status: 404 })

	const slashIndex = path.indexOf("/")
	if (slashIndex === -1) return new Response("Not found", { status: 404 })
	const folder = path.slice(0, slashIndex)
	const file = path.slice(slashIndex + 1)
	if (!folder || !file) return new Response("Not found", { status: 404 })

	const cacheKey = `charavault:${folder}/${file}`

	// On a cache hit, this is a local disk read — no network call, no
	// rate-limit budget spent. Card thumbnails are viewed repeatedly (every
	// time the library page or a chat's character list re-renders one), so
	// this is the single biggest win for staying under CharaVault's limits.
	const cached = await getCachedCardBytes(cacheKey)
	if (cached) {
		return new Response(new Uint8Array(cached), {
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=86400"
			}
		})
	}

	try {
		// Cache miss: stream the upstream response body straight through
		// (getCardBytes()'s Buffer conversion is for the import path, which
		// genuinely needs the complete file up front) while also teeing the
		// bytes to disk in the background so the next request for this same
		// card is a cache hit instead of another upstream round trip.
		const upstream = await fetchCharaVaultCardResponse({ folder, file })
		const [toClient, toCache] = upstream.body!.tee()

		setCachedCardBytes(
			cacheKey,
			Buffer.from(await new Response(toCache).arrayBuffer())
		).catch(() => {})

		return new Response(toClient, {
			headers: {
				"Content-Type": upstream.headers.get("content-type") ?? "image/png",
				"Cache-Control": "public, max-age=86400"
			}
		})
	} catch (e) {
		if (e instanceof CardSourceRateLimitedError) {
			return new Response("Rate limited", { status: 429 })
		}
		if (e instanceof CardSourceUnavailableError) {
			return new Response("Unavailable", { status: 502 })
		}
		return new Response("Not found", { status: 404 })
	}
}
