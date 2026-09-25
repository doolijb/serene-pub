/**
 * Pipeline documents ↔ rows.
 *
 * **Rows are the system of record; the document is a deterministic projection of
 * them (F3).** That direction matters more than it looks. It is what lets the
 * in-app editor and an imported plugin pipeline be the same thing — both write
 * rows, and export reads rows — rather than the editor being a second
 * implementation that has to be kept in step with a file format.
 *
 * The acceptance criterion is one line: **`import(export(rows))` is the
 * identity, and the canonical hash is stable across the trip.** It is
 * conformance requirement C1, and it is checked here against real rows rather
 * than fixtures, because the interesting failures are all in the column mapping
 * — a dropped `clauseChain`, a preset value that round-trips as a string instead
 * of a number — and no fixture catches those.
 *
 * Nothing in the running app reads these tables yet. The pipeline path is built
 * beside the existing prompt/context config path and only replaces it once the
 * parity corpus is byte-identical (08 §5b, docs-dev/INTEGRATING.md).
 */

import { pluginRuleRef } from "@serene-pub/sdk"
import { and, asc, eq, inArray, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	actionDocumentFindings,
	actionsOf,
	canonicalHash,
	ENVOY_CONFIG_PREFIX,
	envoyConfigKeysOf,
	envoyFindings,
	envoysFindings,
	i18nText,
	importDocument,
	sessionEvents,
	slashCollisions,
	subjectsOf,
	validate,
	type EnvoyDecl,
	type SpecDocument
} from "@serene-pub/sdk"
import { mayRecord } from "$lib/server/plugins/pluginEvents"
import { invalidateDeclaredEnvoys } from "$lib/server/pipelines/entities/envoys"
import { getSessionGenre } from "$lib/server/pipelines/entities/sessionGenres"

/** What `saveDocument` reports back — the ids core needs to reference the version. */
export interface SavedSpec {
	specId: number
	specVersionId: number
	canonicalHash: string
	/** False when the document was already stored under this hash. */
	written: boolean
}

/**
 * Write a document as rows.
 *
 * A version is written whole or not at all. The transaction is not decoration:
 * a half-written spec version is a pipeline that validates (its nodes exist)
 * and then fails mid-run on a missing edge, which is the least debuggable
 * outcome available.
 *
 * ## A version is `(spec, semver, hash)` (ruling 2026-09-10)
 *
 * The hash is part of the key, so an edited document is a **new row**: the row
 * it supersedes stays for the run in flight, the receipt and the config notice
 * that name it, the new one becomes active, and the row the pointer moves off is
 * retired so `status = 'published'` still means "the one this slug resolves to".
 * Re-saving an identical document writes nothing.
 *
 * Without the hash in the key an edited document has nowhere to land but on top
 * of the row those three are naming — which leaves only two answers, destroying
 * it or skipping the edit, and skipping means the edit reaches no install that
 * has already booted. See `docs/pipelines.md`, *Specs and node definitions
 * are content-addressed*.
 */
