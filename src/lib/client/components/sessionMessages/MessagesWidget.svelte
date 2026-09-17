<script lang="ts" module>
	import type { MessageOrder } from "./messageOrder"

	/** How the composer's field is drawn. */
	export type ComposerSkin = "classic" | "minimal" | "writer"

	/** Which end of the widget the composer sits at. */
	export type ComposerPosition = "bottom" | "top"

	/**
	 * The `messages` widget's settings, complete: every value the widget reads,
	 * with the declared default wherever the instance has no deviation. The
	 * page receives this object too (as the snippet parameter and through
	 * `onSettings`), so the log, the composer and the page's scroll handling
	 * all answer to one reading of the settings.
	 */
	export interface ConversationSettings {
		order: MessageOrder
		composerSkin: ComposerSkin
		composerPosition: ComposerPosition
		showMessages: boolean
		showComposer: boolean
		showAvatars: boolean
		showTimestamps: boolean
		showSceneMarkers: boolean
		showNudge: boolean
		showActions: boolean
	}

	/**
	 * The declared defaults (`CORE_WIDGETS`, the `messages` entry), restated as
	 * the fallback for a mount with no `WidgetHost` above it — a standalone
	 * render, a test — where there is no `settings.v1` to read.
	 */
	export const CONVERSATION_DEFAULTS: ConversationSettings = {
		order: "oldest-first",
		composerSkin: "classic",
		composerPosition: "bottom",
		showMessages: true,
		showComposer: true,
		showAvatars: true,
		showTimestamps: true,
		showSceneMarkers: true,
		showNudge: true,
		showActions: true
	}

	function pickEnum<T extends string>(
		raw: unknown,
		of: readonly T[],
		fallback: T
	): T {
		return typeof raw === "string" &&
			(of as readonly string[]).includes(raw)
			? (raw as T)
			: fallback
	}

	function pickBool(raw: unknown, fallback: boolean): boolean {
		return typeof raw === "boolean" ? raw : fallback
	}

	/** Read one settings payload into the complete object above. */
	export function readConversationSettings(
		raw: Record<string, unknown> | undefined
	): ConversationSettings {
		const v = raw ?? {}
		const d = CONVERSATION_DEFAULTS
		return {
			order: pickEnum(v.order, ["oldest-first", "newest-first"], d.order),
			composerSkin: pickEnum(
				v.composer,
				["classic", "minimal", "writer"],
				d.composerSkin
			),
			composerPosition: pickEnum(
				v.composerPosition,
				["bottom", "top"],
				d.composerPosition
			),
			showMessages: pickBool(v.showMessages, d.showMessages),
			showComposer: pickBool(v.showComposer, d.showComposer),
			showAvatars: pickBool(v.showAvatars, d.showAvatars),
			showTimestamps: pickBool(v.showTimestamps, d.showTimestamps),
			showSceneMarkers: pickBool(v.showSceneMarkers, d.showSceneMarkers),
			showNudge: pickBool(v.showNudge, d.showNudge),
			showActions: pickBool(v.showActions, d.showActions)
		}
	}
</script>

<script lang="ts">
	/**
	 * The native surface of the `messages` widget: the log you read and the
	 * field you write into, as ONE widget.
	 *
	 * It owns the arrangement and nothing else. The page passes the log, the
	 * composer, the ready-to-continue line and the banners as snippets; this
	 * component reads the widget's settings off `useWidgetContext()`, hands
	 * them back to those snippets, writes them onto the root as data
	 * attributes, and decides which end the composer sits at.
	 */
	import { getContext, type Snippet } from "svelte"
	import { useWidgetContext } from "$lib/shared/widgets/context"

	interface Props {
		/** The message log (`SessionContainer`), given the live settings. */
		log: Snippet<[ConversationSettings]>
		/** The field you write into, given the same settings. */
		composer: Snippet<[ConversationSettings]>
		/** The line naming who is due next, beside the composer. */
		nudge?: Snippet
		/** Status strips that belong beside the composer, above it. */
		banners?: Snippet
		/**
		 * Called with the effective settings whenever they change, for the
		 * page's imperative half — the scroll handling, which runs outside the
		 * render and cannot read a snippet parameter.
		 */
		onSettings?: (settings: ConversationSettings) => void
	}

	let { log, composer, nudge, banners, onSettings }: Props = $props()

	const ctx = useWidgetContext()
	const userSettingsCtx: UserSettingsCtx | undefined =
		getContext("userSettingsCtx")

	let settings = $derived(
		readConversationSettings(
			ctx?.current.settings.v1 as Record<string, unknown> | undefined
		)
	)

	/**
	 * A backdrop image is the user's, not the session's: when one is painted
	 * behind the shell, the conversation gets a glass panel so the text keeps
	 * its contrast against whatever the picture is doing underneath.
	 */
	let hasBackdrop = $derived(!!userSettingsCtx?.settings?.backgroundImagePath)

	// Compared by value, the way `WidgetHost` compares its layout: the widget
	// context re-projects on every message that lands, and the settings on it
	// are the same object nearly every time.
	let lastSettingsKey: string | null = null
	$effect(() => {
		const next = settings
		const key = JSON.stringify(next)
		if (key === lastSettingsKey) return
		lastSettingsKey = key
		onSettings?.(next)
	})
