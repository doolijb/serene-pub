// scripts/build-docs.js
// Runs the docs compiler (@serene-pub/docs) over the documentation sources and
// writes a docs-dist. One compiler, two profiles — the same pages, compiled for
// two different hosts (NOMENCLATURE §27):
//
//   app  — guides + the SDK catalog and laws, into src/lib/generated/docs and
//          static/docs/assets. What the app ships and what the Vite plugin
//          builds, in dev and on a build.
//   site — the same two sources plus the TypeDoc API reference, into docs-site/
//          at the repo root. serenepub.com copies that tree whole; the app
//          never reads it. `npm run docs:site` only.
//
// The API reference is the whole reason there are two: TypeDoc's pages render
// to 2.4 MB of HTML — three and a half times the guides and the catalog put
// together — and every bundle and every APK would carry it to serve a
// reference a browser reads once. A website has room for that; a phone does
// not, and the page budget said so.
//
// Nothing here renders markdown. The compiler owns the docs dialect, the
// link and anchor checking, the image conversion and the asset budget; this
// script only says which sources exist, where the output goes, and what the
// numbers were. See NOMENCLATURE §27 for the vocabulary.
//
// Run it directly (`npm run docs:build`, `npm run docs:site`) or let the Vite
// plugin in vite.config.ts call buildDocs() on a build and on dev-server start.

import fs from "fs"
import path from "path"
import child_process from "child_process"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const appRoot = path.resolve(path.dirname(__filename), "..")

// Read rather than `import ... with { type: "json" }`: vite.config.ts imports
// this module, and Vite loads its config by bundling it with esbuild, which
// does not carry import attributes through reliably. fs is boring and works
// in both entry paths.
const pkg = JSON.parse(
	fs.readFileSync(path.join(appRoot, "package.json"), "utf8")
)

/**
 * The SDK checkout the reference pages are rendered from: beside this repo, or
 * wherever SERENE_PUB_SDK_DIR points. The published packages carry no guides,
 * so a build with the SDK installed from npm still needs this checkout (CI
 * clones it at the pinned version: .github/actions/sdk-docs).
 */
const SDK_REPO_DIR = path.resolve(
	appRoot,
	process.env.SERENE_PUB_SDK_DIR || "../serene-pub-sdk"
)

/**
 * The TypeDoc API reference, written by the SDK's own build (`docs:api`, which
 * its `build` script runs). Generated, gitignored, and therefore absent in a
 * checkout nobody has built yet — which is a warning, not a failed docs build.
 */
const SDK_API_DIR = path.join(SDK_REPO_DIR, "docs/generated/api")

/**
 * The hand-written SDK guides, in the SDK repo at `guides/<slug>.md`.
 *
 * Prose a person wrote, not pages rendered from a declaration — which is why
 * they live beside the packages they teach rather than under `docs/` here: the
 * SDK repo is public, its guides are read on GitHub as well as in the app, and
 * a guide's runnable fences are run by the SDK's own suite
 * (`sdk-tests/guides.test.ts`) against the same playground runner the page
 * gives a reader. Compiled as a `dir` source, exactly like the app's guides.
 *
 * Absent — an older SDK checkout, or one fetched before the directory existed —
 * is a warning and a skipped source, never a failed docs build.
 */
export const SDK_GUIDES_DIR = path.join(SDK_REPO_DIR, "guides")

/**
 * The executed examples, written by the SDK's build too (`docs:examples`):
 * each page is an example's source, run against the fixture host, with its
 * output checked against a golden. The app never runs an example itself —
 * it only reads what the SDK build proved. Both profiles carry them.
 */
const SDK_EXAMPLES_DIR = path.join(SDK_REPO_DIR, "docs/generated/examples")

/**
 * The **playground** document (NOMENCLATURE §27) — the page a `playground`
 * block's iframe loads, built by the SDK's own build into `playground/dist`.
 *
 * It is a whole little site (an entry document plus whatever it bundles), not
 * a page the compiler renders, so it is copied rather than compiled. Both
 * profiles carry it: it is the runner for the same blocks in the same pages,
 * and the app serves it out of `static/` exactly as it serves the converted
 * assets. Absent — the SDK has not been built, or does not have one yet — is a
 * warning and playground blocks stay static, never a failed docs build.
 */
