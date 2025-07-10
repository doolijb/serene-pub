import tailwindcss from "@tailwindcss/vite"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"
import pkg from "./package.json"
import banner from "vite-plugin-banner"

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		banner(
			`/**\n * name: ${pkg.name}\n * version: v${pkg.version}\n * description: ${pkg.description}\n * author: ${JSON.stringify(pkg.author)}\n * homepage: ${pkg.homepage}\n */`
		)
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_VERSION_DISPLAY__: JSON.stringify(`v${pkg.version}-alpha`)
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
