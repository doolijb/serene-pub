/**
 * 🚧 **Card actions** — a spec run pressed on a card, with no session
 * (DESIGN-image-generation §6.3, §6.5; I5, 2026-10-12).
 *
 * Every other run belongs to a session (`runSpec` takes a `sessionId` and
 * builds its live row, portrayals, status relay and settings document from
 * it). A card action has none of those: it is pressed on the Characters
 * view's Sprites tab (and, next, *Generate portrait*), fills no message row
 * and writes no session change. So it gets this small runner instead of a
 * session-shaped one with every session step guarded:
 *
 *  · the spec is loaded as published and its config resolved for the spec
 *    alone (`buildWorld({ specId })` — the admin's pipeline panel, the
 *    shipped Default config, the capability defaults);
 *  · the card is resolved ONCE, here, onto the inlet
 *    (`core:inlet/card-action@1`): its likeness as text and as the reference
 *    image, and the form's answers;
 *  · the host runs with no session in scope — a session-only node refuses
 *    with its own sentence, which is correct for a card;
 *  · the receipt is saved like any run's, with no session;
 *  · progress goes to the caller (`onProgress`, `onNode`, `onStatus`), who
 *    pushes it to the person on the card's scoped socket family.
 *
 * Who may press it is the caller's to check BEFORE this runs (the card's
 * owner or an admin); the outlet checks again at the write.
 */

import { v4 as uuidv4 } from "uuid"
import { eq } from "drizzle-orm"
import { run, type NodeEvent, type Receipt, type StatusText } from "@serene-pub/sdk"
import type { MediaRef, OverrideRow } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { loadPublished } from "$lib/server/pipelines/boot/bootstrap"
import { specOwnerPluginId } from "$lib/server/pipelines/boot/store"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost, type HostScope } from "$lib/server/pipelines/runtime/host"
import {
	saveReceipt,
	receiptWithoutQueryText,
	type RunArtifact
} from "$lib/server/pipelines/runtime/receipts"
import { createReviewer } from "$lib/server/pipelines/runtime/reviewGate"
import { ceilingFor } from "$lib/server/pipelines/runtime/callTether"
import { PipelineUnavailableError } from "$lib/server/pipelines/runtime/runTurn"
import { likenessOf } from "$lib/server/characters/likeness"
import { getMedia } from "$lib/server/media"
import type { RunProgress } from "$lib/shared/sockets/progress"

export class CardActionError extends Error {}

/** What the person's form collected. Each card action reads its own fields. */
export interface CardActionFields {
	/** Sprite set fill: the set, by name. */
	setName?: string | null
	/** Sprite set fill: the sprite labels to draw. */
	labels?: string[]
	/** 🚧 Portrait: how many pictures to offer. */
	count?: number
	/**
	 * 🚧 Describe a likeness: the likeness image the form shows but has not
	 * saved yet. Taken only when it is one of the card's own pictures; else
	 * the stored likeness image (or avatar) is used. `null` is the form's
	 * *Avatar* choice: the avatar, whatever is stored.
	 */
	likenessImageMediaId?: number | null
	[field: string]: unknown
}

export interface CardActionRequest {
	db: Db
	specId: string
	characterId: number
	/** Who pressed it — the run's owner. Already checked by the caller. */
	userId: number
	fields: CardActionFields
	runId?: string
	signal?: AbortSignal
	cancelSignal?: () => { by: string; reason: string } | undefined
	/** An image step's progress — percent, preview frames. */
	onProgress?: (e: RunProgress) => void
	/** Each node's start and settle, by key. */
	onNode?: (e: NodeEvent) => void
	/** What a node says it is doing (the cut-out's first-time download). */
	onStatus?: (nodeKey: string, text: StatusText) => void
	/**
	 * 🚧 The person's own choices for this one run, layered at `session`
	 * scope — the person's lever, above the pipeline's config. Portrait's
	 * **Style** is one: it picks the picture step's prompt row.
	 */
	overrides?: OverrideRow[]
}

/** A file row as a `MediaRef` — what a picture step's `references` port takes. */
function mediaRefOf(file: {
	uuid: string
	kind: string
	displayMime: string | null
	displayBytes: number | null
	width: number | null
	height: number | null
	filename: string | null
}): MediaRef {
	return {
		uuid: file.uuid,
		kind: file.kind as MediaRef["kind"],
		mime: file.displayMime ?? "image/png",
		bytes: file.displayBytes ?? 0,
		...(file.width != null ? { width: file.width } : {}),
		...(file.height != null ? { height: file.height } : {}),
		...(file.filename ? { filename: file.filename } : {})
	}
}

