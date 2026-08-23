/**
 * Carrying each scope's context config across, once.
 *
 * `pipeline_context_templates` supersedes `context_configs`. The legacy table
 * keeps its rows — a story string somebody spent a year on is not something an
 * upgrade may lose — but nothing in 0.6 renders from it, so whatever each scope
 * had selected has to arrive on the other side or that person's prompts change
 * shape on upgrade without anyone touching a setting.
 *
 * Two things happen per scope, and they are one pass because they are one
 * question: *which context config does this scope render through?*
 *
 * 1. **Carry it across.** A template somebody wrote is copied into the new
 *    table and that scope is pointed at the copy. Core's own row is not copied
 *    — the new table seeds its own, which is the 0.6 template.
 *
 * 2. **Pin the layouts, if it is theirs.** 0.6 moved the headings and fences
 *    out of the context template and into the variable layouts. Core's new
 *    template has none; a copied one still has all of them. So a scope on a
 *    copied template gets its layouts pinned to the bare rows, or every prompt
 *    would say
 *
 *        Assistant Characters (AI-controlled):
 *        ```json
 *        Assistant Characters (AI-controlled):
 *        ```json
 *        [ … ]
 *
 *    — the wrapper twice, in every turn. Nothing about the rendered prompt
 *    changes; the wrapper is simply still coming from where it always came
 *    from. It also covers a subtler case with the same fix: a layout that
 *    writes a `"""` fence read through a double stash (`{{scenario}}` rather
 *    than `{{{scenario}}}`) arrives HTML-escaped, as `&quot;&quot;&quot;`.
 *    Hand-written templates use both stashes freely, and a bare layout has no
 *    fence to escape.
 *
 * ## Per scope, because the selection was made per scope
 *
 * `context_configs` was selected at two layers: `system_settings` for the
 * instance and `user_settings` for each person. A single instance-wide answer
 * would be wrong for exactly the install this exists for — an admin on a
 * hand-written template and a user still on core's, or the reverse. Each scope
 * is decided against the config that scope actually selected.
 *
 * A user's override is written only when it *differs* from the instance's — the
 * same rule `migrateLegacy` follows, and for the same reason. An override that
 * merely restates what was already inherited stops tracking an admin's later
 * change forever.
 *
 * ## Once
 *
 * Guarded by `system_settings.context_templates_migrated`, not by re-deriving
 * the condition each boot. Re-deriving would keep re-pinning someone who
 * cleared one of these settings deliberately, and the panel would revert with
 * nothing saying why.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations, type Decl } from "$lib/server/pipelines/config/panel"
import {
	bareVariableTemplateFor,
	defaultVariableTemplateFor
} from "$lib/server/pipelines/boot/seedVariableTemplates"
import { SHIPPED_VARIABLE_TEMPLATES, seedKeyFor } from "$lib/server/pipelines/entities/variableLayouts"
import { createContextTemplate } from "$lib/server/pipelines/entities/contextTemplates"
import {
	CONTEXT_TEMPLATE_NODE_TYPE,
	poolKeyFor
} from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { defaultContextTemplateFor } from "$lib/server/pipelines/boot/seedContextTemplates"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"

type Db = { select: any; insert: any; update: any; delete: any }

/** The seed key of the legacy context config core used to keep up to date. */
const CORE_CONTEXT_SEED_KEY = "context-default"

export interface ContextTemplateMigrationReport {
	/** False when the ledger says this already ran. */
	ran: boolean
	/** Legacy rows copied into the new table. */
	copied: number
	/** Template selections written, across every spec and scope. */
	selected: number
	/** Layout pins written, across every spec and scope. */
	pinned: number
	/** Scopes found to be on a template of their own. */
	customScopes: string[]
	/** Shipped-config values moved off a row that used to be core's default. */
	rePointed: number
}

/** Which layout rows a scope should be on, given the template it renders through. */
type Pin = "shipped" | "bare"

