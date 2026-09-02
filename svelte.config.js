import adapter from "@sveltejs/adapter-node"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

// Extra allowances for hosting-specific injected content that isn't part of
// the app itself — eg. Cloudflare's edge-injected "Browser Insights" beacon
// (static.cloudflareinsights.com) when a deployment is proxied through
// Cloudflare with that feature on. Comma-separated. Prefer disabling such
// features at the CDN/proxy level over widening this, since it's an
// injected script this app has no control over — but the escape hatch
// exists for cases where that isn't an option. See docs/hosting.md.
// NOTE: these are ALSO merged in at runtime by src/hooks.server.ts, which is
// now the primary path — nothing passes them at build time for published
// artifacts, so the build-time values here are only a convenience for people
// building their own image.
function cspList(envVar) {
	return (process.env[envVar] || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

// Socket.IO shares the app's own server, so its polling transport is
// same-origin and already covered by 'self'. Only the WebSocket upgrade needs
// naming: 'self' matching ws:/wss: on the same origin is specified but has
// been inconsistent across browsers historically, so the schemes stay listed
// rather than relying on it. The previous http:/https: entries — which allowed
// an XHR to any host on any port — are gone; they existed only because the
// socket server lived on a different origin.
const socketConnectSrc = ["ws:", "wss:"]

const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Using SvelteKit's own CSP integration (rather than setting the header
		// manually in hooks.server.ts) so its own injected inline hydration
		// script gets a correct hash/nonce automatically — a hand-rolled header
		// has no way to know that value and would otherwise break hydration.
		csp: {
			mode: "auto",
			directives: {
				"default-src": ["self"],
				"connect-src": [
					"self",
					...socketConnectSrc,
					...cspList("CSP_EXTRA_CONNECT_SRC")
				],
				// "https:" (any host) is needed for inline chat images —
				// `![alt](url)` in a message can point at any image host a user
				// pastes (Imgur, Discord CDN, etc.), so a fixed allowlist isn't
				// workable here the way it is for the other directives. Images
				// can't execute script, so this doesn't open a code-execution
				// surface; the real tradeoff is the same one already noted for
				// inline chat images generally — loading a third-party image
				// leaks the viewer's IP/referrer to that host. No generic
				// image-proxying mechanism exists yet to avoid that (see the
				// chat-image feature's own notes).
				// raw.githubusercontent.com is kept explicit alongside "https:"
				// only for documentation/history — it's redundant now, but
				// records why community-library portraits (src/routes/library/*)
				// were the first thing to need an img-src exception at all.
				// CharaVault's images are NOT covered by this: charavault.net
				// sends a Cross-Origin-Resource-Policy header that blocks direct
				// cross-site <img> loads regardless of what CSP allows, so those
				// go through /library/cardImage/charavault/[...path] (a
				// same-origin server-side proxy) instead. All other CharaVault
				// API traffic already happens server-side (fetch isn't subject
				// to page CSP either way).
				"img-src": [
					"self",
					"data:",
					"blob:",
					"https:",
					"https://raw.githubusercontent.com"
				],
				"style-src": [
					"self",
					"unsafe-inline",
					"https://fonts.googleapis.com",
					...cspList("CSP_EXTRA_STYLE_SRC")
				],
				"script-src": ["self", ...cspList("CSP_EXTRA_SCRIPT_SRC")],
				"font-src": ["self", "data:", "https://fonts.gstatic.com"],
				"object-src": ["none"],
				"base-uri": ["self"],
				"frame-ancestors": ["none"],
				// Exit hardening (20 §11): no form on this app posts anywhere
				// but itself, so a form action to a foreign host can only be
				// an exfiltration attempt — most cheaply, an in-document
				// component wrapping scraped data in a <form>. The other two
				// exits (connect-src, img-src) stay open pending the
				// same-origin-socket and image-ingest decisions recorded in
				// the plan; this one costs nothing today.
				"form-action": ["self"]
			}
		}
	}
}

export default config
