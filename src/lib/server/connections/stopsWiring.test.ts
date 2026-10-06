/**
 * **Every text adapter this app constructs is handed a stop list.**
 *
 * ## The class of defect this closes
 *
 * Since the ruling of 2026-09-10 an adapter composes nothing of its own: it puts
 * `this.stops` in whatever its service calls the field and asks no further
 * questions. That is the point — five copies of the composition disagreed about
 * the wire rule, and one of them put a completion template's role labels on a
 * chat request where they override the model's native stop tokens.
 *
 * It also creates a failure mode the old arrangement did not have. A
 * construction site that forgets `withStops` sends **no stop sequences at all**,
 * and nothing errors: the request is well-formed, the backend is happy, and the
 * model runs on past its answer. It reads as a bad model rather than a bad
 * request — the same silent shape this whole area exists to remove, moved one
 * level up.
 *
 * It is not hypothetical. Three of the five sites — `utils/summarizer/index.ts`,
 * `utils/graphBuilder.ts` and `pipelines/runtime/dispatchStep.ts` — go through
 * `runQueuedLLMCall` rather than through the dispatch, so the two obvious sites
 * being right says nothing about them. Each builds a minimal session with no
 * cast, so they never had `speaker` stops; they DID have their connection's
 * template stops, and losing those is a summary that runs on.
 *
 * ## Why the source, and not a behaviour
 *
 * A behavioural test can only cover the sites somebody remembered to write one
 * for, which is the same memory that would have remembered `withStops`. This
 * reads the tree: every `new …Adapter({` in `$lib/server` that builds a TEXT
 * adapter must have a `withStops` / `composeStopsFor` within reach of it. A
 * sixth site added next year fails here on the day it is written.
 *
 * The walk is guarded, in the shape `paramsSlotWiring.test.ts` uses: an empty
 * scan and a clean tree produce the same silence, so the scan is asserted to
 * have found the sites it is judging before anything is concluded from it.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const ROOT = resolve(__dirname, "../../..")
const SERVER = join(ROOT, "lib/server")

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full, out)
		else if (full.endsWith(".ts") && !full.endsWith(".test.ts"))
			out.push(full)
	}
	return out
}

/**
 * Sites that build an adapter from a family with NO PROMPT, named rather than
 * pattern-matched.
 *
 * None of `BaseImageAdapter`, `BaseEmbeddingAdapter` or `BaseNerAdapter` has a
 * prompt, a completion template or a stop path: `generateImage(req, opts)`,
 * `embedText(req, opts)` and `extractEntities(req, opts)` each take their whole
 * request as a parameter, so a stop list would be meaningless on any of them.
 * Listed by file so each exemption is a decision somebody made rather than a
 * regex that happened not to match.
 */
const NO_PROMPT = new Set([
	"lib/server/sockets/images.ts",
	"lib/server/pipelines/runtime/dispatchImage.ts",
	// `activateApiEmbedding` constructs the embedding adapter the star names and
	// asks it for one vector to learn the width. Nothing about that request has
	// an end to stop at.
	"lib/server/embedding/index.ts",
	// `withEmbeddingProbe` constructs the EMBEDDING adapter `getEmbeddingAdapter`
	// returns and embeds one word, to fail a connection test where the
	// vectorization lane would. It builds no text adapter; listing and testing
	// go through the text module's functions, which construct nothing here.
	"lib/server/connections/modelSync.ts",
	// `leasedNerAdapter` constructs the NER adapter `getNerAdapter` returns, for
	// the annotation lane's `extractEntities`. An entity call has no prompt.
	"lib/server/ner/broker.ts"
])

interface Site {
	file: string
	line: number
	wired: boolean
}

const CONSTRUCTS = /new\s+(?:\w+\.)?Adapter\s*\(/
const HANDS_OVER = /\.withStops\s*\(|composeStopsFor\s*\(/

const SITES: Site[] = []
for (const full of walk(SERVER)) {
	const file = relative(ROOT, full).replace(/\\/g, "/").replace(/^/, "")
	const rel = "lib/server/" + relative(SERVER, full).replace(/\\/g, "/")
	if (NO_PROMPT.has(rel)) continue
	const src = readFileSync(full, "utf8")
	const lines = src.split("\n")
	lines.forEach((line, i) => {
		if (!CONSTRUCTS.test(line)) return
		SITES.push({
			file: rel,
			line: i + 1,
			// Anywhere in the file: the hand-over is routinely a few lines below
			// the construction (after `withCompiledPrompt`, after an
			// `await import`), and a file that constructs an adapter and never
			// mentions a stop list is the thing being caught.
			wired: HANDS_OVER.test(src)
		})
	})
	void file
}

describe("the scan is capable of the measurement it is used for", () => {
	it("found the construction sites it is judging", () => {
		// A renamed constructor, a moved directory, or a regex that stopped
		// matching would report zero unwired sites and go green on having asked
		// nothing.
		expect(
			SITES.length,
			"no text-adapter construction was found anywhere under $lib/server — " +
				"either the tree moved or the `new …Adapter(` pattern stopped matching"
		).toBeGreaterThanOrEqual(4)
		const files = new Set(SITES.map((s) => s.file))
		// The one nobody would forget — every reply is sent from here since
		// the one road (09-B B4) — named so the scan cannot be judged by the
		// three obscure ones alone.
		expect(files).toContain("lib/server/pipelines/runtime/dispatch.ts")
		// And the three that go through `runQueuedLLMCall` instead — the ones
		// this file exists for.
		expect(files).toContain("lib/server/utils/summarizer/index.ts")
		expect(files).toContain("lib/server/utils/graphBuilder.ts")
		expect(files).toContain("lib/server/pipelines/runtime/dispatchStep.ts")
	})

	it("the prompt-free sites it exempts are actually there", () => {
		// An exemption for a file that has moved is an exemption for nothing,
		// standing where a rule used to be.
		for (const rel of NO_PROMPT)
			expect(
				readFileSync(join(ROOT, rel), "utf8"),
				`${rel} is exempted as a prompt-free site and no longer constructs an adapter`
			).toMatch(CONSTRUCTS)
	})
})

describe("every text adapter is handed a composed stop list", () => {
	it("no construction site sends a request with no stops", () => {
		const open = SITES.filter((s) => !s.wired).map(
			(s) =>
				`${s.file}:${s.line} constructs a text adapter and never calls withStops(). ` +
				`An adapter composes nothing of its own since the ruling of 2026-09-10, so this ` +
				`request goes out with NO stop sequences — on a completion wire the model runs ` +
				`on past its answer and it reads as a bad model. Hand it ` +
				`composeStopsFor(connection, session, { currentCharacterId, explicit }).`
		)
		expect(open.sort()).toEqual([])
	})
})