export async function saveDocument(
	db: Db,
	doc: SpecDocument,
	opts: {
		name?: string
		sourcePluginId?: number
		publish?: boolean
		/**
		 * The slugs a batch is republishing together (U5c review, S2). Their
		 * *current* active versions are excluded from the install-wide slash
		 * check this publish runs — a release that swaps two names between
		 * two specs is refused one spec at a time otherwise, because the
		 * first to land meets the second's old claim. The caller then runs
		 * `assertInstallSlashNamesFree` once the whole batch has landed.
		 */
		batch?: ReadonlySet<string>
	} = {}
): Promise<SavedSpec> {
	const hash = canonicalHash(doc)
	assertValidates(doc)
	assertRecordingsInScope(doc)

	const saved = await db.transaction(async (tx: Db) => {
		await assertEnvoysSound(tx, doc, opts.batch)
		const existing = await tx
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, doc.id))
			.limit(1)
		// A plugin's private node belongs in its own pipelines only (R62).
		// The stored owner first: a caller cannot borrow a spec row's
		// ownership by naming itself.
		await assertPrivateNodesOwned(
			tx,
			doc,
			existing[0]?.sourcePluginId ?? opts.sourcePluginId ?? null
		)

		const spec =
			existing[0] ??
			(
				await tx
					.insert(schema.pipelineSpecs)
					.values({
						slug: doc.id,
						name: opts.name ?? doc.id,
						sourcePluginId: opts.sourcePluginId ?? null
					})
					.returning()
			)[0]

		// This exact document, if this instance already holds it. Matched on the
		// hash, so re-saving what is already stored is a no-op and an *edit*
		// under the same semver falls through to a new row.
		const [stored] = await tx
			.select()
			.from(schema.pipelineSpecVersions)
			.where(
				and(
					eq(schema.pipelineSpecVersions.specId, spec.id),
					eq(schema.pipelineSpecVersions.semver, doc.version),
					eq(schema.pipelineSpecVersions.canonicalHash, hash)
				)
			)
			.limit(1)
		if (stored) {
			// Publishing an already-stored document is a pointer move and
			// nothing else — the rows below it are the same rows.
			if (opts.publish && spec.activeVersionId !== stored.id)
				await publishVersion(tx, spec.id, stored.id, opts.batch)
			return {
				specId: spec.id,
				specVersionId: stored.id,
				canonicalHash: hash,
				written: false
			}
		}

		const version = (
			await tx
				.insert(schema.pipelineSpecVersions)
				.values({
					specId: spec.id,
					semver: doc.version,
					schemaVersion: doc.schemaVersion,
					canonicalHash: hash,
					status: opts.publish ? "published" : "draft",
					publishedAt: opts.publish ? new Date() : null,
					genre:
						(doc.genre as Record<string, any>) ??
						// Pre-rename documents spelled it `mode` (24 §2).
						((doc as any).mode as Record<string, any>) ??
						null,
					inputGenre: doc.input?.genre ?? null,
					inputEvent: doc.input?.event ?? null,
					// The multi-event lock (PLAN-turn-order §4.1): null for
					// the ordinary one-event form, so nothing existing moves.
					inputEvents:
						(doc.input as { events?: string[] } | undefined)?.events ??
						null,
					contributes:
						(doc.contributes as Record<string, any>) ?? null,
					taxonomy:
						(doc.taxonomy as Record<string, any>) ?? null
				})
				.returning()
		)[0]

		if (doc.clauses.length)
			await tx.insert(schema.pipelineClauses).values(
				doc.clauses.map((b) => ({
					specVersionId: version.id,
					clauseId: b.id,
					kind: b.kind,
					parentClauseId: b.clauseId ?? null,
					mode: b.mode ?? null,
					max: b.max ?? null,
					overRef: (b.over as Record<string, any>) ?? null,
					repeatWhile: (b.repeatWhile as Record<string, any>) ?? null,
					onRef: (b.on as Record<string, any>) ?? null,
					branches: (b.branches as Record<string, any>) ?? null,
					position: b.position
				}))
			)

		const nodeRows = await tx
			.insert(schema.pipelineNodes)
			.values(
				doc.nodes.map((n) => ({
					specVersionId: version.id,
					nodeKey: n.key,
					kind: n.kind,
					definitionId: n.definitionId,
					definitionVersion: n.definitionVersion,
					config: n.config,
					resolvedRefs: n.resolvedRefs ?? null,
					clauseId: n.clauseId ?? null,
					clauseKind: n.clauseKind ?? null,
					clauseChain: n.clauseChain ?? null,
					position: n.position,
					// The session-settings mark (R28): stored so every reader
					// reads it off the published spec, a plugin's as well as core's.
					expose: n.expose ?? null
				}))
			)
			.returning()

		// Edges FK to node rows, so the id lookup happens here rather than being
		// deferred to a validator that runs later and finds a dangling reference.
		const idOf = new Map<string, number>(
			nodeRows.map((r: { nodeKey: string; id: number }) => [
				r.nodeKey,
				r.id
			])
		)
		// A clause's aggregate output is a legal edge source: `each` and `gather`
		// publish `branch-results@1`, and a spec consuming it names the clause.
		// Resolved here so the error below still fires for a genuine typo.
		const clauseIds = new Set((doc.clauses ?? []).map((b: any) => b.id))

		// So is an each or loop iteration's item — `clause.$item`, the
		// per-iteration value the executor scopes in. Clause-shaped rather than
		// node-shaped: it has no node row to FK, and the load side hands the key
		// back verbatim.
		const itemSourceOf = (from: string): string | null => {
			const m = /^(.+)\.\$item$/.exec(from)
			return m && clauseIds.has(m[1]!) ? from : null
		}

		if (doc.edges.length)
			await tx.insert(schema.pipelineEdges).values(
				doc.edges.map((e) => {
					const from = idOf.get(e.from)
					const fromClause = clauseIds.has(e.from)
						? e.from
						: itemSourceOf(e.from)
					const to = idOf.get(e.to)
					if ((from === undefined && !fromClause) || to === undefined)
						throw new Error(
							`edge ${e.from}.${e.fromPort} → ${e.to}.${e.toPort} references a node this version does not contain`
						)
					return {
						specVersionId: version.id,
						fromNodeId: fromClause ? null : from,
						fromClauseId: fromClause,
						fromPort: e.fromPort,
						toNodeId: to,
						toPort: e.toPort,
						edgeShape: e.shape ?? null,
						streaming: e.streaming ?? null,
						implicit: e.implicit ?? null
					}
				})
			)

		if (doc.includes.length)
			await tx.insert(schema.pipelineIncludes).values(
				doc.includes.map((i) => ({
					specVersionId: version.id,
					key: i.key,
					fragmentId: i.fragmentId
				}))
			)

		for (const p of doc.presets ?? []) {
			const preset = (
				await tx
					.insert(schema.pipelinePresets)
					.values({
						specVersionId: version.id,
						slug: p.slug,
						// Text columns: the document's display text resolved to
						// `en` (R-20) — a bare string is itself; the label is
						// required by `validate()`, so the slug is unreachable.
						label: i18nText(p.label) ?? p.slug,
						description: i18nText(p.description) ?? null,
						ownerSlug: p.owner ?? null,
						isDefault: p.default ?? false
					})
					.returning()
			)[0]
			if (p.values.length)
				await tx.insert(schema.pipelinePresetValues).values(
					p.values.map((v) => ({
						presetId: preset.id,
						nodeKey: v.nodeKey,
						slot: v.slot,
						value: v.value as any
					}))
				)
		}

		if (opts.publish)
			await publishVersion(tx, spec.id, version.id, opts.batch)

		return {
			specId: spec.id,
			specVersionId: version.id,
			canonicalHash: hash,
			written: true
		}
	})
	// Once more after the commit: `publishVersion` cleared the cache inside
	// the transaction, and a read between that and the commit would have
	// cached the rows as they stood before it.
	if (opts.publish) invalidateDeclaredEnvoys()
	return saved
}