const SDK_PLAYGROUND_DIR = path.join(SDK_REPO_DIR, "playground/dist")

/**
 * The two source trees a dev-server recompile watches, absolute.
 *
 * Exported so vite.config.ts does not have to resolve them itself — a bundled
 * ESM config has no dependable `__dirname`, and a watcher pointed at the wrong
 * directory fails silently (nothing ever recompiles) rather than loudly.
 */
export const GUIDES_DIR = path.join(appRoot, "docs")
export const DOC_ASSETS_DIR = path.join(appRoot, "docs-assets")

/** Where the app profile's docs-dist lands: pages, manifest and search index. */
export const DOCS_OUT_DIR = path.join(appRoot, "src/lib/generated/docs")

/** Where the app profile's converted images land, served from static/. */
export const DOCS_ASSETS_OUT_DIR = path.join(appRoot, "static/docs/assets")

/**
 * Where the site profile's docs-dist lands: one self-contained tree at the repo
 * root, `manifest.json` / `search.json` / `pages/**` beside an `assets/`.
 *
 * Deliberately not under `src/` or `static/`: nothing the app imports or ships
 * may reach it, and a single directory is what serenepub.com's `docs:sync`
 * copies. Gitignored — it is build output, like the other two.
 */
export const DOCS_SITE_OUT_DIR = path.join(appRoot, "docs-site")

/**
 * The profiles: which sources a compile reads, and where it writes them.
 *
 * `app` is the default and the only one the Vite plugin ever asks for, in dev
 * and on a build. `site` is asked for by hand (`npm run docs:site`) and exists
 * to carry the API reference the app's page budget deliberately will not.
 *
 * Both write the same `assetsBase`, so a page's `<img src>` is the same string
 * in both trees — the app serves the assets out of `static/`, the website out
 * of its own `static/docs/assets` after the sync copies them there.
 */
const PROFILES = {
	app: {
		out: DOCS_OUT_DIR,
		assetsOut: DOCS_ASSETS_OUT_DIR,
		api: false
	},
	site: {
		out: DOCS_SITE_OUT_DIR,
		assetsOut: path.join(DOCS_SITE_OUT_DIR, "assets"),
		api: true
	}
}

/**
 * Trees a docs change must never be read out of — everything the compile
 * writes, plus the generated and static parents around it.
 *
 * The compiler's own writes fire the same watcher events a doc edit does, and
 * a recompile triggered by its own output is a loop rather than a rebuild.
 * Named whole (`src/lib/generated`, `static/docs`) rather than by the two exact
 * directories: nothing under either is a docs SOURCE, so widening the ignore
 * costs nothing and survives the output moving one level.
 */
export const DOCS_IGNORED_DIRS = [
	path.join(appRoot, "src/lib/generated"),
	path.join(appRoot, "static/docs")
]

/**
 * Reading order for the guides — the hand-written pages under `docs/` — as
 * **order groups** (NOMENCLATURE §27): each group is its own section of the
 * Help nav, while the files stay flat in `docs/` so no slug or link moves.
 *
 * Every file under docs/ must appear here. This list used to live in
 * `src/lib/shared/utils/docsIndex.ts` as DOC_ORDER, where an unlisted doc got
 * `indexOf` → -1 and sorted *ahead* of "getting-started" instead of falling to
 * the end; that is how "android" and "troubleshooting" once became the first
 * two cards a new user saw. The compiler now owns ordering: a page missing from
 * this list is appended alphabetically to a trailing group headed by the
 * source's own `group` ("Using Serene Pub") *and* reported as a warning, so it
 * lands at the end and says so, instead of jumping the queue in silence.
 *
 * Adding a page is one line: write `docs/<slug>.md`, then put `"<slug>"` in
 * the group it belongs to, at the place a reader should meet it. A slug listed
 * here with no file yet only warns; a group none of whose pages exist yet is
 * left out of the nav. Moving a page between groups never changes its URL.
 *
 * The groups and what goes in each are the IA of the beginner-first rewrite
 * (plans/DOCS-beginner-first-rewrite-2026-09-27.md §3). `data-model-notes`
 * is contributor rationale, so it sits last under For power users rather
 * than beside the beginner guides.
 */