export async function migrateContextTemplates(
	db: Db
): Promise<ContextTemplateMigrationReport> {
	const report: ContextTemplateMigrationReport = {
		ran: false,
		copied: 0,
		selected: 0,
		pinned: 0,
		customScopes: [],
		rePointed: 0
	}

	const [settings] = await db.select().from(schema.systemSettings).limit(1)
	// No settings row at all means no install to migrate — a fresh database
	// mid-bootstrap. Leave the ledger alone so this runs when there is one.
	if (!settings) return report
	if (settings.contextTemplatesMigrated) return report
	report.ran = true

	const legacyRows = await db.select().from(schema.contextConfigs)
	const legacyById = new Map<number, any>(
		(legacyRows as any[]).map((c) => [c.id, c])
	)

	/**
	 * The new-table row a legacy id should resolve to, copying it if needed.
	 *
	 * Core's legacy row maps to core's *seeded* row rather than to a copy of
	 * itself: they are the same template one release apart, and copying it
	 * would put a second "Default" in every picker that renders identically
	 * except for the headings it duplicates.
	 */
	const copies = new Map<number, number | null>()
	const carryAcross = async (legacyId: number): Promise<number | null> => {
		if (copies.has(legacyId)) return copies.get(legacyId)!

		const legacy = legacyById.get(legacyId)
		if (!legacy) {
			copies.set(legacyId, null)
			return null
		}

		if (legacy.seedKey === CORE_CONTEXT_SEED_KEY) {
			const shipped = await defaultContextTemplateFor(
				db,
				CONTEXT_TEMPLATE_NODE_TYPE
			)
			copies.set(legacyId, shipped)
			return shipped
		}

		// Already carried across on an earlier run — which is what makes the
		// copy half idempotent without leaning on the ledger, and is why that
		// column is on the row rather than in a side table.
		const [existing] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				eq(
					schema.pipelineContextTemplates.migratedFromContextConfigId,
					legacyId
				)
			)
			.limit(1)
		if (existing) {
			copies.set(legacyId, existing.id)
			return existing.id
		}

		const created = await createContextTemplate(db, {
			nodeTypeId: CONTEXT_TEMPLATE_NODE_TYPE,
			name: await freeName(db, legacy.name || "Context template"),
			source: legacy.template ?? "",
			// The engine travels on the value (12 §2a). A legacy row that never
			// recorded one was Handlebars, because that is all 0.5 had.
			engine: legacy.engine ?? CORE_TEMPLATE_ENGINE,
			// Belongs to no pipeline: it predates the idea, and guessing one
			// would bury it under "used here" in a panel it was never written
			// for. It lands in the picker's third group, which is honest.
			createdForSpecId: null,
			migratedFromContextConfigId: legacyId
		})
		report.copied++
		copies.set(legacyId, created.id)
		return created.id
	}

	const instanceLegacyId = settings.defaultContextConfigId ?? null
	const instanceTemplateId =
		instanceLegacyId != null ? await carryAcross(instanceLegacyId) : null
	const pinFor = (legacyId: number | null): Pin =>
		legacyId != null &&
		legacyById.get(legacyId)?.seedKey !== CORE_CONTEXT_SEED_KEY
			? "bare"
			: "shipped"

	const instancePin = pinFor(instanceLegacyId)
	if (instancePin === "bare") report.customScopes.push("instance")

	const userRows = await db.select().from(schema.userSettings)
	interface Target {
		scopeKind: "instance" | "user"
		scopeId: number
		templateId: number | null
		pin: Pin
	}
	const targets: Target[] = []

	// The instance writes a selection only when it is not already core's — the
	// shipped config points at the shipped template, so restating it would pin
	// the instance to today's answer forever. Same rule for the pin.
	if (instancePin === "bare")
		targets.push({
			scopeKind: "instance",
			scopeId: 0,
			templateId: instanceTemplateId,
			pin: instancePin
		})

	for (const u of userRows as any[]) {
		const legacyId = u.activeContextConfigId ?? null
		// Chose nothing for themselves, so they inherit — correctly, since they
		// were inheriting before too.
		if (legacyId == null) continue
		const pin = pinFor(legacyId)
		const templateId = await carryAcross(legacyId)
		// Identical to what the instance resolves to, so writing it would only
		// stop this person tracking an admin's later change.
		if (pin === instancePin && templateId === instanceTemplateId) continue
		if (pin === "bare") report.customScopes.push(`user:${u.userId}`)
		targets.push({
			scopeKind: "user",
			scopeId: u.userId,
			templateId,
			pin
		})
	}

	if (targets.length) {
		const specs = await db.select().from(schema.pipelineSpecs)
		const now = new Date()

		for (const spec of specs as any[]) {
			if (spec.activeVersionId == null) continue
			const decls = await declarations(db, spec.activeVersionId)
			const templateDecls = decls.filter(
				(d) => d.control === "context-template-ref"
			)
			const layoutDecls = decls.filter(
				(d) => d.control === "variable-template-ref" && d.variableId
			)
			if (!templateDecls.length && !layoutDecls.length) continue

			// Resolved once per variable per pin rather than once per
			// declaration: the same variable is declared by more than one node
			// in a spec, and a layout row is keyed by what it renders rather
			// than by who renders it.
			const rowIds = new Map<string, number | null>()
			const layoutFor = async (variableId: string, pin: Pin) => {
				const cacheKey = `${pin}:${variableId}`
				if (!rowIds.has(cacheKey))
					rowIds.set(
						cacheKey,
						pin === "bare"
							? await bareVariableTemplateFor(db, variableId)
							: await defaultVariableTemplateFor(db, variableId)
					)
				return rowIds.get(cacheKey) ?? null
			}

			for (const target of targets) {
				const write = async (d: Decl, value: number | null) => {
					// A value there is nothing to point at cannot be written,
					// and writing NULL would read as "explicitly set to
					// nothing" rather than "left inheriting".
					if (value == null) return false

					// Never over a choice that is already there. This runs
					// after `migrateLegacyToPipelines`, so an override at this
					// address is one somebody made.
					const [existing] = await db
						.select()
						.from(schema.pipelineNodeOverrides)
						.where(
							and(
								eq(
									schema.pipelineNodeOverrides.specId,
									spec.id
								),
								eq(
									schema.pipelineNodeOverrides.scopeKind,
									target.scopeKind
								),
								eq(
									schema.pipelineNodeOverrides.scopeId,
									target.scopeId
								),
								eq(
									schema.pipelineNodeOverrides.nodeKey,
									d.nodeKey
								),
								eq(schema.pipelineNodeOverrides.slot, d.slot),
								eq(schema.pipelineNodeOverrides.path, d.path)
							)
						)
						.limit(1)
					if (existing) return false

					await db.insert(schema.pipelineNodeOverrides).values({
						specId: spec.id,
						scopeKind: target.scopeKind,
						scopeId: target.scopeId,
						nodeKey: d.nodeKey,
						slot: d.slot,
						path: d.path,
						value,
						updatedAt: now
					})
					return true
				}

				for (const d of templateDecls)
					if (
						d.nodeTypeId ===
							poolKeyFor(CONTEXT_TEMPLATE_NODE_TYPE) &&
						(await write(d, target.templateId))
					)
						report.selected++

				for (const d of layoutDecls)
					if (
						await write(
							d,
							await layoutFor(d.variableId!, target.pin)
						)
					)
						report.pinned++
			}
		}
	}

	report.rePointed = await rePointShippedConfigs(db)

	await db
		.update(schema.systemSettings)
		.set({ contextTemplatesMigrated: true })
		.where(eq(schema.systemSettings.id, settings.id))

	return report
}