</script>

<div
	class="sp-conversation"
	data-order={settings.order}
	data-composer-position={settings.composerPosition}
	data-composer-skin={settings.composerSkin}
	data-show-messages={settings.showMessages}
	data-show-avatars={settings.showAvatars}
	data-show-timestamps={settings.showTimestamps}
	data-show-scene-markers={settings.showSceneMarkers}
	data-backdrop={hasBackdrop ? "" : undefined}
>
	<div class="sp-column">
		<!-- DOM order is log then composer whichever end the composer is drawn
		     at: the reading order a screen reader and the tab sequence follow is
		     the conversation's, and `order` moves the box on screen. -->
		{#if settings.showMessages}
			<div class="sp-log">{@render log(settings)}</div>
		{/if}
		{#if settings.showComposer}
			<div class="sp-compose">
				{@render banners?.()}
				{#if settings.showNudge && nudge}
					<div class="sp-nudge">
						{@render nudge()}
					</div>
				{/if}
				<div class="sp-field">{@render composer(settings)}</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* The widget's box: one column, the log taking what is left of it. */
	.sp-conversation {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
		block-size: 100%;
		/* The glass panel's colours, light first and paired below — a message
		   sits on the page's ground, and the panel is one step off it. */
		--sp-glass-bg: color-mix(
			in oklab,
			var(--color-surface-50) 78%,
			transparent
		);
		--sp-glass-bd: color-mix(
			in oklab,
			var(--color-surface-300) 70%,
			transparent
		);
	}
	:global([data-mode="dark"]) .sp-conversation {
		--sp-glass-bg: color-mix(
			in oklab,
			var(--color-surface-950) 78%,
			transparent
		);
		--sp-glass-bd: color-mix(
			in oklab,
			var(--color-surface-800) 70%,
			transparent
		);
	}

	/* The measure: about 640px of prose plus the gutter the avatar column
	   needs, centred in however wide the widget's box is (STYLE-GUIDE 3.4). A
	   widget style can move it by setting `--sp-measure`. */
	.sp-column {
		display: flex;
		flex-direction: column;
		inline-size: 100%;
		max-inline-size: calc(var(--sp-measure, 40rem) + 3.5rem);
		margin-inline: auto;
		min-inline-size: 0;
		min-block-size: 0;
		flex: 1;
	}

	/* The log grows; the composer is as tall as it needs to be. `overflow`
	   stays visible so the composer's panes grow their box instead of being
	   clipped — the scroll region is the log's own, inside it. */
	.sp-log {
		flex: 1;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
	}
	.sp-log > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
	.sp-compose {
		flex: 0 0 auto;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
	}
	.sp-nudge {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* With the log hidden the widget is its composer, and the field keeps the
	   end of the box it was drawn at. */
	.sp-conversation[data-show-messages="false"][data-composer-position="bottom"]
		.sp-column {
		justify-content: flex-end;
	}

	/* Composer at the top: the field moves above the banners and the nudge,
	   and the whole compose block above the log, so the two strips stay
	   between the field and the conversation at either end. */
	.sp-conversation[data-composer-position="top"] .sp-compose {
		order: -1;
	}
	.sp-conversation[data-composer-position="top"] .sp-field {
		order: -1;
	}

	/* The glass panel, painted only where a backdrop image is behind it. */
	.sp-conversation[data-backdrop] .sp-column {
		background: var(--sp-glass-bg);
		backdrop-filter: blur(14px);
		border: 1px solid var(--sp-glass-bd);
		border-radius: 14px;
		padding: 8px 24px 16px;
		margin-block: 8px 16px;
	}

	/* Avatars off: the cell goes, and the custom properties a style sizes its
	   avatar column with go to zero so the gutter does not stand empty. */
	.sp-conversation[data-show-avatars="false"] :global(.sp-msg-avatar) {
		display: none;
	}
	.sp-conversation[data-show-avatars="false"] :global(.sp-msg) {
		--sp-av: 0;
		--sp-portrait: 0;
	}
</style>