/**
 * The card action inlet's value (`core:inlet/card-action@1`): the card's
 * likeness — prompt, negative, and the image (likeness image, else avatar)
 * as a one-item media list — and the form's answers, whole and per field.
 */
export async function cardActionInput(
	db: Db,
	characterId: number,
	fields: CardActionFields
): Promise<Record<string, unknown>> {
	const character = await db.query.characters.findFirst({
		where: eq(schema.characters.id, characterId),
		columns: { id: true, extensions: true, avatarMediaId: true }
	})
	if (!character) throw new CardActionError("That character no longer exists.")
	const likeness = likenessOf(character)
	const draftId =
		fields.likenessImageMediaId === null
			? character.avatarMediaId
			: fields.likenessImageMediaId
	const draft =
		typeof draftId === "number" ? await getMedia(db, draftId) : null
	const image =
		draft && (draft as { characterId?: number | null }).characterId === characterId
			? draft
			: likeness.imageMediaId != null
				? await getMedia(db, likeness.imageMediaId)
				: null
	const likenessImage =
		image && image.kind === "image" ? [mediaRefOf(image as any)] : []
	return {
		main: { characterId, fields },
		characterId,
		likeness: likeness.prompt,
		likenessNegative: likeness.negative,
		likenessImage,
		fields,
		setName: typeof fields.setName === "string" ? fields.setName : "",
		labels: Array.isArray(fields.labels) ? fields.labels : [],
		count: typeof fields.count === "number" ? fields.count : null
	}
}

/** Run a card action's spec to the end and return its receipt. */
export async function runCardAction(req: CardActionRequest): Promise<Receipt> {
	const { db, specId } = req
	const doc = await loadPublished(db, specId)
	if (!doc)
		throw new PipelineUnavailableError(
			`no published version of '${specId}'. Core publishes its own at startup — ` +
				`check the server log for a pipeline bootstrap warning.`
		)
	const inlet = doc.nodes.find((n: any) => n.kind === "inlet") as
		| { definitionId: string; definitionVersion: number }
		| undefined
	if (inlet?.definitionId !== "core:inlet/card-action")
		throw new CardActionError(
			`'${specId}' is not a card action — its inlet is ${inlet?.definitionId ?? "missing"}.`
		)

	const runId = req.runId ?? uuidv4()
	const input = await cardActionInput(db, req.characterId, req.fields)
	const ownerPluginId = await specOwnerPluginId(db, specId)
	const artifacts: RunArtifact[] = []

	const scope: HostScope = {
		runId,
		userId: req.userId,
		cardCharacterId: req.characterId,
		specId,
		ownerPluginId,
		contributes: doc.contributes,
		inletDefinitionId: `${inlet.definitionId}@${inlet.definitionVersion}`,
		input: (doc as { input?: { event?: string; events?: string[] } }).input,
		nodes: doc.nodes.map((n: any) => ({
			key: n.key,
			kind: n.kind,
			definitionId: n.definitionId,
			definitionVersion: n.definitionVersion
		})),
		artifacts,
		addressed: [],
		formsAwaitingPeople: [],
		fires: [],
		sink: req.onProgress ? { onProgress: req.onProgress } : undefined,
		signal: req.signal
	}

	const world = await buildWorld(db, { specId })
	if (req.overrides?.length) world.overrides.push(...req.overrides)
	const user = String(req.userId)
	const seed = uuidv4()
	const receipt = await run(doc, {
		world,
		input,
		runId,
		seed,
		triggerSource: "ui",
		bindings: coreBindings({ runId, user, seed }),
		host: createHost(db, scope),
		onNode: req.onNode,
		...(req.onStatus ? { onStatus: req.onStatus } : {}),
		cancelSignal: req.cancelSignal,
		// 🚧 LS3: the ceiling of the run's trigger family — a person's press.
		timeoutCeilingMs: ceilingFor("action"),
		reviewer: createReviewer({
			userId: req.userId,
			specId,
			signal: req.signal
		})
	} as any)

	receiptWithoutQueryText(receipt)
	// 🚧 LS2: every run records its trigger family — a card's action is a press.
	receipt.triggerFamily = "action"
	await saveReceipt(db, receipt, { userId: req.userId, artifacts })
	// 🚧 What its ruleset functions raised (D3), after the receipt — as `runTurn` does. A card's
	// action has no session, so this is nothing unless its spec resolves one's ruleset. Never throws.
	await (await import("$lib/server/rulesets/emits")).dispatchRulesetEmits(db, {
		runId: receipt.runId,
		outcome: receipt.outcome,
		userId: req.userId,
		signal: req.signal,
		pipelineEmits: (doc as { functionEvents?: unknown }).functionEvents
	})
	return receipt
}
