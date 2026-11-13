<script lang="ts">
	/**
	 * 🚧 M2d: the **applet card** — one plugin's applet in the Apps view and in
	 * Home's Apps section. A 16:9 **poster** (the picture; without one, a
	 * ground with the app glyph, so a bare applet still lists), an optional
	 * square **logo** over the poster's lower-left, the applet's title, and its
	 * **blurb** with its genre names as the facts. One link: the launcher
	 * (`/apps/<pluginId>`) is an address, so a press navigates there.
	 *
	 * Not a session card (`SessionCardItem`) and not a genre: it carries no
	 * status and no actions. Ground and border are the session card's.
	 */
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import MetaLine from "./panels/MetaLine.svelte"
	import type { AppletCardOrigin } from "$lib/client/shell/leaveDestination"

	interface Props {
		/** The plugin id — the `/apps/<pluginId>` address. */
		pluginId: string
		title: string
		/** A URL: the picture filling the card's 16:9 top. */
		poster?: string
		/** A URL: a small square over the poster's lower-left. */
		logo?: string
		/** One short line saying what the applet is. */
		blurb?: string
		/** Names of the applet's genres, the facts under the blurb. */
		genres: readonly string[]
		/** Where the card is drawn: the launcher's Leave goes back there (★C-1). */
		from: AppletCardOrigin
	}

	let { pluginId, title, poster, logo, blurb, genres, from }: Props = $props()

	/**
	 * A plain left click remembers where it came from in the history state (no
	 * visible URL parameter); any modified or middle click keeps the link's own
	 * behaviour.
	 */
	function onclick(event: MouseEvent) {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		event.preventDefault()
		void goto(`/apps/${pluginId}`, {
			state: { appletFrom: from }
		})
	}

	const uid = $props.id()
	const metaId = `applet-card-meta-${uid}`
</script>

<a
	href="/apps/{pluginId}"
	{onclick}
	class="bg-surface-100-900 panel-edge hover:bg-surface-200-800 focus-visible:outline-primary-500 rounded-container flex h-full flex-col overflow-hidden border focus-visible:outline-2 focus-visible:outline-offset-2"
	aria-label={title}
	aria-describedby={metaId}
	data-applet-card={pluginId}
>
	<span class="bg-surface-200-800 relative block aspect-video w-full">
		{#if poster}
			<img
				src={poster}
				alt=""
				loading="lazy"
				class="absolute inset-0 size-full object-cover"
			/>
		{:else}
			<span
				class="absolute inset-0 grid place-items-center"
				data-applet-card-ground
			>
				<Icons.LayoutGrid
					size={40}
					class="text-surface-600-400"
					aria-hidden="true"
				/>
			</span>
		{/if}
		{#if logo}
			<img
				src={logo}
				alt=""
				loading="lazy"
				class="ring-surface-100-900 absolute bottom-2 left-3 size-10 rounded-lg object-cover ring-2"
				data-applet-card-logo
			/>
		{/if}
	</span>
	<span class="flex min-w-0 flex-1 flex-col gap-1 p-3">
		<span class="text-lead truncate font-medium">{title}</span>
		{#if blurb}
			<MetaLine id={metaId} items={genres} leadLines={2}>
				{blurb}
			</MetaLine>
		{:else}
			<MetaLine id={metaId} items={genres} leadLines={2} />
		{/if}
	</span>
</a>
