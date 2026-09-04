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
/** @param {string} envVar */
function cspList(envVar) {
	return (process.env[envVar] || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

// Socket.IO shares the app's own HTTP server, so its polling transport (plain
// http(s):// XHR, which it tries before upgrading to WebSocket) is same-origin
// and already covered by 'self'. Only the WebSocket upgrade still needs naming:
// 'self' matching ws:/wss: on the same origin is specified, but has been
// inconsistent across browsers historically, so the schemes stay listed rather
// than relying on it.
//
// This used to also list "http:" and "https:" — any host, any port. That was
// not laxness for its own sake: the socket server ran on its own port
// (SOCKETS_PORT vs PORT), so a legitimate connection was always cross-origin
// from the page's point of view, and the port could not be named at build time
// (svelte.config.js runs under plain Node during `npm run build`, which never
// loads .env) nor even at runtime under a proxy that exposes only 443. With one
// listener there is no other origin to reach, so those two entries are gone —
// if a socket bug ever tempts you to add them back, the connection is
// same-origin now and 'self' is the entry that covers it.
const socketConnectSrc = ["ws:", "wss:"]

// The community library does NOT load card art with <img src="https://...">.
// RetryableImage.svelte fetch()es the PNG and hands the <img> a blob: URL
// (see its fetch -> response.blob() -> URL.createObjectURL chain), so the
// request is governed by connect-src, NOT img-src. That is why img-src's
// "https:" entry does not cover it, and why narrowing connect-src to
// ws:/wss: silently emptied the library: every card was blocked with
// "Refused to connect because it violates the document's Content Security
// Policy", the grid rendered zero <img> elements, and no img-src change
// could have fixed it. Narrow this list if you like, but do not remove the
// library host without checking RetryableImage first.
//
// CharaVault needs no entry here: its card images are proxied same-origin
// through /library/cardImage/charavault/ (charavault.net sends a
// Cross-Origin-Resource-Policy header that blocks direct cross-site loads),
// and the rest of its API is called server-side, where page CSP does not
// apply.
const libraryConnectSrc = ["https://raw.githubusercontent.com"]

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
					...libraryConnectSrc,
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
				"frame-ancestors": ["none"]
			}
		}
	}
}

export default config
