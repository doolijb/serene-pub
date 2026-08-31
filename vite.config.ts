import tailwindcss from "@tailwindcss/vite"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"
import pkg from "./package.json"
import banner from "vite-plugin-banner"

/**
 * Hand Vite's own HTTP server to the app so Socket.IO can attach to it.
 *
 * Socket.IO used to run its own listener on `SOCKETS_PORT`; it now shares the
 * one server that serves the pages, which is what makes a socket handshake
 * same-origin. Neither Vite nor adapter-node passes its `http.Server` into app
 * code, so both hand it over on `globalThis` and `src/hooks.server.ts` picks it
 * up on the first request. See `scripts/customize-build.js` for the production
 * half of this.
 */
function serenePubSocketServer() {
	const stash = (server: any) => {
		if (server.httpServer) {
			;(globalThis as any).__SERENE_PUB_HTTP_SERVER__ = server.httpServer
		}
		// Vite's dev server rejects any Host header it does not recognise
		// (DNS-rebinding protection). A tunnel hostname is generated at
		// runtime and cannot be in the static list below, so the tunnel
		// supervisor pushes it here when it starts — otherwise the freshly
		// generated URL answers with "Blocked request. This host is not
		// allowed." and nothing about it points at Vite.
		//
		// Dev only. The production adapter-node server has no such check.
		;(globalThis as any).__SERENE_PUB_ALLOW_DEV_HOST__ = (
			hostname: string
		) => {
			const allowed = server.config?.server?.allowedHosts
			if (Array.isArray(allowed) && !allowed.includes(hostname)) {
				allowed.push(hostname)
			}
		}
	}
	return {
		name: "serene-pub-socket-server",
		configureServer: stash,
		configurePreviewServer: stash
	}
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		serenePubSocketServer(),
		banner(
			`/**\n * name: ${pkg.name}\n * version: v${pkg.version}\n * description: ${pkg.description}\n * author: ${JSON.stringify(pkg.author)}\n * homepage: ${pkg.homepage}\n */`
		)
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_VERSION_DISPLAY__: JSON.stringify(
			`v${pkg.version}${pkg.version.includes("-") ? "" : "-alpha"}`
		)
	},
	server: {
		/**
		 * Hosts the dev server will answer for, beyond localhost.
		 *
		 * Only what the operator named in ALLOWED_ORIGINS. The wildcard is
		 * skipped because it identifies no host, and a tunnel's own hostname is
		 * added at runtime by the supervisor once it exists — Vite re-reads this
		 * array on every request, so the exact hostname can be granted rather
		 * than a domain guessed at in advance.
		 *
		 * Deliberately no `.trycloudflare.com` entry: a leading dot matches
		 * every subdomain, so that would trust every quick tunnel on the
		 * internet to reach this dev server, when only one hostname is ever
		 * needed. And deliberately not `true`, which disables the
		 * DNS-rebinding check outright on a server with a live database behind
		 * it.
		 */
		allowedHosts: (process.env.ALLOWED_ORIGINS || "")
			.split(",")
			.map((h) => h.trim())
			.filter((h) => h && h !== "*")
	},
	resolve: {
		extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json", ".svelte"]
	},
	build: {
		rollupOptions: {
			plugins: [
				{
					name: "customize-server-output",
					generateBundle(options, bundle) {
						// Modify the index.js file specifically
						Object.keys(bundle).forEach((fileName) => {
							if (
								fileName === "index.js" &&
								bundle[fileName].type === "chunk"
							) {
								let code = bundle[fileName].code

								// Replace console.log messages
								code = code.replace(
									/console\.log\(`Listening on file descriptor/g,
									"console.log(`🚀 Serene Pub listening on file descriptor"
								)
								code = code.replace(
									/console\.log\(`Listening on \$\{path/g,
									"console.log(`🚀 Serene Pub listening on ${path"
								)

								// You can add more replacements here
								code = code.replace(
									/graceful_shutdown\(reason\)/g,
									"graceful_shutdown(reason); console.log(`👋 Serene Pub shutting down (${reason})`)"
								)

								bundle[fileName].code = code
							}
						})
					}
				}
			]
		}
	}
})
