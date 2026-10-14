/**
 * 🚧 **Fill empty sprites** — the Sprites tab's action, server side
 * (DESIGN-image-generation §6.3, §4.7, §6.6; I5).
 *
 * Two halves, one series:
 *
 *  - `previewSpriteFill` is the **form preview**: which labels a fill would
 *    draw (every empty sprite in the set, unless the person picks), the
 *    cost line (*28 pictures · 3 calls on …*), any per-image price the
 *    model's facts know, and the notices the picture step would raise
 *    before the run (`previewImageRun`) — so the form can say *This model
 *    can't take a reference image* before anything is drawn.
 *  - `startSpriteFill` runs `core:spec/sprite-set-fill` as a card action
 *    (`runCardAction`) and reports each step to the caller.
 *
 * The series a preview prices and the series a run draws are built by the
 * same function (`buildSpriteSeries`), from the same prompt row.
 *
 * ⚠ Members never see a connection or a model: the cost line names the
 * pair (and its price) for an admin only.
 */

import { eq } from "drizzle-orm"
import { resolveConfig } from "@serene-pub/sdk"
import {
	SPRITE_SET_FILL_NODES,
	SPRITE_SET_FILL_SPEC_ID
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { slotConnectionId, slotModelId } from "$lib/shared/connections/slotRef"
import {
	money,
	perImagePriceOf,
	type PerImagePrice
} from "$lib/shared/connections/imagePrice"
import { listSpriteSets } from "$lib/server/sprites"
import { buildSpriteSeries, emptySpriteLabels, fillLabels } from "$lib/server/sprites/fill"
import { cardActionInput } from "$lib/server/pipelines/runtime/cardAction"
import { normalizeSpriteName, type SpriteSetView } from "$lib/shared/sprites"

export interface SpriteFillPreview {
	characterId: number
	setId: number | null
	setName: string
	/** The labels this fill would draw: the person's pick, else every empty sprite. */
	labels: string[]
	/** The set's empty sprites — the form's default selection. */
	emptyLabels: string[]
	/** Every label in the set, alphabetical — what the form offers. */
	allLabels: string[]
	pictures: number
	/** Null when the step would be refused before a call is planned. */
	calls: number | null
	/**
	 * The cost line, ready to show: *28 pictures · 3 calls* — with
	 * *on <pair>* and the per-image price for an admin.
	 */
	line: string
	/** What the picture step would say before the run, plus the card's own notices. */
	notices: string[]
	/** Why the run would be refused before drawing anything. */
	refusal?: string
}

/** The set a fill targets: the one asked for, else the default, else the first. */
function chooseSet(sets: SpriteSetView[], setId?: number | null): SpriteSetView | null {
	return (
		(setId != null ? sets.find((s) => s.id === setId) : undefined) ??
		sets.find((s) => s.isDefault) ??
		sets[0] ??
		null
	)
}

/** A stored `workflow` slot value — `{ id }` or a bare id — as a row id. */
const workflowIdOf = (v: unknown): number | null =>
	typeof v === "number"
		? v
		: typeof (v as { id?: unknown } | undefined)?.id === "number"
			? (v as { id: number }).id
			: null

/** The resolved config of the fill's picture and series steps, for the spec alone. */
export async function resolvedSteps(db: Db) {
	const world = await buildWorld(db, { specId: SPRITE_SET_FILL_SPEC_ID })
	const resolved = resolveConfig(world, [
		SPRITE_SET_FILL_NODES.series,
		SPRITE_SET_FILL_NODES.draw
	])
	const draw = resolved[SPRITE_SET_FILL_NODES.draw] ?? {}
	const series = resolved[SPRITE_SET_FILL_NODES.series] ?? {}
	const samplingStored = draw.sampling?.[""]
	const samplingId =
		typeof samplingStored === "number"
			? samplingStored
			: typeof (samplingStored as { id?: unknown } | undefined)?.id === "number"
				? ((samplingStored as { id: number }).id)
				: null
	return {
		connectionId: slotConnectionId(draw.connection?.[""]),
		connectionModelId: slotModelId(draw.connection?.[""]),
		samplingId,
		// The `workflow` slot, as the run reads it (`host.ts`): the step's own
		// pick, else its loadout's — `buildWorld` already projected the
		// loadout layer (`applyLoadoutLayer`) onto these three slots.
		workflowId: workflowIdOf(draw.workflow?.[""]),
		drawPrompts: (draw.prompts ?? {}) as { positive?: string; negative?: string },
		drawParams: (draw.params ?? {}) as Record<string, unknown>,
		phrases: (series.prompts as { phrases?: unknown } | undefined)?.phrases
	}
}

export { money } from "$lib/shared/connections/imagePrice"

/** The model's per-picture price, when its facts know one (`facts.pricing.perImage`). */
export async function perImagePrice(
	db: Db,
	connectionModelId: number | null
): Promise<PerImagePrice | null> {
	if (connectionModelId == null) return null
	const row = await db.query.connectionModels.findFirst({
		where: eq(schema.connectionModels.id, connectionModelId),
		columns: { facts: true }
	})
	return perImagePriceOf(row?.facts)
}

/** The form preview for *Fill empty sprites* (and a tile's *Redo*). */
export async function previewSpriteFill(
	db: Db,
	req: {
		characterId: number
		setId?: number | null
		labels?: string[] | null
		userId: number
		isAdmin: boolean
	}
): Promise<SpriteFillPreview> {
	const sets = await listSpriteSets(db, req.characterId)
	const set = chooseSet(sets, req.setId)
	const emptyLabels = emptySpriteLabels(set)
	const allLabels = set
		? [...new Set(set.sprites.map((s) => s.label))].sort((a, b) => a.localeCompare(b))
		: []
	const labels = req.labels?.length ? fillLabels(req.labels) : emptyLabels
	const base = {
		characterId: req.characterId,
		setId: set?.id ?? null,
		setName: set?.name ?? "",
		labels,
		emptyLabels,
		allLabels,
		pictures: labels.length
	}
	if (!labels.length)
		return {
			...base,
			calls: 0,
			line: "Nothing to draw: every sprite in this set has a picture.",
			notices: []
		}

	const input = await cardActionInput(db, req.characterId, {
		setName: base.setName,
		labels
	})
	const steps = await resolvedSteps(db)
	const { series } = buildSpriteSeries({
		labels,
		phrases: steps.phrases,
		likeness: input.likeness,
		likenessNegative: input.likenessNegative
	})
	const notices: string[] = []
	const hasImage = (input.likenessImage as unknown[]).length > 0
	if (!hasImage && !String(input.likeness ?? "").trim())
		notices.push(
			"This character has no likeness yet, so each picture is drawn from its sprite label alone. Add a picture or a description on the Likeness tab for a set that looks like them."
		)

	const { previewImageRun } = await import(
		"$lib/server/pipelines/runtime/dispatchImage"
	)
	const pick = <T extends string>(v: unknown, of: readonly T[]) =>
		of.includes(v as T) ? (v as T) : null
	const preview = await previewImageRun(db, {
		prompt: String(input.likeness ?? ""),
		negative: String(input.likenessNegative ?? ""),
		prompts: steps.drawPrompts,
		connectionId: steps.connectionId,
		connectionModelId: steps.connectionModelId,
		samplingId: steps.samplingId,
		workflowId: steps.workflowId,
		userId: req.userId,
		series,
		references: input.likenessImage as any,
		orientation: pick(steps.drawParams.orientation, [
			"free",
			"square",
			"portrait",
			"landscape"
		] as const),
		cutOut: pick(steps.drawParams.cutOut, [
			"off",
			"native-or-task",
			"native-only"
		] as const),
		referencesPolicy: pick(steps.drawParams.references, [
			"preferred",
			"required"
		] as const)
	})
	if (!preview.ok)
		return {
			...base,
			calls: null,
			line: pictureCount(labels.length),
			notices,
			refusal: preview.refusal
		}

	notices.push(...preview.preRunNotices)
	try {
		const { mattingModelState } = await import("$lib/server/localModels/matting")
		if (
			steps.drawParams.cutOut !== "off" &&
			(await mattingModelState(db)).state !== "on_disk"
		)
			notices.push(
				"The first fill downloads the background remover once, so it takes a little longer."
			)
	} catch {
		// The download notice is a courtesy; a failed check says nothing.
	}

	const calls = preview.plan.calls.length
	let line = `${pictureCount(preview.plan.pictures)} · ${calls} ${calls === 1 ? "call" : "calls"}`
	if (req.isAdmin) {
		const pair = preview.pair.modelName
			? `${preview.pair.connectionName} · ${preview.pair.modelName}`
			: preview.pair.connectionName
		line += ` on ${pair}`
		const price = await perImagePrice(db, preview.pair.connectionModelId)
		if (price)
			line += ` · about ${money(price.each, price.currency)} a picture, ${money(
				price.each * preview.plan.pictures,
				price.currency
			)} in all`
	}
	return { ...base, calls, line, notices }
}

export const pictureCount = (n: number) => `${n} ${n === 1 ? "picture" : "pictures"}`

export interface SpriteFillProgress {
	characterId: number
	runId: string
	/** Where the run is. `done` and `failed` are final. */
	phase: "drawing" | "cutting" | "attaching" | "done" | "failed"
	/** The labels this run draws, so a sheet opened mid-run knows its tiles. */
	labels: string[]
	setId: number | null
	status?: unknown
	percent?: number
	/** Pictures drawn so far (before the cut-out), keyed to their label. */
	drawn?: Array<{ label: string; uuid: string }>
	/** Sprite rows written, per label. */
	attached?: Array<{ label: string; spriteId: number }>
	/** Labels that came back with no picture. */
	missing?: string[]
	error?: string
}

/**
 * Run the fill and report as it goes. Resolves when the run ends; `report`
 * has been told the final phase by then. Never throws for a run that
 * failed — the failure is the final report.
 */
export async function runSpriteFill(
	db: Db,
	req: {
		characterId: number
		setId?: number | null
		labels?: string[] | null
		userId: number
		runId: string
		signal?: AbortSignal
		cancelSignal?: () => { by: string; reason: string } | undefined
		report: (p: SpriteFillProgress) => void
	}
): Promise<void> {
	const sets = await listSpriteSets(db, req.characterId)
	const set = chooseSet(sets, req.setId)
	const labels = req.labels?.length ? fillLabels(req.labels) : emptySpriteLabels(set)
	const head = {
		characterId: req.characterId,
		runId: req.runId,
		labels,
		setId: set?.id ?? null
	}
	if (!labels.length) {
		req.report({ ...head, phase: "done", attached: [], missing: [] })
		return
	}
	const { runCardAction } = await import(
		"$lib/server/pipelines/runtime/cardAction"
	)
	const { haltExplanation } = await import(
		"$lib/server/pipelines/runtime/haltExplanation"
	)
	const labelOf = new Map(
		buildSpriteSeries({ labels }).series.map((i) => [
			String(i.key),
			String((i.vars as { label?: string }).label ?? i.key)
		])
	)
	let phase: SpriteFillProgress["phase"] = "drawing"
	req.report({ ...head, phase })
	try {
		const receipt = await runCardAction({
			db,
			specId: SPRITE_SET_FILL_SPEC_ID,
			characterId: req.characterId,
			userId: req.userId,
			fields: { setName: set?.name ?? "", labels },
			runId: req.runId,
			signal: req.signal,
			cancelSignal: req.cancelSignal,
			onProgress: (e) =>
				req.report({
					...head,
					phase,
					...(e.percent != null ? { percent: e.percent } : {}),
					...(e.status ? { status: e.status } : {})
				}),
			onStatus: (_node, text) => req.report({ ...head, phase, status: text }),
			onNode: (e) => {
				if (e.phase !== "start") return
				if (e.nodeKey === SPRITE_SET_FILL_NODES.cutOut) phase = "cutting"
				else if (e.nodeKey === SPRITE_SET_FILL_NODES.attach) phase = "attaching"
				else return
				req.report({ ...head, phase })
			}
		})
		const node = (key: string) =>
			receipt.nodes.find((n) => n.nodeKey === key && n.result === "ok")
				?.output as Record<string, unknown> | undefined
		// The pictures as drawn, so the sheet fills even when the write halts.
		const drawnMedia = node(SPRITE_SET_FILL_NODES.cutOut)?.media ??
			node(SPRITE_SET_FILL_NODES.draw)?.media
		const drawn = (Array.isArray(drawnMedia) ? drawnMedia : [])
			.filter((m: any) => m?.key && typeof m.uuid === "string")
			.map((m: any) => ({
				label: labelOf.get(String(m.key)) ?? normalizeSpriteName(String(m.key)),
				uuid: m.uuid as string
			}))
		if (receipt.outcome !== "ok") {
			req.report({
				...head,
				phase: "failed",
				drawn,
				error: haltExplanation(receipt) ?? "The fill stopped before it finished."
			})
			return
		}
		const out = node(SPRITE_SET_FILL_NODES.attach) ?? {}
		req.report({
			...head,
			phase: "done",
			drawn,
			attached: Array.isArray(out.attached) ? (out.attached as any) : [],
			missing: Array.isArray(out.missing) ? (out.missing as any) : []
		})
	} catch (e) {
		req.report({
			...head,
			phase: "failed",
			error: e instanceof Error ? e.message : String(e)
		})
	}
}
