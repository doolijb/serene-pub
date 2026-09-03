import tailwindcss from "@tailwindcss/vite"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"
import pkg from "./package.json"
import banner from "vite-plugin-banner"

/**
 * Publish the dev/preview server's own `http.Server` on `globalThis` so app
 * code can attach Socket.IO to it.
 *
 * Vite owns that server and never hands it to the SvelteKit bundle, so this is
 * the only seam available in dev. `scripts/customize-build.js` does the same
 * job for a production build; `src/routes/+layout.server.ts` is what picks the
 * value up in both cases (and explains why it has to be a route module).
 */
function serenePubSocketServer() {
	const stash = (server: any) => {
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
