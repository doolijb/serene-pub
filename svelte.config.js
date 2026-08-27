import adapter from "@sveltejs/adapter-node"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

// Extra allowances for hosting-specific injected content that isn't part of
// the app itself — eg. Cloudflare's edge-injected "Browser Insights" beacon
// (static.cloudflareinsights.com) when a deployment is proxied through
// Cloudflare with that feature on. Comma-separated. Prefer disabling such
// features at the CDN/proxy level over widening this, since it's an
// injected script this app has no control over — but the escape hatch
// exists for cases where that isn't an option. See HOSTING.md.
function cspList(envVar) {
	return (process.env[envVar] || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

// The socket server always runs on a different port than the main app
// (SOCKETS_PORT vs PORT), so 'self' alone isn't enough for connect-src, and
// Socket.IO tries polling (plain http(s):// XHR) before upgrading to
// WebSocket by default, so ws:/wss: alone isn't enough either — that scheme
// source doesn't match http(s):// requests at all.
//
// This intentionally does NOT try to scope the port: svelte.config.js runs
// during `npm run build` via plain Node, which never loads .env (only this
// app's own runtime code does, once the server actually starts) — so
// process.env.SOCKETS_PORT is unreliable here regardless of what's
// configured at runtime. More fundamentally, a reverse-proxied/tunneled
// deployment (see HOSTING.md) has the browser connect on the public port
// (443/80) with the proxy routing internally to SOCKETS_PORT — the
// browser-facing URL never contains that port at all, so a port-scoped
// source can't cover that mode regardless of the build-time issue. Scheme-
// only sources (any host, any port) are what actually work across every
// documented hosting mode without requiring a rebuild when config changes.
const socketConnectSrc = ["http:", "https:", "ws:", "wss:"]

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
