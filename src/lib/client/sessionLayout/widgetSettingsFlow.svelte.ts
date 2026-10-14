/**
 * Per-widget settings and style mode for the session layout (PLAN 25, ruled
 * 2026-09-09 / 2026-09-10), built by its composition root (./SessionLayout).
 *
 * The session layout is the one component that sees every widget on screen:
 * each is a panel instance or a conversation copy, which is a snippet rather
 * than an instance — so this is the one place that can name them all. It
 * pushes their declarations to the store the overlays read, resolves what
 * every mount and label threads (`resolvedWidget`: the title override, the
 * lane, the settings themselves), and turns style mode on and off.
 *
 * Two things cross from here to the overlays, and both go through stores
 * rather than props: an overlay is mounted inside a `WidgetHost`, several
 * layers below anything the layout hands down.
 *
 * Call it during component initialisation: its effects belong to the caller.
 */
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { instanceTitle } from "$lib/client/surfaces/types"
import {
	resolveWidgetStyle,
	setLegacyStylePacks,
	setWidgetStyleMode,
	setWidgetStylePinWriter,
	widgetStylesStore
} from "$lib/client/stores/widgetStyles.svelte"
import {
	setWidgetSettingDecls,
	widgetSettingValues
} from "$lib/client/stores/widgetSettings.svelte"
import {
	resolveWidgetInstance,
	type WidgetSettingsDecl
} from "$lib/shared/widgets/settings"
import { CORE_WIDGETS, type WidgetStyleRef } from "$lib/shared/widgets/types"
import { legacyLayoutAttr } from "$lib/shared/widgets/corePresets"
import {
	isInstanceOf,
	WIDGET_ID_ALIASES,
	widgetOfInstance
} from "@serene-pub/sdk"
import { claimOf } from "./channelClaims"
import { distinctTitles } from "./widgetInstances"
import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"

export interface WidgetSettingsFlowInput {
	readonly manager: SurfaceManager
	/** Read lazily: the model reads this flow's `widgetLabel` too. */
	readonly model: SessionLayoutModel
	readonly conversationDossier: ConversationDossierV1 | null
	/**
	 * This user's per-widget layout settings blob, round-tripped by the page;
	 * the style pins are written into it through `onLayoutSettings`.
	 */
	readonly layoutSettings: Record<string, unknown>
	readonly onLayoutSettings:
		| ((next: Record<string, unknown>) => void)
		| undefined
}

