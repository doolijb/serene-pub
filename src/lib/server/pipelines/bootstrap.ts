/**
 * What core puts in the pipeline tables at startup.
 *
 * Two things, and they are different in kind:
 *
 * 1. **The type registry** — every node type core knows about, hashed, so a
 *    stored document that names a type gets the same type back on the next boot
 *    or refuses to load (F3, U2). This is a *fact* about the running code.
 * 2. **Core's own spec documents** — the pipelines core ships, published so a
 *    chat can run one. This is *content*, and the difference matters at the next
 *    line of code: the registry sync raises on conflict, and spec publishing is
 *    idempotent by version.
 *
 * ## Why this is not in `db/defaults.ts`
 *
 * The seeded rows there are user-editable content — prompt configs, context
 * configs — upserted by `seedKey` so a user's edits survive. A published spec
 * version is **immutable by construction** (F3: rows are the system of record,
 * and a published version is what a run resolved against). Re-seeding one on
 * every boot would either clobber a run's history or need an exception in a file
 * whose whole rule is that there are none.
 *
 * ## What happens when the code and the database disagree
 *
 * The registry sync refuses rather than reconciling. A type whose ports changed
 * under a document that already uses it is not a merge; it is a spec that means
 * something different than it did when someone approved it, and the honest
 * response is to stop and say so. See `registrySync.ts`.
 */

import { compile, spec, slot, allTypes } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { saveDocument, loadDocument } from "./store"
import { syncTypeRegistry, TypeRegistryConflictError } from "./registrySync"
import * as schema from "$lib/server/db/schema"
import { eq, and } from "drizzle-orm"

/** The spec a chat turn runs. */
export const RESPOND_SPEC_ID = "core:spec/respond"
export const RESPOND_VERSION = "1.0.0"

/**
 * Core's answer-a-message pipeline.
 *
 * The keyword arm only, deliberately: it is the configuration every install has,
 * and the semantic arm needs a loaded embedding model that most do not have on
 * first boot. A spec that halts on a missing model would be the first thing a
 * new user saw.
 */
export const respondSpec = () =>
	compile(
		spec(RESPOND_SPEC_ID, { version: RESPOND_VERSION })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.chatHistory.v1({ scope: $.input.chatScope })
			)
			.query("lore", ($) =>
				C.lorebookTriggers.v1({ scope: $.input.chatScope })
			)
			.query("cast", ($) => C.chatCast.v1({ scope: $.input.chatScope }))
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.cast.cast,
					prompts: slot.prompts()
				})
			)
			.task("rank", ($) =>
				C.rankHybrid.v1({
					candidates: $.lore.main,
					params: slot.params()
				})
			)
			.task("lines", ($) =>
				C.processMessages.v1({
					messages: $.history.messages,
					cast: $.cast.cast,
					templateContext: $.context.templateContext,
					seedName: $.context.seedName
				})
			)
			.task("prompt", ($) =>
				C.assemble.v2({
					candidates: $.rank.candidates,
					decisions: $.rank.decisions,
					messages: $.lines.messages,
					templateContext: $.context.templateContext,
					template: slot.template(),
					prompts: slot.prompts(),
					params: slot.params()
				})
			)
			.provider("generate", ($) =>
				C.generateText.v1({ context: $.prompt.context })
			)
			.consume("save", ($) =>
				C.createMessage.v1({ text: $.generate.text })
			)
			.build()
	)

export interface BootstrapReport {
	types: { inserted: number; unchanged: number }
	specs: Array<{
		id: string
		version: string
		action: "published" | "present"
	}>
	/** Set when the registry refused; the app still boots, pipelines do not run. */
	conflict?: string
}

/**
 * Bring the pipeline tables in line with this build.
 *
 * Returns a report rather than throwing on a registry conflict. A type-hash
 * conflict means *pipelines* cannot run safely; it does not mean the chat app
 * cannot start, and taking the whole instance down over a subsystem nobody has
 * opted into yet would be the wrong trade. The conflict travels in the report so
 * the diagnostics screen can say what is wrong and the caller can decide.
 */
export async function bootstrapPipelines(db: any): Promise<BootstrapReport> {
	const report: BootstrapReport = {
		types: { inserted: 0, unchanged: 0 },
		specs: []
	}

	try {
		// Every type the running build knows about. Importing the contracts is
		// what registers them, so this is a fact about the code rather than a
		// list anyone maintains.
		const synced = await syncTypeRegistry(db, allTypes(), {
			release: RESPOND_VERSION
		})
		report.types = {
			inserted: synced.inserted.length,
			unchanged: synced.unchanged.length
		}
	} catch (err) {
		if (err instanceof TypeRegistryConflictError) {
			report.conflict = err.message
			return report
		}
		throw err
	}

	for (const build of [respondSpec]) {
		const doc = build()

		// Matched on the authored slug and semver, not on a row id: the id is
		// per-instance, and this has to answer "has *this build's* version of
		// this spec been published here" identically on a fresh install and on
		// one that has been upgraded four times.
		const existing = await db
			.select({ id: schema.pipelineSpecVersions.id })
			.from(schema.pipelineSpecVersions)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
			)
			.where(
				and(
					eq(schema.pipelineSpecs.slug, doc.id),
					eq(schema.pipelineSpecVersions.semver, doc.version)
				)
			)
			.limit(1)

		if (existing.length > 0) {
			report.specs.push({
				id: doc.id,
				version: doc.version,
				action: "present"
			})
			continue
		}

		await saveDocument(db, doc, { publish: true })
		report.specs.push({
			id: doc.id,
			version: doc.version,
			action: "published"
		})
	}

	return report
}

/**
 * The published document for a spec id, or null.
 *
 * Loaded from rows every time rather than cached at module scope: the rows are
 * the system of record (F3), and a cache would mean an admin publishing a new
 * version has to restart the process for it to take effect — which is the kind
 * of thing that gets discovered in production.
 */
export async function loadPublished(db: any, specId: string) {
	const [row] = await db
		.select({ id: schema.pipelineSpecVersions.id })
		.from(schema.pipelineSpecVersions)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.where(
			and(
				eq(schema.pipelineSpecs.slug, specId),
				eq(schema.pipelineSpecVersions.status, "published")
			)
		)
		.orderBy(schema.pipelineSpecVersions.id)
		.limit(1)
	if (!row) return null
	return await loadDocument(db, row.id)
}
