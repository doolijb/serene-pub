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
import { RateLimitTimeoutError } from "$lib/server/cardSources/charaVault/rateLimiter"
import {
	CardSourceInvalidRefError,
	CardSourceRateLimitedError,
	CardSourceUnavailableError
} from "$lib/server/cardSources/types"
import {
	getOrFetchCardBytes,
	IMAGE_TTL_MS
} from "$lib/server/cardSources/diskCache"

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
	// Round-5 (post-implementation live testing) diagnostic — see the plan.
	// Not the fetcher's own start (getOrFetchCardBytes may dedupe into an
	// already-in-flight fetch), just a fixed reference point both this
	// handler's catch and the fetcher below can measure elapsed time
	// against. Includes any rate-limiter queue wait (acquire() is deeper in
	// the call chain, inside fetchCharaVaultCardResponse) — stated honestly
	// in the log output rather than presented as clean.
	const fetcherStartedAt = Date.now()

	try {
		// getOrFetchCardBytes handles the cache-hit fast path, the cache-miss
		// fetch, the disk write, AND deduping concurrent requests for the same
		// not-yet-cached key (the same card shown twice, a fast reload) into
		// one shared upstream fetch — already-tested machinery from
		// diskCache.ts (also used by the GitHub YAML and CharaVault
		// card-detail/import paths), reused as-is rather than hand-rolled per
		// route. This replaces an earlier tee()-based streaming approach that
		// tried to dedupe concurrent callers by re-tee()ing an in-flight
		// response — not actually possible, since a ReadableStream tee'd once
		// is locked to its two original branches. IMAGE_TTL_MS (not the
		// shorter default) reflects that a CharaVault image, once published
		// under a given ref, doesn't change in place.
		const bytes = await getOrFetchCardBytes(
			cacheKey,
			async (signal) => {
				const upstream = await fetchCharaVaultCardResponse(
					{ folder, file },
					"background",
					signal
				)
				const headersElapsedMs = Date.now() - fetcherStartedAt
				try {
					return Buffer.from(await upstream.arrayBuffer())
				} catch (e) {
					// Round-5 fix: a failure reading the body (eg. the same
					// upstream timeout signal firing mid-transfer instead of
					// while waiting for headers) used to propagate as a raw,
					// unclassified error — matching none of this route's
					// instanceof branches below and falling through to a
					// misleading 404, which RetryableImage.svelte deliberately
					// never retries (permanent-failure statuses only). Any
					// body-read failure now takes the same retryable
					// 502-with-no-store path a headers-phase failure already
					// does. Shape-agnostic on purpose — a mid-body abort isn't
					// guaranteed to surface as a TimeoutError DOMException
					// specifically (some Node/undici versions produce a
					// TypeError with the real reason in .cause instead), so
					// this doesn't pattern-match the error, it just reclassifies
					// whatever it is.
					const bodyPhaseMs =
						Date.now() - fetcherStartedAt - headersElapsedMs
					console.warn(
						`[image-proxy] ${cacheKey}: body read failed — ${(e as Error)?.constructor?.name ?? typeof e}` +
							`${(e as any)?.cause?.name ? ` (cause: ${(e as any).cause.name})` : ""}, ` +
							`headers ${headersElapsedMs}ms + body ${bodyPhaseMs}ms = ${headersElapsedMs + bodyPhaseMs}ms ` +
							`(compare to CHARAVAULT_IMAGE_FETCH_TIMEOUT_MS=45000 + any queue wait — the deadline covers headers+body combined, not body alone)`
					)
					throw new CardSourceUnavailableError(
						"Card image transfer failed or timed out",
						{ cause: e }
					)
				}
			},
			event.request.signal,
			IMAGE_TTL_MS
		)

		return new Response(new Uint8Array(bytes), {
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=86400"
			}
		})
	} catch (e) {
		if (event.request.signal.aborted) {
			// Client disconnected (navigated away, tab closed) while this was
			// in flight — the signal aborting rejects getOrFetchCardBytes's
			// per-caller promise with the signal's own reason, matching none
			// of the branches below. Nothing to send back, and deliberately
			// kept out of those branches so logs/tests aren't polluted with a
			// misleading 404 for "nobody's listening anymore."
			return new Response(null, { status: 499 })
		}
		// Round-5 diagnostic (temporary — remove once the dominant failure
		// mode is confirmed via real traffic; see the plan's Fix 3). message
		// distinguishes a headers-phase timeout ("Failed to reach
		// CharaVault: ...") from a genuine non-OK status ("Failed to fetch
		// CharaVault card: <status>") for errors that never reach the
		// body-read wrap above at all.
		console.warn(
			`[image-proxy] ${cacheKey}: ${(e as Error)?.constructor?.name ?? typeof e}` +
				`${(e as any)?.cause?.name ? ` (cause: ${(e as any).cause.name})` : ""} — ` +
				`${(e as Error)?.message ?? ""} — ${Date.now() - fetcherStartedAt}ms total (includes any rate-limiter queue wait)`
		)
		if (e instanceof CardSourceRateLimitedError) {
			return new Response("Rate limited", {
				status: 429,
				headers: { "Retry-After": "5", "Cache-Control": "no-store" }
			})
		}
		if (e instanceof RateLimitTimeoutError) {
			// Queued too long behind higher-priority (search/detail) traffic,
			// or the background queue was already full — tell the client to
			// retry rather than hanging the request. The grid already
			// tolerates a missing/failed thumbnail with a fallback icon.
			return new Response("Rate limited", {
				status: 429,
				headers: { "Retry-After": "5", "Cache-Control": "no-store" }
			})
		}
		if (e instanceof CardSourceInvalidRefError) {
			return new Response("Bad request", {
				status: 400,
				headers: { "Cache-Control": "no-store" }
			})
		}
		if (e instanceof CardSourceUnavailableError) {
			return new Response("Unavailable", {
				status: 502,
				headers: { "Cache-Control": "no-store" }
			})
		}
		return new Response("Not found", {
			status: 404,
			headers: { "Cache-Control": "no-store" }
		})
	}
}