/**
 * **Who owns a spec** — the installed plugin's slug, or `undefined` for core's
 * (D-6). The other half of the `source_plugin_id` column `saveDocument` writes.
 *
 * A join rather than a prefix test on the slug, and that is the whole point of
 * the column: a namespace is a claim the document makes about itself, and
 * ownership is what this instance recorded when it installed the package. The
 * two cannot be swapped — a document naming itself `core:…` out of a plugin's
 * folder reads as core's from its id and as the plugin's from this.
 *
 * Returns the **manifest slug** (`showcase.battleship`) rather than the row id,
 * because that is the name everything downstream of a run speaks: the grant
 * keys, the frame URLs, the plugin list. The row id is an install-local number
 * and belongs only to the columns that store it.
 */
export async function specOwnerPluginId(
	db: Db,
	specSlug: string
): Promise<string | undefined> {
	const [row] = await db
		.select({ pluginId: schema.plugins.pluginId })
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.plugins,
			eq(schema.plugins.id, schema.pipelineSpecs.sourcePluginId)
		)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
		.limit(1)
	return row?.pluginId ?? undefined
}

/**
 * Move a slug's pointer to one of its versions.
 *
 * Publishing is a pointer move and has been since 02 §3 — what is new is the
 * second half. Every *other* version of the spec that still says `published` is
 * retired, because with the hash in the key a slug can hold several rows that
 * were each published in their turn, and a reader asking for `status =
 * 'published'` has to keep getting exactly one.
 *
 * ⚠ It also corrects a case that predates content addressing: publishing 1.20.0
 * over a published 1.19.0 left **both** rows saying `published`, and
 * `loadPublished` took the lowest id — so on an install that had upgraded, the
 * "published document" was the oldest one still on the books rather than the
 * active one. Two readers (`sessionGenres`, `entities/bindings`) select on
 * status alone and were seeing both.
 */
async function publishVersion(
	tx: Db,
	specId: number,
	versionId: number,
	batch?: ReadonlySet<string>
): Promise<void> {
	await assertSlashNamesFree(tx, specId, versionId, batch)
	await assertActionEnvoyKeysFree(tx, specId, versionId, batch)
	// The one writer of the rows `declaredEnvoys` caches (U5g review, S4).
	invalidateDeclaredEnvoys()
	await tx
		.update(schema.pipelineSpecVersions)
		.set({ status: "retired" })
		.where(
			and(
				eq(schema.pipelineSpecVersions.specId, specId),
				eq(schema.pipelineSpecVersions.status, "published"),
				ne(schema.pipelineSpecVersions.id, versionId)
			)
		)
	await tx
		.update(schema.pipelineSpecVersions)
		.set({ status: "published", publishedAt: new Date() })
		.where(eq(schema.pipelineSpecVersions.id, versionId))
	await tx
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: versionId })
		.where(eq(schema.pipelineSpecs.id, specId))
}

