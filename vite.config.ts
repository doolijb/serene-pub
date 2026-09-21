import tailwindcss from "@tailwindcss/vite"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"
import pkg from "./package.json"
import banner from "vite-plugin-banner"
import path from "node:path"
import {
	buildDocs,
	DOC_ASSETS_DIR,
	SDK_GUIDES_DIR,
	DOCS_IGNORED_DIRS,
	GUIDES_DIR
} from "./scripts/build-docs.js"
import { createSingleFlight } from "./scripts/singleFlight.js"

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

/**
 * Compile the docs before anything imports the docs-dist.
 *
 * The app reads `src/lib/generated/docs` and `static/docs/assets`, and both are
 * gitignored build output — so a fresh checkout has neither until this runs.
 * It runs once per build (`buildStart`) and once on dev-server start, and in
 * dev it re-runs when a guide or a doc asset changes.
 *
 * ⚠ A compile failure in dev is logged and swallowed. The compiler throws on a
 * broken link, a broken anchor, a missing image or an exceeded asset budget —
 * all things you hit *while editing a doc* — and taking the dev server down
 * over a half-typed link means losing the running app (and, with it, PGlite's
 * open data directory) for a typo. The last good docs-dist stays on disk and
 * the page keeps working; the error is on the console to fix. A build is the
 * opposite: there, the throw propagates and fails the build.
 */
function serenePubDocs() {
	let compiled = false

	// One compile at a time. The debounce below collapses a burst of watcher
	// events; this collapses a trigger that lands mid-compile into exactly one
	// follow-up, so two compiles never write the same output directory at
	// once (scripts/singleFlight.js).
	const watchCompile = createSingleFlight(() => buildDocs({ watch: true }))

	const compile = async (opts?: { watch?: boolean }) => {
		try {
			if (opts?.watch) await watchCompile()
			else await buildDocs(opts)
			return true
		} catch (err: any) {
			console.error(
				`\n[docs] compile failed — keeping the last good output.\n` +
					`[docs] ${err?.stack ?? err?.message ?? err}\n`
			)
			return false
		}
	}

	return {
		name: "serene-pub-docs",
		async buildStart() {
			// Vite calls buildStart per environment (client and SSR share one
			// process in dev), and configureServer has already run by then.
			if (compiled) return
			compiled = true
			// In a real build the compiler's failures are the build's: a
			// shipped page linking at nothing is exactly what it exists to
			// prevent.
			await buildDocs()
		},
		async configureServer(server: any) {
			compiled = true
			await compile()

			const watched = [GUIDES_DIR, DOC_ASSETS_DIR, SDK_GUIDES_DIR]
			server.watcher.add(watched)

			let timer: NodeJS.Timeout | undefined
			const onChange = (file: string) => {
				const abs = path.resolve(file)
				// The compiler's own writes must never re-trigger it.
				if (
					DOCS_IGNORED_DIRS.some((d) => abs.startsWith(d + path.sep))
				) {
					return
				}
				if (!watched.some((dir) => abs.startsWith(dir + path.sep))) {
					return
				}
				// Saving a doc that references three new screenshots fires four
				// watcher events in a row; one recompile is enough, and the
				// compile is not cheap (shiki + image conversion).
				clearTimeout(timer)
				timer = setTimeout(async () => {
					if (await compile({ watch: true })) {
						// Full reload rather than an HMR update: the page HTML
						// is a lazily-globbed ?raw module, and the nav and
						// search index are separate files the open page has
						// already read.
						server.ws.send({ type: "full-reload" })
					}
				}, 300)
			}

			server.watcher.on("add", onChange)
			server.watcher.on("change", onChange)
			server.watcher.on("unlink", onChange)
		}
	}
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		serenePubSocketServer(),
		serenePubDocs(),
		banner(
			`/**\n * name: ${pkg.name}\n * version: v${pkg.version}\n * description: ${pkg.description}\n * author: ${JSON.stringify(pkg.author)}\n * homepage: ${pkg.homepage}\n */`
		)
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		// Shown to users in Settings, the admin shell and the About page, so it
		// states the version and nothing else. It used to append "-alpha" to any
		// version without a suffix, which meant a formal release displayed as
		// "v0.7.0-alpha" — inventing a maturity claim the tag never made, and
		// the exact inverse of the pre-release marker's job. Alpha nomenclature
		// is retired; whether a build is a pre-release is decided by
		// isPrereleaseVersion() in $lib/shared/utils/releaseChannel, never here.
		__APP_VERSION_DISPLAY__: JSON.stringify(`v${pkg.version}`)
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
