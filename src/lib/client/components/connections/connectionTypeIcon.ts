/**
 * The mark drawn for a connection TYPE — the runtime's own logo where it has
 * one (owner, 2026-10-03: "There should be existing icons for ollama and
 * koboldcpp to use for their connections"), the generic kind glyph otherwise.
 *
 * Two brands and no third: Ollama (`ollama`, `ollama-embeddings`) and
 * KoboldCPP (`koboldcpp`, and every managed KoboldCPP type). A hosted service
 * keeps its generic glyph — its logo is somebody else's trademark to ship.
 *
 * Both brand marks are inline SVG on `currentColor`, so they take the tile's
 * colour in either theme, and take Lucide's props (`size`, `class`, rest), so
 * the returned component drops in anywhere a `@lucide/svelte` icon goes.
 *
 * Client-only: imports Svelte components.
 */
import * as Icons from "@lucide/svelte"
import type { Component } from "svelte"
import KoboldCppIcon from "$lib/client/components/icons/KoboldCppIcon.svelte"
import OllamaIcon from "$lib/client/components/icons/OllamaIcon.svelte"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	endpointKind,
	type EndpointKind
} from "$lib/shared/connections/connectionGroup"
import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"

/** The runtimes whose own mark a connection of theirs wears. */
export type ConnectionBrand = "ollama" | "koboldcpp"

/** Which brand a connection type belongs to, or `null` for none. */
export function connectionBrandOf(
	type: string | null | undefined
): ConnectionBrand | null {
	if (
		type === CONNECTION_TYPE.OLLAMA ||
		type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS
	)
		return "ollama"
	if (type === CONNECTION_TYPE.KOBOLDCPP || isKoboldCppManagedType(type))
		return "koboldcpp"
	return null
}

const BRAND_ICONS: Record<ConnectionBrand, Component<any>> = {
	ollama: OllamaIcon as Component<any>,
	koboldcpp: KoboldCppIcon as Component<any>
}

/**
 * The glyph per endpoint kind: the two runtime kinds ARE their brands; the
 * rest a `@lucide/svelte` export name. The two local ONNX kinds keep the glyph
 * their MODALITY already owns (NOMENCLATURE §22: embeddings `Zap`, entities
 * `ScanText`).
 */
const KIND_GLYPHS: Record<EndpointKind, ConnectionBrand | string> = {
	"koboldcpp-managed": "koboldcpp",
	ollama: "ollama",
	"onnx-embeddings": "Zap",
	"onnx-entities": "ScanText",
	api: "Cloud"
}

/** The icon component for an endpoint kind, when only the kind is known. */
export function kindIconComponent(kind: EndpointKind): Component<any> {
	const glyph = KIND_GLYPHS[kind]
	return (
		BRAND_ICONS[glyph as ConnectionBrand] ??
		((Icons as any)[glyph] as Component<any> | undefined) ??
		(Icons.Cable as Component<any>)
	)
}

/**
 * The icon component for a connection of `type`: its brand's mark, else
 * `fallback` (the glyph the call site drew before), else its endpoint kind's
 * glyph (`Cloud`, `Zap`, `ScanText`).
 */
export function connectionTypeIcon(
	type: string | null | undefined,
	fallback?: Component<any>
): Component<any> {
	const brand = connectionBrandOf(type)
	if (brand) return BRAND_ICONS[brand]
	return fallback ?? kindIconComponent(endpointKind(type))
}