/**
 * One slash name means one function across the install (R-15, U5c).
 *
 * The SDK makes a collision across owners impossible by grammar — core's
 * names are bare, a plugin's are `<plugin>.<action>` — and refuses one
 * inside a document or a package at authoring. What neither can see is two
 * specs of one namespace, published separately, claiming one name for two
 * different functions on the same genre: that is only visible where every
 * published spec is, which is here, at the pointer move. Refused with the
 * sentence the SDK's `slashCollisions` writes, so boot and a plugin install
 * fail loudly rather than seeding a palette where `/roll` means two things.
 *
 * Two specs offering the **same** function under one name are alternatives
 * the binding selects among (19 §3), not a collision — the rule is the
 * SDK's, applied to the install's rows.
 *
 * `batch` (U5c review, S2): the slugs being republished together. Their
 * current versions are left out of "the install as it stands", because they
 * are about to be replaced — a release swapping `/cast` and `/zap` between
 * two specs would otherwise be refused on whichever landed first. The
 * batch's caller owes one `assertInstallSlashNamesFree` afterwards.
 */
async function assertSlashNamesFree(
	tx: Db,
	specId: number,
	versionId: number,
	batch?: ReadonlySet<string>
): Promise<void> {
	const [incoming] = await tx
		.select({ contributes: schema.pipelineSpecVersions.contributes })
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, versionId))
		.limit(1)
	if (!incoming?.contributes) return
	const [spec] = await tx
		.select({ slug: schema.pipelineSpecs.slug })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, specId))
		.limit(1)
	const mine = actionsOf({ id: spec!.slug, contributes: incoming.contributes })
	if (!mine.length) return
	// Every OTHER spec's active version — the install as it stands, less the
	// batch-mates whose versions are on their way out.
	const others = await installedActions(tx, (o) => o.id !== specId)
	const installed = others.filter((a) => !batch?.has(a.specId))
	const collisions = slashCollisions([...installed, ...mine])
	if (collisions.length)
		throw new Error(
			`'${spec!.slug}' cannot be published: ` + collisions.join("; ")
		)
}

/**
 * The whole install's rule, run once: every active version's actions
 * together (U5c review, S2). What a batch publish owes after its last
 * pointer move — the per-publish check let each batch-mate through against
 * the others' *old* claims, and this is where the *new* ones meet.
 */
export async function assertInstallSlashNamesFree(db: Db): Promise<void> {
	const collisions = slashCollisions(await installedActions(db, () => true))
	if (collisions.length)
		throw new Error(
			"the install's published specs collide on a slash name: " +
				collisions.join("; ")
		)
	const envoys = actionEnvoyCollisions(await installedActions(db, () => true))
	if (envoys.length)
		throw new Error(
			"the install's published specs collide on an action envoy: " +
				envoys.join("; ")
		)
}

/**
 * The Fixed Ledger's static laws, at the publish (U5d review, W9): the
 * SDK's `validate()` — one inlet first, one primary row, no branching, port
 * shapes assignable, a built-in outlet only in its own spec, `answer-form`
 * only under `form-addressed`, the action model's rules — with an `error`
 * refusing the save and a `warning` let through. The builder and the
 * conformance suite ran these for an author; nothing ran them for the
 * document an instance actually stores until now, which is how thirteen
 * shipped specs carried a shape finding for a release (the declarations
 * were wrong — `session-history@1` said candidates and published rows — and
 * no door said so). A document that reached here another way — an import,
 * a hand-built JSON — gets the same answer as the builder's.
 *
 * ⚠ **A shipped spec that stops validating is a boot failure, by design.**
 * The seed publishes the catalog through this door with no exemption: one
 * core document carrying an error-severity finding refuses to save, and
 * the instance does not come up with a hole where that pipeline was. That
 * is the point — a validator with a back door for the catalog would have
 * let W9's thirteen findings ship again. The guard that keeps it from ever
 * being a surprise is the zero-error test over every shipped spec
 * (`store.int.test.ts`, and the SDK's `formsReview.test.ts`): a change to a
 * contract or to `validate()` fails there first, never at a user's boot.
 */