/**
 * A name no other template for this node type is using.
 *
 * `(node_type_id, name)` is a unique index, so two legacy configs both called
 * "Default" — one core's, one a clone somebody never renamed — would make the
 * second insert throw at boot. Suffixing is the least surprising resolution: a
 * picker with two identical labels is unusable anyway, so the constraint is
 * right and this is what satisfying it looks like.
 */
async function freeName(db: Db, wanted: string): Promise<string> {
	const rows = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			eq(
				schema.pipelineContextTemplates.nodeTypeId,
				poolKeyFor(CONTEXT_TEMPLATE_NODE_TYPE)
			)
		)
	const taken = new Set((rows as any[]).map((r) => r.name))
	if (!taken.has(wanted)) return wanted
	for (let n = 2; ; n++) {
		const candidate = `${wanted} (${n})`
		if (!taken.has(candidate)) return candidate
	}
}

/**
 * Move a shipped config off a layout row that used to be core's default.
 *
 * Only reachable from a database seeded by a **0.6 build that predates the
 * layouts split** — no released version has these tables, so no user's install
 * is in this state. Development instances are, which is enough: on one of them
 * the shipped config records "the JSON layout" from when that was the only row,
 * `ensureDefaultConfig` is insert-only so it never revisits the value, and the
 * template was rewritten out from under it. The result is every heading
 * silently gone, on the exact instances the feature gets looked at on.
 *
 * Scoped as narrowly as the problem: **immutable configs only**, and only a
 * value already pointing at another *shipped* row for the same variable. A
 * config an admin created is theirs and is not touched, and a user's own choice
 * lives in an override, which this never reads.
 *
 * ## Addressed by declaration, never by what the number happens to match
 *
 * The first version walked every config value and asked whether its number was
 * the id of a variable-template row. Every reference slot stores a plain
 * integer, so a prompts-ref value of `5` matched layout row `5` and got
 * re-pointed at a template — which is how the summarize namespaces ended up
 * with their prompts replaced by a characters layout. `seedPrompts.int.test`
 * caught it. Two id spaces that look identical need the *address* to tell them
 * apart, and the declaration is the address.
 */