export function createWidgetSettingsFlow(input: WidgetSettingsFlowInput) {
	const inst = (id: string) =>
		input.manager.instances.find((p) => p.id === id)

	function widgetDeclOf(id: string): WidgetSettingsDecl {
		const p = inst(id)
		// A panel instance — a genre's OWN primary included (R71: Battleship's
		// board, and every copy of it, whose title is its declaration's, the
		// copy's `· 2` already on it). Only the conversation is declared by
		// core below.
		if (p && (p.role !== "primary" || !isInstanceOf(id, "messages")))
			return {
				id,
				title: p.title,
				channels: p.channels,
				settings: p.settings
			}
		// A copy (`messages#sanctum`) is declared by its widget; a
		// conversation copy pinned to a channel is titled by the channel's
		// declared label (S1: the panel reads _Sanctum_), any other copy by its
		// widget and its instance name (_Messages · 2_, brief 7b).
		const core = CORE_WIDGETS.find((w) => w.id === widgetOfInstance(id))
		return {
			id,
			title:
				pinnedChannelTitle(id) ??
				instanceTitle(
					core?.title ?? input.model.middleWidgetLabel(id),
					id
				),
			channels: core?.channels,
			settings: core?.settings
		}
	}
	/**
	 * A conversation copy's title when it claims a channel: the channel's
	 * label in the viewer's language (`composer.channelLabels`, off
	 * `ChannelDecl.label`), else its slug title-cased. Read off the stored
	 * settings through the one reader (./channelClaims `claimOf`), not
	 * `resolvedWidget` — that resolves THROUGH this.
	 */
	function pinnedChannelTitle(id: string): string | undefined {
		if (!isInstanceOf(id, "messages")) return undefined
		const slug = claimOf(widgetSettingValues(id))
		if (!slug) return undefined
		return (
			input.conversationDossier?.composer.channelLabels?.[slug] ??
			slug
				.split(/[-_]/)
				.filter(Boolean)
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ")
		)
	}
	function resolvedWidget(id: string) {
		const r = resolveWidgetInstance(
			widgetDeclOf(id),
			widgetSettingValues(id)
		)
		const told = titleApart.get(id)
		return told ? { ...r, title: told } : r
	}
	/**
	 * Placed instances that would read the same — a Duplicate copies the
	 * source's `title`, and a Messages copy's `channel` titles it — told apart
	 * by their instance names (./widgetInstances `distinctTitles`: _Sanctum_,
	 * _Sanctum · 2_). Only the ids whose title changes; `resolvedWidget` and
	 * the panels' own headers (`Panel`'s `title`) read it.
	 */
	let titleApart = $derived.by(() =>
		distinctTitles(
			[...input.model.placedIds].map(
				(id) =>
					[
						id,
						resolveWidgetInstance(
							widgetDeclOf(id),
							widgetSettingValues(id)
						).title
					] as const
			)
		)
	)
	function widgetLabel(id: string): string {
		return resolvedWidget(id).title
	}
	$effect(() => {
		const out: Record<string, WidgetSettingsDecl> = {}
		// ⏳ An aliased declaration (`world-state`) is no schema of its
		// own: a placed one is a copy of Stats, registered below.
		for (const w of CORE_WIDGETS)
			if (
				!input.manager.omitted.has(w.id) &&
				!Object.hasOwn(WIDGET_ID_ALIASES, w.id)
			)
				out[w.id] = {
					id: w.id,
					title: w.title,
					channels: w.channels,
					settings: w.settings
				}
		for (const p of input.manager.instances)
			if (p.role !== "primary")
				out[p.id] = {
					id: p.id,
					title: p.title,
					channels: p.channels,
					settings: p.settings
				}
		// A placed copy of a core widget (S1) has its own settings under its
		// own id, declared by its widget.
		for (const id of input.model.placedIds)
			if (id !== widgetOfInstance(id) && !out[id])
				out[id] = widgetDeclOf(id)
		setWidgetSettingDecls(out)
	})

	/* ── the message style packs ───────────────────────────────────────────
	 * The packs are per-widget STYLES now (ruled 2026-08-30): shipped
	 * `widget_styles` rows the widget's own `WidgetHost` injects, picked from
	 * the widget's own overlay. Two things are left here.
	 *
	 * ONE: the layout blob's old `styles.chat` choice is pushed to the store as
	 * a fallback UNDER the pins, so a session saved before the change still
	 * opens on the look it was saved with. It is derived, never written back —
	 * the first pick from the overlay writes a real pin and this stops
	 * mattering. Cleared on teardown so it cannot leak into the next session.
	 *
	 * TWO: `data-msg-layout` is still written on `.chat-core`, from the RESOLVED
	 * style rather than the blob (`msgLayoutAttr`). TRANSITIONAL, for one
	 * release: nothing in this repo keys off it any more, so it is there for CSS
	 * outside it. Drop it after 0.6. */
	$effect(() => {
		setLegacyStylePacks(input.model.layout.styles ?? null)
		return () => setLegacyStylePacks(null)
	})
	// Called for the subscription — the same contract WidgetHost keeps: it
	// starts the one fetch, and the deriveds below read the same module state,
	// so they re-run when the rows or the pins land.
	widgetStylesStore()
	let msgLayoutAttr = $derived(
		legacyLayoutAttr("messages", resolveWidgetStyle("messages")?.slug)
	)

	/* ── style mode (PLAN 25, ruled 2026-09-09) ─────────────────────────────
	 * Not a panel any more: each widget wears its own hover overlay, mounted by
	 * WidgetHost. All this owns is turning that mode on and persisting the pins.
	 *
	 * `placing` is intentionally not part of the mode: the Move tab draws
	 * gridstack CARDS, not `WidgetHost`s, so an overlay could not appear on
	 * one anyway — but style mode ending is what disarms and drops any
	 * half-typed draft, so it must end when the tab changes. */
	$effect(() => {
		// The phone editor has no hover and no overlays: its rows open the
		// settings modal directly, which needs no mode.
		setWidgetStyleMode(
			input.model.editing && input.model.editTab === "settings"
		)
	})
	$effect(() => {
		// Re-registered whenever the blob or the setter changes, so the write
		// always merges into the CURRENT settings; dropped on teardown so a
		// late write can never land in a page that has gone.
		const settings = input.layoutSettings
		const persist = input.onLayoutSettings
		setWidgetStylePinWriter(
			(widgetStyles: Record<string, WidgetStyleRef>) =>
				persist?.({ ...settings, widgetStyles })
		)
		return () => setWidgetStylePinWriter(null)
	})
	// Reads nothing, so it runs once and its teardown is the unmount: leaving
	// the session with the Style tab open must not leave style mode ON in
	// module state, or the next session's widgets open wearing overlays.
	// Intentionally NOT folded into the effect above — that one re-runs, and a
	// teardown there would drop a half-typed draft every time it did.
	$effect(() => () => setWidgetStyleMode(false))

	/**
	 * The widgets that can wear a `widget_styles` skin: every id placed
	 * ANYWHERE in this layout that is a conversation or is backed by a real
	 * panel instance. The CONTROLS are not built from this list — each widget
	 * grows its own overlay from inside its `WidgetHost` — so what is left for
	 * it is the Style panel's one line of guidance: with nothing here, there is
	 * nothing to hover, and saying so beats an empty panel.
	 */
	let styleableWidgets = $derived.by(() =>
		[...input.model.placedIds]
			.filter(
				(id) =>
					isInstanceOf(id, "messages") ||
					(inst(id)?.role && inst(id)!.role !== "primary")
			)
			.map((id) => ({ id, label: widgetLabel(id) }))
	)

	return {
		resolvedWidget,
		widgetLabel,
		get titleApart() {
			return titleApart
		},
		get msgLayoutAttr() {
			return msgLayoutAttr
		},
		get styleableWidgets() {
			return styleableWidgets
		}
	}
}

export type WidgetSettingsFlow = ReturnType<typeof createWidgetSettingsFlow>