export const GUIDE_ORDER = [
	{
		group: "Start here",
		pages: [
			"getting-started",
			"what-is-serene-pub",
			"install",
			"connect-a-model",
			// The path's last step: getting-started's numbered list ends here,
			// and the page reads as both that step and a map to come back to.
			"getting-around"
		]
	},
	{
		group: "Guides",
		pages: [
			"characters",
			"personas",
			"sessions",
			"group-sessions",
			"session-layout",
			"genres",
			"genre-adventure",
			"genre-lair",
			"lorebooks",
			"lorebook-cast",
			"lorebook-places",
			"lorebook-time",
			"summarization",
			"embeddings-and-rag",
			"stats-and-states",
			"tags",
			"themes-and-settings",
			"languages",
			"connections",
			"users-and-accounts",
			"document-view",
			"android"
		]
	},
	{
		group: "How-to",
		pages: ["coming-from-sillytavern", "importing-from-sillytavern", "updating", "upgrading-from-0.5", "hosting"]
	},
	{
		group: "For power users",
		pages: [
			"pipelines",
			"session-actions",
			"context-templates",
			"system-settings",
			"component-authoring",
			"data-model-notes"
		]
	},
	{
		group: "Reference and help",
		pages: ["environment-variables", "troubleshooting", "release-notes/0.6.0-pr-1"]
	}
]

/**
 * Reading order for the hand-written SDK guides, which the app repo owns for
 * the same reason it owns GUIDE_ORDER: the nav is an editorial decision, and
 * the SDK repo does not know where in this reading order its guides belong.
 *
 * A guide missing from this list is appended alphabetically and reported as a
 * warning — the compiler's rule, not a special case for this source.
 */
const SDK_GUIDE_ORDER = ["extending", "vocabulary", "your-first-plugin", "widgets", "frames", "channels", "events", "storage", "forms-and-effects", "plugin-permissions", "where-values-come-from"]

/**
 * Reading order for the catalog-and-laws source, derived from its own pages.
 *
 * The pages are rendered from a package's announcement, so most of the list
 * cannot be written down here — which genre and which pipelines exist is the
 * announcement's business. What IS editorial is the shape of the read: what
 * the package is, then the genres it declares, then the pipelines that answer
 * their events, and last the guarantees a host owes all of it. Deriving the
 * order means every page is in it, so nothing is ever appended (and warned
 * about) behind the compiler's back.
 *
 * @param {{ path: string }[]} pages
 * @returns {string[]} bare slugs, in reading order
 */
function sdkReadingOrder(pages) {
	/** @param {string} p */
	const rank = (p) => {
		if (p === "index.md") return 0
		if (p.startsWith("genres/")) return 1
		if (p.startsWith("pipelines/")) return 2
		if (p === "laws.md") return 3
		return 4
	}
	return [...pages]
		.sort(
			(a, b) => rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : 1)
		)
		.map((page) => page.path.replace(/\.md$/, ""))
}

/**
 * Reading order for the API reference: its index, then the modules
 * alphabetically. TypeDoc writes one page per module and no opinion about
 * which to read first; the index is the only page that is not a module.
 *
 * @param {{ path: string }[]} pages
 * @returns {string[]} bare slugs, in reading order
 */
function apiReadingOrder(pages) {
	const slugs = pages.map((page) => page.path.replace(/\.md$/, "")).sort()
	return ["index", ...slugs.filter((slug) => slug !== "index")]
}

/**
 * The notice the compiler prepends to every SDK reference page.
 *
 * Emitted by the build rather than written into a page, so no reference page
 * can forget it — the pages are rendered from declarations and nobody edits
 * them by hand (NOMENCLATURE §27, "banner").
 */
