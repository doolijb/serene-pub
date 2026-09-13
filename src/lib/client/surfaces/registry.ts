/**
 * The native-surface registry (plan 21 §6). Maps a `PanelDecl` component key to
 * the Svelte component that renders it. Frame panels don't appear here — they
 * mount `PluginFrame` from their `src`. The primary conversation panel is also
 * absent: it is supplied by the session page as a snippet, because it needs the
 * page's full message/composer wiring.
 *
 * A key with no entry renders as a labeled placeholder (uninstalling or a typo
 * strands nothing), mirroring the unknown-part floor in the message model.
 */
import type { Component } from "svelte"
import ScenePortraitsPanel from "$lib/client/components/surfaces/panels/ScenePortraitsPanel.svelte"
import MapPanel from "$lib/client/components/surfaces/panels/MapPanel.svelte"
import NotesPanel from "$lib/client/components/surfaces/panels/NotesPanel.svelte"
import StatsPanel from "$lib/client/components/surfaces/panels/StatsPanel.svelte"
import InventoryPanel from "$lib/client/components/surfaces/panels/InventoryPanel.svelte"
import WorldStatePanel from "$lib/client/components/surfaces/panels/WorldStatePanel.svelte"

/** Props every native panel component receives. */
export interface NativePanelProps {
	sessionId: number | null
	/** The live session object, when the host has one. */
	session?: unknown
	/** Channels this panel subscribes to (a view onto its channels). */
	channels: string[]
}

export const NATIVE_SURFACES: Record<string, Component<NativePanelProps>> = {
	"scene-portraits": ScenePortraitsPanel as Component<NativePanelProps>,
	// The three session surfaces over stats, states and possessions
	// (docs/stats-and-states.md). Each reads the one resolved session state.
	stats: StatsPanel as Component<NativePanelProps>,
	inventory: InventoryPanel as Component<NativePanelProps>,
	"world-state": WorldStatePanel as Component<NativePanelProps>,
	// Temporary test artifacts (plan 21) — demonstrate the framework end to end.
	"sample-map": MapPanel as Component<NativePanelProps>,
	"sample-notes": NotesPanel as Component<NativePanelProps>
}

export function nativeSurface(
	key: string
): Component<NativePanelProps> | undefined {
	return NATIVE_SURFACES[key]
}
