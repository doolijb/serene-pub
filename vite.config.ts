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
	const stash = (server: { httpServer: unknown | null }) => {
		if (server.httpServer) {
			;(globalThis as any).__SERENE_PUB_HTTP_SERVER__ = server.httpServer
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
