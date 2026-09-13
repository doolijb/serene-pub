/**
 * `connections.model` is a MIRROR after 0114, and this is what keeps that true.
 *
 * The endpoint/model split left the column in place — a downgrade, a backup
 * restored into an older build, and the two managed flows that genuinely mean
 * "one connection, one model" all still expect to find the string there. A
 * column that survives for compatibility and is also read at run time is not a
 * mirror; it is a second source of truth, and this table has already paid for
 * one of those once (`system_settings.default_connection_id`, 0181: two writers,
 * readers that checked one and fell back to the other, a star press lost, and
 * every pipeline running on yesterday's connection while every screen showed
 * today's).
 *
 * So the rule is mechanical and so is the check: nothing under `$lib/server`
 * reads a connection row's `model` unless it is on the list below, and every
 * entry on the list says why.
 *
 * ## What counts as a read
 *
 * Both spellings that can decide what goes on the wire: a field access on a row
 * (`connection.model`, `c.model`) and a column reference in a query
 * (`schema.connections.model`). The second is the one that looks innocent —
 * `WHERE model = $1` is how "find the connection for this gguf" was written
 * three times, and after the split that question belongs to `connection_models`,
 * because an endpoint can now serve several.
 *
 * ## Why a grep and not a type
 *
 * A branded type on the column would be the sound answer and it cannot be had:
 * `SelectConnection` is `$inferSelect`, the merged pair is deliberately the SAME
 * shape as the row so that seven adapters did not have to move, and that
 * sameness is the whole design. The thing being enforced is therefore about
 * provenance, not shape, and provenance is exactly what a type cannot see here.
 */

import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"

const ROOT = resolve(process.cwd(), "src/lib/server")

/**
 * Who may read the column, and why. A path prefix, relative to `$lib/server`.
 *
 * ⚠ Adding an entry here is a design decision, not a build fix. The question to
 * answer first is "is this reading a row it was HANDED by the resolver, or a row
 * it loaded itself?" — the first is reading the pair and is fine, the second is
 * reading the mirror and is the bug.
 */
const ALLOWED: Record<string, string> = {
	// THE mirror writer. `mirrorDefaultModel` is the only thing outside 0114
	// that writes the column, and it reads the default model row to do it.
	"connections/models.ts":
		"the mirror writer itself — it reads connection_models and writes the column",

	// The seven text adapters and the two image adapters. Every one of them is
	// handed `AdapterConnection`, which `mergeEndpointModel` has already
	// substituted the model into, so `this.connection.model` is the pair's
	// identifier and not the endpoint's mirror. This is the reason the adapters
	// did not move a line for the split.
	connectionAdapters: "adapters read the MERGED pair off AdapterConnection",
	imageAdapters: "image adapters read the MERGED pair, same as the text ones",
	// The third family, for the same reason. An embedding adapter is
	// constructed from `EmbeddingTarget.connection`, which `resolveEmbeddingTarget`
	// builds with `mergeEndpointModel`, so `this.connection.model` is the
	// starred pair's identifier and not the endpoint's mirror.
	embeddingAdapters:
		"embedding adapters read the MERGED pair, same as the other two families",
	// The fourth family, same argument again. A NER adapter is constructed from
	// `NerTarget.connection`, which `resolveNerTarget` builds with
	// `mergeEndpointModel`, so `this.connection.model` is the starred pair's
	// identifier and not the endpoint's mirror.
	nerAdapters:
		"NER adapters read the MERGED pair, same as the other three families",

	// The request builder the image adapters share. Same argument: its
	// `connection` argument is whatever the dispatch resolved.
	"imageGen/buildRequest.ts":
		"payload builder — its connection argument is the resolved pair",

	// The identity projection. It reports whatever row it is handed, and every
	// run path hands it the pair (see `connectionIdentity(pair)` in
	// capabilityTarget.ts) so an administrator's receipt names the model that
	// was actually sent.
	"connections/visibility.ts":
		"connectionIdentity projects the row it is handed — the run paths hand it the pair",

	// Both managed-image preflights. Each takes its connection from a resolver
	// (`resolveCapabilityTarget` in the pipeline, `mergeEndpointModel` in the
	// socket) so the gguf they load is the pair's, not the endpoint's mirror.
	"pipelines/runtime/dispatchImage.ts":
		"managed preflight — its connection comes from resolveCapabilityTarget",
	"sockets/images.ts":
		"managed preflight — imagesGenerate merges the pair before calling it",

	// The connection editor's defaults backfill, which round-trips the form's
	// own model field. It is a WRITE path that happens to name the column, and
	// `connections:update` calls `ensureDefaultModel` beside it so the pair and
	// the mirror move together.
	"sockets/connections.ts":
		"form-defaults backfill — a write path, paired with ensureDefaultModel",

	// The embedding resolver, and the loader behind it. `resolveEmbeddingTarget`
	// reads `connection.model` off the row `mergeEndpointModel` just produced —
	// it is the one place that performs the merge for embeddings, so it is
	// reading the pair it built, in the same position `capabilityTarget.ts`
	// occupies for every other capability.
	"embedding/target.ts":
		"the embedding resolver — reads the pair it just merged",
	"embedding/index.ts":
		"builds the model identity from the merged pair the resolver handed it",

	// The entity resolver, in the same position `embedding/target.ts` occupies:
	// it reads `connection.model` off the row `mergeEndpointModel` just
	// produced, which is the pair it built rather than the endpoint's mirror.
	"ner/target.ts": "the entity resolver — reads the pair it just merged"
}