function assertValidates(doc: SpecDocument): void {
	const errors = validate(doc).filter((f) => f.severity === "error")
	if (!errors.length) return
	throw new Error(
		`'${doc.id}' cannot be saved: it does not validate — ` +
			errors
				.map(
					(e) =>
						`[${e.law}] ${e.nodeKey ? `${e.nodeKey}: ` : ""}${e.message} (${e.fix})`
				)
				.join("; ")
	)
}

/**
 * Every event this document records literally is one its subjects may record
 * (R52, E1b) — judged in the genre its lock names, or in any genre when it
 * names none. The host judges again at the write, in the session's genre;
 * this is the same answer, earlier, so an out-of-scope recording is a
 * publish refusal rather than a failed turn. A wired event id is known only
 * at the write and is judged there alone. Core events are the validator's.
 */
function assertRecordingsInScope(doc: SpecDocument): void {
	const refused: string[] = []
	for (const node of doc.nodes) {
		if (node.definitionId !== "core:outlet/record-event") continue
		const event = (node.config as Record<string, unknown> | undefined)?.event
		if (typeof event !== "string" || event.startsWith("core:")) continue
		const verdict = mayRecord(event, doc.input?.genre, subjectsOf(doc as never))
		if (!verdict.ok) refused.push(`${node.key}: ${verdict.reason}`)
	}
	if (refused.length)
		throw new Error(
			`'${doc.id}' cannot be saved: it records outside its scope — ${refused.join("; ")}` +
				pluginRuleRef("events")
		)
}

/**
 * Every node a document pins that a plugin made private belongs to the
 * document's own plugin (R62): a node is as public as its handler, and a
 * private one may change without warning, so another package's pipeline —
 * or a person's — may not build on it. Refused at the publish door with the
 * owner named; the run refuses it again (`pluginNodeBindings`) for a document
 * that reached a run another way. Core's nodes are public to all.
 */
async function assertPrivateNodesOwned(
	tx: Db,
	doc: SpecDocument,
	ownerPluginId: number | null
): Promise<void> {
	// What the document pins, and what its nodes offer as swaps (`expose.swaps`,
	// `id@N`): a private node is refused in either place.
	const offered = doc.nodes.flatMap((n) =>
		((n as { expose?: { swaps?: string[] } }).expose?.swaps ?? []).map((id) => {
			const [definitionId, version] = id.split("@")
			return { key: `${n.key} (swap)`, definitionId: definitionId!, definitionVersion: Number(version) }
		})
	)
	const uses = [...doc.nodes, ...offered]
	const ids = [...new Set(uses.map((n) => n.definitionId))]
	if (!ids.length) return
	const rows = await tx
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			ownerPluginId: schema.pipelineDefinitionRegistry.ownerPluginId,
			isPublic: schema.pipelineDefinitionRegistry.isPublic,
			owner: schema.plugins.pluginId
		})
		.from(schema.pipelineDefinitionRegistry)
		.innerJoin(
			schema.plugins,
			eq(schema.plugins.id, schema.pipelineDefinitionRegistry.ownerPluginId)
		)
		.where(inArray(schema.pipelineDefinitionRegistry.definitionId, ids))
	const refused: string[] = []
	for (const n of uses) {
		const row = rows.find(
			(r) => r.definitionId === n.definitionId && r.version === n.definitionVersion
		)
		if (!row || row.isPublic || row.ownerPluginId === ownerPluginId) continue
		refused.push(
			`${n.key} uses ${n.definitionId}@${n.definitionVersion}, which is private to '${row.owner}'`
		)
	}
	if (refused.length)
		throw new Error(
			`'${doc.id}' cannot be saved: ${refused.join("; ")} — only its own pipelines may use a ` +
				`private node; its author makes it reusable with handler(…, { visibility: 'public' })` +
				pluginRuleRef("private-nodes")
		)
}

