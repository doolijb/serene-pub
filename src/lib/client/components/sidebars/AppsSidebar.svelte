<script lang="ts">
	/**
	 * 🚧 M2d: the **Apps view** — one applet card per plugin whose genres
	 * declare an applet (`AppletCard`). A card opens the applet's launcher
	 * (`/apps/<pluginId>`); there is no detail pane, filter or New menu.
	 *
	 * The shell hands the cards in (Layout asks `sessions:genres` once and
	 * registers this view only while at least one applet is listed): the view
	 * makes no socket call of its own and holds no unsaved work.
	 */
	import type { AppletRow } from "$lib/client/sessions/appletRows"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import AppletCard from "../AppletCard.svelte"
	import PanelSplit from "../panels/PanelSplit.svelte"

	interface Props {
		cards: readonly AppletRow[]
	}

	let { cards }: Props = $props()

	const vm = new ViewModeTracker()
</script>

<div class="flex h-full min-h-0 flex-col" use:vm.observe data-view="apps">
	<!-- No toolbar: with no filter and no New menu it would be empty.
	     `auto-fill` reads the pane's own width, never the viewport. -->
	<PanelSplit mode={vm.mode} listFills fillWidth="reading">
		{#snippet detail()}{/snippet}

		{#snippet list()}
			<ul
				class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
				aria-label="Apps"
			>
				{#each cards as card (card.pluginId)}
					<li>
						<AppletCard
							pluginId={card.pluginId}
							from="apps"
							title={card.title}
							poster={card.poster}
							logo={card.logo}
							blurb={card.blurb}
							genres={card.genres.map((g) => g.name)}
						/>
					</li>
				{/each}
			</ul>
		{/snippet}
	</PanelSplit>
</div>