async function rePointShippedConfigs(db: Db): Promise<number> {
	const templates = await db.select().from(schema.pipelineVariableTemplates)
	if (!templates.length) return 0
	const byId = new Map<number, any>(
		(templates as any[]).map((t) => [t.id, t])
	)
	const bySeedKey = new Map<string, any>(
		(templates as any[]).filter((t) => t.seedKey).map((t) => [t.seedKey, t])
	)

	let moved = 0
	for (const spec of (await db
		.select()
		.from(schema.pipelineSpecs)) as any[]) {
		if (spec.activeVersionId == null) continue
		const layoutDecls = (
			await declarations(db, spec.activeVersionId)
		).filter((d) => d.control === "variable-template-ref" && d.variableId)
		if (!layoutDecls.length) continue

		const configs = (
			await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, spec.id))
		).filter((c: any) => c.isImmutable)

		for (const config of configs as any[]) {
			const values = await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, config.id))

			for (const d of layoutDecls) {
				const v = (values as any[]).find(
					(row) =>
						row.nodeKey === d.nodeKey &&
						row.slot === d.slot &&
						(row.path ?? "") === d.path
				)
				if (!v || typeof v.value !== "number") continue

				const current = byId.get(v.value)
				// Pointing at a row somebody wrote, or at nothing.
				if (!current?.isImmutable || !current.seedKey) continue
				if (current.variableId !== d.variableId) continue

				const shipped = SHIPPED_VARIABLE_TEMPLATES.find(
					(t) => t.variableId === d.variableId && t.isDefault
				)
				if (!shipped) continue

				const want = bySeedKey.get(seedKeyFor(shipped))
				if (!want || want.id === current.id) continue

				await db
					.update(schema.pipelineConfigValues)
					.set({ value: want.id })
					.where(eq(schema.pipelineConfigValues.id, v.id))
				moved++
			}
		}
	}
	return moved
}