const SDK_BANNER =
	"Plugins are a preview in Serene Pub 0.6: releases ship with them " +
	"switched off (an administrator turns them on with SP_PLUGINS_ENABLED), " +
	"and the SDK may still change before its first stable release in 0.7. " +
	"This reference describes the SDK the app runs."

/**
 * The guides are written for plugin authors, so the last sentence of the
 * reference banner ("describes the SDK the app runs") would mislead here.
 */
const SDK_GUIDES_BANNER =
	"Plugins are a preview in Serene Pub 0.6: releases ship with them " +
	"switched off (an administrator turns them on with SP_PLUGINS_ENABLED), " +
	"and the SDK may still change before its first stable release in 0.7. " +
	"Everything on this page builds and runs today."

/** Assets are served from static/, which ships whole — 6 MB is the ceiling. */
const ASSET_BUDGET_BYTES = 6 * 1024 * 1024

/**
 * The SDK checkout's current commit, for the "rendered from" line on reference
 * pages. Best-effort: a copy with no git dir (CI's SDK docs content, a source
 * archive) has no commit to report, which is not a reason to fail a docs
 * build.
 */
function sdkCommit() {
	try {
		const out = child_process.execSync("git rev-parse --short HEAD", {
			cwd: SDK_REPO_DIR,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"]
		})
		return out.trim() || undefined
	} catch {
		return undefined
	}
}

/**
 * Every file under `dir`, as paths relative to `base`. Missing dir → empty.
 *
 * @param {string} dir
 * @param {string} [base]
 * @returns {string[]}
 */
function listFiles(dir, base = dir) {
	if (!fs.existsSync(dir)) return []
	/** @type {string[]} */
	const out = []
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) out.push(...listFiles(full, base))
		else if (entry.isFile()) out.push(path.relative(base, full))
	}
	return out
}

/**
 * Remove directories under `dir` that have nothing left in them, deepest
 * first. `dir` itself is kept.
 *
 * @param {string} dir
 */
function pruneEmptyDirs(dir) {
	if (!fs.existsSync(dir)) return
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const full = path.join(dir, entry.name)
		pruneEmptyDirs(full)
		if (fs.readdirSync(full).length === 0) fs.rmdirSync(full)
	}
}

/**
 * Latched so the dev-server watcher says this once per process rather than on
 * every recompile — the fact does not change between keystrokes, and the
 * watch summary is deliberately one line.
 */
let warnedNoPlayground = false

/**
 * Copy the playground document into a profile's output, write-then-prune.
 *
 * Never `rm -rf` the destination first: a dev server may be serving the frame
 * out of it at this moment, and a reader who pressed the button during a
 * recompile would get a 404 rather than a slightly stale document. So every
 * file is written over in place and only then is anything the source no longer
 * has removed.
 *
 * @param {string} outDir
 * @returns {number} files written
 */
function syncPlayground(outDir) {
	const files = listFiles(SDK_PLAYGROUND_DIR)
	if (!files.length) {
		if (!warnedNoPlayground) {
			warnedNoPlayground = true
			console.warn(
				`[docs] no playground at ${SDK_PLAYGROUND_DIR} — run ` +
					"`npm run sdk:build`; playground blocks stay static."
			)
		}
		return 0
	}
	for (const rel of files) {
		const dest = path.join(outDir, rel)
		fs.mkdirSync(path.dirname(dest), { recursive: true })
		fs.copyFileSync(path.join(SDK_PLAYGROUND_DIR, rel), dest)
	}
	const keep = new Set(files)
	for (const rel of listFiles(outDir)) {
		if (!keep.has(rel)) fs.rmSync(path.join(outDir, rel), { force: true })
	}
	pruneEmptyDirs(outDir)
	return files.length
}

