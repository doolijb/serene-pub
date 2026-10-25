/**
 * What a model on a connection can be FOR (`connection_models.modality`).
 *
 * One answer, read by the model page's **What it's for** control and by
 * `connections:updateModel`, so the choices offered and the choices accepted
 * cannot drift apart.
 */

import { adapterCapabilities } from "$lib/shared/connectionAdapters/manifest"
import { MODEL_PURPOSES, type ModelPurpose } from "$lib/shared/connections/modelKinds"
import { isTransformId, parseTransform } from "@serene-pub/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	CONNECTION_SECTIONS,
	modalityOfTransform
} from "$lib/shared/constants/connectionSections"

/**
 * The modalities a model on a connection of this type may hold: the output
 * of every transform the type's manifest entry supports, in the sections'
 * order. A type with no manifest entry holds its own modality alone. `null`
 * ("Not sure") is always accepted besides these.
 */
export function modelModalityChoices(type: string): string[] {
	const supports = adapterCapabilities(type)?.supports
	if (!supports) return [CONNECTION_TYPE.modalityOf(type)]
	const held = new Set(Object.keys(supports).map(modalityOfTransform))
	return CONNECTION_SECTIONS.map((s) => s.modality).filter((m) => held.has(m))
}

/**
 * 🚧 The **What it's for** choices a model on a connection of this type may
 * hold (O3): each purpose whose kind some transform the type's manifest
 * supports reads (Hears, Sees) or writes (Writes replies, Draws pictures,
 * Speaks). A type with no manifest entry offers none.
 */
export function modelPurposeChoices(type: string): ModelPurpose[] {
	const supports = adapterCapabilities(type)?.supports
	if (!supports) return []
	const ins = new Set<string>()
	const outs = new Set<string>()
	for (const id of Object.keys(supports)) {
		if (!isTransformId(id)) continue
		const t = parseTransform(id as never) as unknown as { in: string[]; out: string[] }
		for (const k of t.in) ins.add(k)
		for (const k of t.out) outs.add(k)
	}
	return MODEL_PURPOSES.filter((p) =>
		(p.side === "writes" ? outs : ins).has(p.kind)
	)
}