/**
 * The envoys a document declares, checked where it lands as rows (U5g
 * review, W4) — the host's half of the check the SDK's `genre()` and
 * `compile()` run at authoring. Needed because a plugin's genre is one the
 * SDK's registry never saw: `compile()` cannot check a reference to it, and
 * says so. Three things, each refused with the SDK's own sentences:
 *
 *  1. the genre's `envoys` (`envoysFindings`: shape, unique keys, at most
 *     one default, an `<img>`-only image);
 *  2. each contributed action's `envoy` (`envoyFindings`, `on-action` only);
 *  3. every `envoy:<key>` a node reads config through must be a key the
 *     genre the spec serves declares — this document's own declaration when
 *     it is the create spec, else the *published* one. A genre nothing has
 *     published yet (the create spec later in the same batch) cannot be
 *     judged here and is not, and neither is one whose create spec is a
 *     batch-mate: its published declaration is the OLD one, and a release
 *     that adds an envoy and the first reference to it together would be
 *     refused on whichever landed first. The same "checked when known" rule
 *     the SDK applies, for the same reason.
 *
 * ⏳ Only the core catalog reaches this today (`seed.ts` is the one caller);
 * a plugin publish path lands here by construction when it is built.
 */
async function assertEnvoysSound(
	tx: Db,
	doc: SpecDocument,
	batch?: ReadonlySet<string>
): Promise<void> {
	const findings: string[] = []
	const genre = ((doc.genre as Record<string, unknown> | undefined) ??
		((doc as any).mode as Record<string, unknown> | undefined)) as
		| { envoys?: unknown }
		| undefined
	if (genre?.envoys !== undefined)
		findings.push(...envoysFindings(genre.envoys, `${doc.id}.genre.envoys`))
	// The builder refuses a colon in a node key at `.add()` (S2) — but a raw
	// document (a plugin's, or hand-built as in tests) never went through the
	// builder, so the same check is re-run here with the same sentence.
	if (doc.nodes.some((n) => n.key.includes(":")))
		for (const n of doc.nodes)
			if (n.key.includes(":"))
				findings.push(
					`node key '${n.key}' contains ':' — a colon marks a synthetic config address ` +
						"(`envoy:<key>`), which a node key must never be mistaken for"
				)
	// The RAW entries, not `actionsOf`'s: normalisation stamps `speaks:
	// 'on-action'` on every action envoy, so a declaration saying `in-turn`
	// would be judged on what it became rather than on what it said.
	const contributes = doc.contributes as
		| { actions?: unknown[]; triggers?: unknown[] }
		| undefined
	for (const raw of [...(contributes?.actions ?? []), ...(contributes?.triggers ?? [])]) {
		const a = raw as { key?: unknown; envoy?: unknown } | null
		if (a?.envoy !== undefined)
			findings.push(
				...envoyFindings(
					a.envoy,
					`${doc.id}.contributes.actions[${typeof a.key === "string" ? a.key : "?"}].envoy`,
					"action"
				)
			)
	}
	// The action model's own rules, at the publish (U5d): the venue set, the
	// slash grammar, the locale maps and — the effects line — a `world`
	// action in a venue or with an audience it may not have. The builder
	// refuses these at construction; a document that reached here another
	// way (an import, a hand-built JSON, a patched row) gets the same answer.
	findings.push(...actionDocumentFindings(doc))
	if (findings.length)
		throw new Error(`'${doc.id}' cannot be saved: ${findings.join("; ")}`)

	const referenced = envoyConfigKeysOf(doc).map((k) =>
		k.slice(ENVOY_CONFIG_PREFIX.length)
	)
	if (!referenced.length) return
	const genreId = doc.input?.genre
	if (!genreId) return // `compile()` already refused a genre-less reference
	let declared: readonly EnvoyDecl[] | null = null
	if (doc.input?.event === sessionEvents.sessionCreated)
		declared = (genre?.envoys as EnvoyDecl[] | undefined) ?? []
	else {
		const published = await getSessionGenre(tx, genreId)
		if (!published) return // not yet known here: nothing to judge against
		if (batch?.has(await genreCreateSpecSlug(tx, genreId))) return
		declared = published.envoys ?? []
	}
	const keys = new Set(declared.map((e) => e.key))
	const missing = referenced.filter((k) => !keys.has(k))
	if (missing.length)
		throw new Error(
			`'${doc.id}' cannot be saved: it reads the prompts of ${missing
				.map((k) => `envoy '${k}'`)
				.join(", ")}, which '${genreId}' does not declare` +
				(keys.size
					? ` — it declares ${[...keys].map((k) => `'${k}'`).join(", ")}`
					: " — it declares no envoys")
		)
}

/** The slug of the published create spec declaring a genre — its row is the declaration. */
async function genreCreateSpecSlug(tx: Db, genreId: string): Promise<string> {
	const [row] = await tx
		.select({ slug: schema.pipelineSpecs.slug })
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)
		.where(
			and(
				eq(schema.pipelineSpecVersions.inputGenre, genreId),
				eq(
					schema.pipelineSpecVersions.inputEvent,
					sessionEvents.sessionCreated
				)
			)
		)
		.limit(1)
	return row?.slug ?? ""
}