/** @param {number} bytes */
function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Compile a profile's sources into its docs-dist.
 *
 * One profile per call: a run of this script builds `app` or `site`, never
 * both. The two trees are written by two separate compiles, which means the
 * images are converted once per run rather than shared between them — and that
 * is the cheap half of the compile (one 47 KB asset today), while the shiki
 * highlighting of a few dozen pages is the expensive half and cannot be shared
 * anyway. The converted files land under the same names in both trees because
 * the compiler names an asset after the sha256 of its OUTPUT bytes.
 *
 * @param {{ watch?: boolean, profile?: keyof typeof PROFILES }} [options]
 *   `watch: true` marks a recompile driven by the dev-server watcher, which
 *   only makes the summary a single line instead of the full report — the
 *   compile itself is identical. `profile` defaults to `app`.
 * @returns {Promise<import("@serene-pub/docs").CompileDocsReport>}
 * @throws whatever the compiler throws: a broken `.md` link, a broken anchor, a
 *   missing image or an exceeded asset budget are all build failures by design.
 */
export async function buildDocs({ watch = false, profile = "app" } = {}) {
	const target = PROFILES[profile]
	if (!target) {
		throw new Error(
			`Unknown docs profile \`${profile}\` — expected ` +
				`${Object.keys(PROFILES).join(" or ")}.`
		)
	}

	// Imported here, not at module scope, so a missing or half-built
	// @serene-pub/docs surfaces as a caught error inside buildDocs() rather
	// than as vite.config.ts failing to load — which would take the dev server
	// down over documentation.
	const { compileDocs, loadMarkdownDir } = await import("@serene-pub/docs")
	const {
		renderAnnouncementDocs,
		renderLawsDocs,
		typeSurfaces,
		pipelineResolver
	} = await import("@serene-pub/cli")
	const { coreAnnouncement } = await import("@serene-pub/core-catalog")
	const announcement = coreAnnouncement().document

	/** One "rendered from" link, shared by every source rendered from the SDK. */
	const sdkRepo = {
		url: "https://github.com/SerenePub/serene-pub-sdk",
		commit: sdkCommit()
	}

	// The catalog, then the laws. One source, because both are rendered from
	// the same checkout and a reader moves between them: what this package
	// ships, and what the host running it has to guarantee.
	const sdkPages = [
		...renderAnnouncementDocs(announcement, await typeSurfaces()),
		...renderLawsDocs()
	]

	// The hand-written guides are checked for rather than loaded: a `dir`
	// source reads its own directory, and the compiler's readdir on a missing
	// one is an ENOENT, not a skipped source. Both profiles carry them — a
	// guide is prose, which is exactly what a phone has room for.
	const hasSdkGuides = fs.existsSync(SDK_GUIDES_DIR)
	if (!hasSdkGuides) {
		console.warn(
			`[docs] no SDK guides at ${SDK_GUIDES_DIR}; compiling without them. ` +
				`App pages link to them, so expect broken-link errors: clone ` +
				`https://github.com/SerenePub/serene-pub-sdk at v<the @serene-pub/sdk version ` +
				`package.json pins> beside this repo, or point SERENE_PUB_SDK_DIR at a checkout.`
		)
	}

	// The API reference is written by the SDK's own build (`npm run sdk:build`),
	// so a checkout nobody has built yet simply has none. The guides and the
	// catalog are worth compiling without it — say what is missing and go on.
	//
	// Only the site profile reads it at all, so only the site profile has
	// anything to say about it missing: warning the app build about a directory
	// it would ignore if it existed is noise on every dev-server start.
	const apiPages =
		target.api && fs.existsSync(SDK_API_DIR)
			? await loadMarkdownDir(SDK_API_DIR)
			: null
	if (target.api && !apiPages) {
		console.warn(
			`[docs] no API reference at ${SDK_API_DIR} — run \`npm run sdk:build\` ` +
				`to generate it; compiling without the SDK API source.`
		)
	}

	const examplePages = fs.existsSync(SDK_EXAMPLES_DIR)
		? await loadMarkdownDir(SDK_EXAMPLES_DIR)
		: null
	if (!examplePages) {
		console.warn(
			`[docs] no executed examples at ${SDK_EXAMPLES_DIR} — run ` +
				`\`npm run sdk:build\` to generate them; compiling without them.`
		)
	}

	const sources = [
		{
			id: "app",
			group: "Using Serene Pub",
			dir: GUIDES_DIR,
			order: GUIDE_ORDER
		},
		// Between using the app and the reference, because that is the order a
		// reader arrives in: what the app does, then how to write a plugin for
		// it, then the declarations that plugin is written against. The nav
		// follows this array — `compileDocs` pushes each source's nav groups
		// (one, or one per order group like "app" above) in source order
		// (docs/src/compile.ts, the loop over `bySource`).
		...(hasSdkGuides
			? [
					{
						id: "sdk-guides",
						group: "SDK guides",
						prefix: "sdk/guides",
						dir: SDK_GUIDES_DIR,
						order: SDK_GUIDE_ORDER,
						banner: SDK_GUIDES_BANNER,
						repo: sdkRepo
					}
				]
			: []),
		{
			id: "sdk",
			group: "SDK reference",
			prefix: "sdk",
			pages: sdkPages,
			order: sdkReadingOrder(sdkPages),
			banner: SDK_BANNER,
			repo: sdkRepo
		}
	]
	if (examplePages) {
		sources.push({
			id: "examples",
			group: "SDK examples",
			// The generator already nests its pages under `examples/`, so the
			// prefix is the SDK's: slugs read `sdk/examples/<slug>`.
			prefix: "sdk",
			pages: examplePages,
			order: examplePages.map((p) => p.path.replace(/\.md$/, "")).sort(),
			banner: SDK_BANNER,
			repo: sdkRepo
		})
	}
	if (apiPages) {
		sources.push({
			id: "api",
			group: "SDK API",
			prefix: "sdk/api",
			pages: apiPages,
			order: apiReadingOrder(apiPages),
			banner: SDK_BANNER,
			repo: sdkRepo
		})
	}

	const report = await compileDocs({
		version: pkg.version,
		sources,
		out: target.out,
		assetsOut: target.assetsOut,
		assetsBase: "/docs/assets",
		assetBudgetBytes: ASSET_BUDGET_BYTES,
		// Every catalog page embeds its spec's graph (a `pipeline` fence);
		// the resolver answers those fences from the same announcement the
		// pages were rendered from, so the map and the option tables agree.
		resolvers: { pipeline: pipelineResolver(announcement) }
	})

	// Beside the converted assets, not inside them: `assets/` is named by the
	// compiler and every file in it is content-hashed, while this is a build
	// output with its own names that the page references by a fixed path.
	const playgroundOut = path.resolve(target.assetsOut, "..", "playground")
	const playgroundFiles = syncPlayground(playgroundOut)

	const { assets } = report.manifest
	if (watch) {
		console.log(
			`[docs] ${profile} recompiled — ${report.pagesWritten} pages, ` +
				`${report.assetsWritten} assets` +
				(report.warnings.length
					? `, ${report.warnings.length} warnings`
					: "")
		)
	} else {
		const pageBytes = Object.values(report.manifest.pages).reduce(
			(sum, page) => sum + page.bytes,
			0
		)
		console.log(
			`[docs] ${profile} profile → ${path.relative(appRoot, target.out)}`
		)
		console.log(
			`[docs] ${report.pagesWritten} pages (${formatBytes(pageBytes)}), ` +
				`${report.assetsWritten} assets ` +
				`(${assets.count} total, ${formatBytes(assets.bytes)} of ` +
				`${formatBytes(assets.budgetBytes)})`
		)
		if (playgroundFiles) {
			console.log(
				`[docs] playground: ${playgroundFiles} files → ` +
					`${path.relative(appRoot, playgroundOut)}`
			)
		}
	}
	for (const warning of report.warnings) {
		console.warn(`[docs] warning: ${warning}`)
	}

	return report
}

// Direct invocation: `node scripts/build-docs.js` for the app profile,
// `--site` (i.e. `npm run docs:site`) for the site one. A warning prints and
// the build stands; anything the compiler throws is a failure and exits 1.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
	const profile = process.argv.slice(2).includes("--site") ? "site" : "app"
	buildDocs({ profile }).catch((err) => {
		console.error(`[docs] compile failed: ${err?.message ?? err}`)
		if (err?.stack) console.error(err.stack)
		process.exit(1)
	})
}
