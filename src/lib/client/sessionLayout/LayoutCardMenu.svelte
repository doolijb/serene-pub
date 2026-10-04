<script lang="ts">
	/**
	 * A layout card's `⋯` menu (brief 6b of `PLAN-layout-one-format-2026-09-28`),
	 * drawn by both editors: the desktop Layouts tab under each card, the
	 * phone's layouts sheet at the end of each row. What it offers, and in
	 * what order, is `./startFrom`'s `cardMenu`; this maps each item to its
	 * icon (NOMENCLATURE §22: _set as default_ is `Star`, _duplicate_ `Copy`,
	 * _edit_ `Pencil`, _delete_ `Trash2`; _share_ `Share2` and _stop sharing_
	 * `EyeOff`) and hands the choice back. The app's one action menu,
	 * `RowMenu` (STYLE-GUIDE §6.6), owns the roles, the keys and the focus.
	 */
	import * as Icons from "@lucide/svelte"
	import type { Component } from "svelte"
	import RowMenu, {
		type RowMenuEntries
	} from "$lib/client/components/menus/RowMenu.svelte"
	import {
		cardMenu,
		quoted,
		type CardMenuAction,
		type CardMenuContext
	} from "./startFrom"

	interface Props {
		preset: Sockets.Sessions.LayoutPreset
		context: CardMenuContext
		onAction: (action: CardMenuAction, preset: Sockets.Sessions.LayoutPreset) => void
		/**
	 * The trigger's classes, where the default `⋯` button does not fit. Keep
	 * the targets STYLE-GUIDE §9 asks for: at least 24px, and 44px on a
	 * coarse pointer (`pointer-coarse:`).
	 */
		triggerClass?: string
		/**
		 * Where the menu opens: `bottom-start` under a desktop card (the pane
		 * starts at the rail, so it opens rightwards); `bottom-end` at the end
		 * of a phone row.
		 */
		placement?: "bottom-start" | "bottom-end"
	}

	let {
		preset,
		context,
		onAction,
		triggerClass,
		placement = "bottom-end"
	}: Props = $props()

	const ICONS: Record<CardMenuAction, Component<any>> = {
		"new-session": Icons.Star,
		"stop-new-session": Icons.StarOff,
		copy: Icons.Copy,
		share: Icons.Share2,
		unshare: Icons.EyeOff,
		rename: Icons.Pencil,
		delete: Icons.Trash2
	}

	let items: RowMenuEntries = $derived(
		cardMenu(preset, context).map((e) =>
			e === "separator"
				? { separator: true as const }
				: {
						label: e.label,
						icon: ICONS[e.action],
						destructive: e.action === "delete",
						onSelect: () => onAction(e.action, preset)
					}
		)
	)
</script>

<!-- `contents`: no box of its own, so the row lays the trigger out as
     before. The mark is how an editor finds this card's trigger again, to
     hand focus back to it after an inline rename (the field replaced it). -->
<span class="contents" data-card-menu={preset.id}>
	<RowMenu
		{items}
		label={`Layout ${quoted(preset.name)}`}
		triggerLabel={`Actions for ${quoted(preset.name)}`}
		triggerTitle="More for this layout"
		horizontal
		width={280}
		{placement}
		{triggerClass}
	/>
</span>