/** Every `.ts` under `$lib/server` that is not a test or an ambient declaration. */
function sources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			sources(full, out)
			continue
		}
		if (!entry.endsWith(".ts")) continue
		if (entry.endsWith(".d.ts")) continue
		if (/\.(test|int\.test|spec)\.ts$/.test(entry)) continue
		out.push(full)
	}
	return out
}

/**
 * Strip comments before matching.
 *
 * Half of this codebase by volume is docblocks, and several of them quote the
 * column by name while explaining why nothing may read it — a check that counted
 * its own documentation would be unfixable except by deleting the explanation.
 */
function code(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, (m) =>
			"\n".repeat(m.split("\n").length - 1)
		)
		.split("\n")
		.map((l) => l.split("//")[0])
		.join("\n")
}

const READS = [
	// A column reference in a query — `eq(schema.connections.model, …)`.
	/schema\.connections\.model\b/,
	/(?<!schema\.)\bconnections\.model\b/,
	// A field access on a row. `c` is what every drizzle relational callback in
	// this codebase names the connections table.
	/\bconnection\??\.model\b/,
	/\bc\.model\b/,
	/\bendpoint\??\.model\b/
]

function offenders(): { file: string; line: number; text: string }[] {
	const found: { file: string; line: number; text: string }[] = []
	for (const file of sources(ROOT)) {
		const rel = relative(ROOT, file).split(sep).join("/")
		if (
			Object.keys(ALLOWED).some(
				(p) => rel === p || rel.startsWith(p + "/")
			)
		)
			continue
		const lines = code(readFileSync(file, "utf8")).split("\n")
		lines.forEach((line, i) => {
			if (READS.some((re) => re.test(line)))
				found.push({ file: rel, line: i + 1, text: line.trim() })
		})
	}
	return found
}

describe("connections.model is a mirror, not a source", () => {
	it("is read by nothing under $lib/server outside the allowlist", () => {
		const found = offenders()
		expect(
			found.map((f) => `${f.file}:${f.line}  ${f.text}`),
			"Each of these reads the LEGACY MIRROR column. After 0114 the model an " +
				"endpoint sends is `connection_models.model`, reached through " +
				"`mergeEndpointModel` (a run) or `defaultConnectionModel` (a list). " +
				"If the row really is the resolved pair, add the file to ALLOWED " +
				"with the reason — but read that list's warning first."
		).toEqual([])
	})

	it("has an allowlist whose every entry still exists", () => {
		// A stale allowlist is how an exemption outlives the file it was written
		// for and silently covers whatever moves in next.
		const all = sources(ROOT).map((f) =>
			relative(ROOT, f).split(sep).join("/")
		)
		const dead = Object.keys(ALLOWED).filter(
			(p) => !all.some((f) => f === p || f.startsWith(p + "/"))
		)
		expect(dead).toEqual([])
	})
})