/**
 * One action-envoy key means one envoy across a namespace (U5g review, S5).
 *
 * An action's envoy is addressed as `<plugin>.<key>` — the spec's namespace,
 * not the spec — so two specs of one namespace each declaring an envoy under
 * the same key would seat one slug for two declarations, and a cast row
 * could not say which. The SDK cannot see across specs; this is where every
 * published spec is, so it is refused here, at the pointer move, on the
 * `assertSlashNamesFree` pattern: the incoming version against every other
 * spec's active one, less the batch-mates on their way out, and the whole
 * install once after a batch.
 */
async function assertActionEnvoyKeysFree(
	tx: Db,
	specId: number,
	versionId: number,
	batch?: ReadonlySet<string>
): Promise<void> {
	const [incoming] = await tx
		.select({ contributes: schema.pipelineSpecVersions.contributes })
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, versionId))
		.limit(1)
	if (!incoming?.contributes) return
	const [spec] = await tx
		.select({ slug: schema.pipelineSpecs.slug })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, specId))
		.limit(1)
	const mine = actionsOf({ id: spec!.slug, contributes: incoming.contributes })
	if (!mine.some((a) => a.envoy)) return
	const others = await installedActions(tx, (o) => o.id !== specId)
	const installed = others.filter((a) => !batch?.has(a.specId))
	const collisions = actionEnvoyCollisions([...installed, ...mine])
	if (collisions.length)
		throw new Error(
			`'${spec!.slug}' cannot be published: ` + collisions.join("; ")
		)
}

/** The namespace of a spec id — `acme:spec/dice` → `acme`; empty when it has none. */
const namespaceOf = (specId: string): string => {
	const i = specId.indexOf(":")
	return i === -1 ? "" : specId.slice(0, i)
}

/**
 * Two specs of one namespace declaring an action envoy under one key. One
 * spec declaring the same key on two of its actions is not a collision: the
 * envoy is the same one, posting through either.
 */
function actionEnvoyCollisions(
	actions: ReadonlyArray<ReturnType<typeof actionsOf>[number]>
): string[] {
	const claims = new Map<string, string>()
	const out: string[] = []
	for (const a of actions) {
		if (!a.envoy) continue
		const slug = `${namespaceOf(a.specId)}.${a.envoy.key}`
		const prior = claims.get(slug)
		if (prior === undefined) {
			claims.set(slug, a.specId)
			continue
		}
		if (prior === a.specId) continue
		out.push(
			`the action envoy '${slug}' is declared by both '${prior}' and '${a.specId}' — ` +
				`one key means one envoy across a namespace; rename one of them`
		)
	}
	return out
}

/** Every active version's contributed actions, tagged with its spec's slug. */
async function installedActions(
	db: Db,
	keep: (spec: { id: number; slug: string }) => boolean
): Promise<ReturnType<typeof actionsOf>> {
	const rows = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			contributes: schema.pipelineSpecVersions.contributes
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)
	return rows
		.filter((r) => keep(r))
		.flatMap((o) =>
			o.contributes
				? actionsOf({ id: o.slug, contributes: o.contributes })
				: []
		)
}

/**
 * Read a version back as a document.
 *
 * Ordering is explicit everywhere it matters. `position` is what makes the
 * projection deterministic — without it the hash would depend on whatever order
 * Postgres felt like returning rows in, and C1 would fail intermittently, which
 * is worse than failing.
 */
export async function loadDocument(
	db: Db,
	specVersionId: number
): Promise<SpecDocument> {
	const [version] = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, specVersionId))
		.limit(1)
	if (!version) throw new Error(`no pipeline spec version ${specVersionId}`)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, version.specId))
		.limit(1)

	const nodeRows = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
		.orderBy(
			asc(schema.pipelineNodes.position),
			asc(schema.pipelineNodes.id)
		)

	const keyOf = new Map<number, string>(
		nodeRows.map((r: { id: number; nodeKey: string }) => [r.id, r.nodeKey])
	)

	const edgeRows = await db
		.select()
		.from(schema.pipelineEdges)
		.where(eq(schema.pipelineEdges.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineEdges.id))

	const clauseRows = await db
		.select()
		.from(schema.pipelineClauses)
		.where(eq(schema.pipelineClauses.specVersionId, specVersionId))
		.orderBy(
			asc(schema.pipelineClauses.position),
			asc(schema.pipelineClauses.id)
		)

	const includeRows = await db
		.select()
		.from(schema.pipelineIncludes)
		.where(eq(schema.pipelineIncludes.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineIncludes.id))

	const presetRows = await db
		.select()
		.from(schema.pipelinePresets)
		.where(eq(schema.pipelinePresets.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelinePresets.id))

	const presets = []
	for (const p of presetRows) {
		const values = await db
			.select()
			.from(schema.pipelinePresetValues)
			.where(eq(schema.pipelinePresetValues.presetId, p.id))
			.orderBy(asc(schema.pipelinePresetValues.id))
		presets.push({
			slug: p.slug,
			label: p.label,
			...(p.description ? { description: p.description } : {}),
			...(p.isDefault ? { default: true } : {}),
			...(p.ownerSlug ? { owner: p.ownerSlug } : {}),
			values: values.map((v: any) => ({
				nodeKey: v.nodeKey,
				slot: v.slot,
				value: v.value
			}))
		})
	}

	const doc: SpecDocument = {
		schemaVersion: version.schemaVersion as 1,
		id: spec.slug,
		version: version.semver,
		...(version.genre ? { genre: version.genre } : {}),
		...(version.inputGenre || version.inputEvent || version.inputEvents?.length
			? {
					input: {
						...(version.inputGenre ? { genre: version.inputGenre } : {}),
						...(version.inputEvent ? { event: version.inputEvent } : {}),
						// The lock over several events (§4.1): written since A6
						// (0154) but not read back until M2, so a published
						// turn-order spec reloaded without its events.
						...(version.inputEvents?.length ? { events: [...version.inputEvents] } : {})
					}
				}
			: {}),
		...(version.contributes ? { contributes: version.contributes } : {}),
		...(version.taxonomy ? { taxonomy: version.taxonomy } : {}),
		includes: includeRows.map((i: any) => ({
			key: i.key,
			fragmentId: i.fragmentId
		})),
		presets: presets as SpecDocument["presets"],
		nodes: nodeRows.map((n: any) => ({
			key: n.nodeKey,
			kind: n.kind,
			definitionId: n.definitionId,
			definitionVersion: n.definitionVersion,
			config: n.config,
			...(n.resolvedRefs ? { resolvedRefs: n.resolvedRefs } : {}),
			...(n.clauseId ? { clauseId: n.clauseId } : {}),
			...(n.clauseKind ? { clauseKind: n.clauseKind } : {}),
			...(n.clauseChain ? { clauseChain: n.clauseChain } : {}),
			position: n.position,
			// Only when stored, so a document read back hashes as it was written.
			...(n.expose ? { expose: n.expose } : {})
		})),
		edges: edgeRows.map((e: any) => ({
			from: e.fromClauseId ?? keyOf.get(e.fromNodeId)!,
			fromPort: e.fromPort,
			to: keyOf.get(e.toNodeId)!,
			toPort: e.toPort,
			...(e.edgeShape ? { shape: e.edgeShape } : {}),
			...(e.streaming === null ? {} : { streaming: e.streaming }),
			...(e.implicit === null ? {} : { implicit: e.implicit })
		})),
		clauses: clauseRows.map((b: any) => ({
			id: b.clauseId,
			kind: b.kind,
			mode: b.mode,
			...(b.overRef ? { over: b.overRef } : {}),
			...(b.max !== null ? { max: b.max } : {}),
			...(b.repeatWhile ? { repeatWhile: b.repeatWhile } : {}),
			...(b.onRef ? { on: b.onRef } : {}),
			...(b.branches ? { branches: b.branches } : {}),
			chains: chainsOf(nodeRows, b.clauseId),
			...(b.parentClauseId ? { clauseId: b.parentClauseId } : {}),
			position: b.position
		})) as SpecDocument["clauses"]
	}

	// Through the SDK's importer rather than returned raw: import is where a
	// document is checked, and a document core assembled from its own rows
	// deserves the same scrutiny as one that arrived in a zip file.
	return importDocument(doc)
}

/**
 * A clause's chains are derivable from its member nodes, so they are not stored.
 * Storing them would create a second place for the same fact to be wrong.
 */
function chainsOf(nodeRows: any[], clauseId: string): string[] {
	const seen: string[] = []
	for (const n of nodeRows)
		if (
			n.clauseId === clauseId &&
			n.clauseChain &&
			!seen.includes(n.clauseChain)
		)
			seen.push(n.clauseChain)
	return seen
}

