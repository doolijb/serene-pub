<script lang="ts" module>
	import type { AvatarSize } from "./avatar"

	/** A rounded square's radius at each step — the card's identity shape. */
	const SQUARE_RADIUS: Readonly<Record<AvatarSize, string>> = {
		xs: "rounded-[6px]",
		sm: "rounded-[8px]",
		md: "rounded-[9px]",
		lg: "rounded-[12px]",
		xl: "rounded-[14px]"
	}

	const DIMS: Readonly<Record<AvatarSize, string>> = {
		xs: "size-6 min-w-6 min-h-6",
		sm: "size-8 min-w-8 min-h-8",
		md: "size-10 min-w-10 min-h-10",
		lg: "size-14 min-w-14 min-h-14",
		xl: "size-[72px] min-w-[72px] min-h-[72px]"
	}

	const LETTER: Readonly<Record<AvatarSize, string>> = {
		xs: "text-[10px]",
		sm: "text-xs",
		md: "text-sm",
		lg: "text-lg",
		xl: "text-2xl"
	}

</script>

<script lang="ts">
	import { avatarInitial } from "./avatar"
	import { avatarSrc } from "$lib/client/utils/media"
	import * as Icons from "@lucide/svelte"

	/**
	 * THE avatar: one component for characters, personas, cast members and
	 * every face a session shows (notes 36). It draws the picture cropped from
	 * the top (`object-top`, the thumbnail rule in `$lib/shared/media/frame`),
	 * and when there is none — or it fails to load — a fallback on the
	 * surface ground: the persona or character glyph (the two NOMENCLATURE
	 * fixes to those ideas), or the name's initial for someone with no card.
	 */
	interface Props {
		// Optional: a falsy `char` is the "unknown" case (fallback glyph,
		// "Unknown" alt), so a deleted reference can pass undefined.
		char?: Partial<SelectCharacter> | null
		/** The picture, when the caller has it already (overrides `char`'s). */
		src?: string
		/** A step of the scale; there is no other way to size an avatar. */
		size?: AvatarSize
		/**
		 * `square` (rounded to the step's radius) is an identity: a row, a
		 * card, a hero, a cast list. `round` is a face among faces: a stack,
		 * a message, a header. Default round.
		 */
		shape?: "round" | "square"
		/** The name the fallback letter and the alt text come from, when there
		    is no `char` (a cast member with no card). */
		name?: string
		/** What the empty tile shows: the kind's glyph, or the name's initial. */
		fallback?: "glyph" | "initial"
		/** Force the glyph's kind; otherwise read from `char.isPersona`. */
		kind?: "character" | "persona"
		/** A small persona mark on the corner, for a face shown without its
		    name beside it (a stack, a card). Drawn only for a persona. */
		personaMark?: boolean
		/** The image is decorative: the name is already beside it. */
		decorative?: boolean
		/** Extra classes on the tile, eg. a ring separating stacked faces. */
		class?: string
	}

	let {
		char,
		src,
		size = "md",
		shape = "round",
		name,
		fallback = "glyph",
		kind,
		personaMark = false,
		decorative = false,
		class: className = ""
	}: Props = $props()

	/**
	 * Fixed by the step, with min-w/min-h guards so the tile is never
	 * squashed as a flex child.
	 */
	const dims = $derived(DIMS[size] ?? DIMS.md)

	const radius = $derived(
		shape === "round" ? "rounded-full" : SQUARE_RADIUS[size]
	)

	const displayName = $derived(
		name ??
			(char
				? ((char as any).nickname as string | undefined) ||
					char.name ||
					""
				: "")
	)

	const url = $derived(
		src ? src : char ? avatarSrc(char as any) || undefined : undefined
	)

	/** The one address that failed, so a new picture is tried afresh. */
	let failedUrl: string | undefined = $state(undefined)
	const showImage = $derived(!!url && failedUrl !== url)

	const isPersona = $derived(
		kind ? kind === "persona" : !!char && (char as any).isPersona === true
	)

	const alt = $derived(decorative ? "" : displayName || "Unknown")
</script>

<span
	class="relative inline-block shrink-0 align-middle {dims}"
	data-avatar={size}
	data-avatar-shape={shape}
>
	<span
		class="bg-surface-200-800 text-surface-700-300 grid size-full place-items-center overflow-hidden {radius} {className}"
	>
		{#if showImage}
			<img
				src={url}
				{alt}
				loading="lazy"
				class="size-full object-cover object-top"
				onerror={() => (failedUrl = url)}
				data-avatar-image
			/>
		{:else if fallback === "initial"}
			<span
				class="font-semibold {LETTER[size]}"
				aria-hidden={decorative ? "true" : undefined}
				role={decorative ? undefined : "img"}
				aria-label={decorative ? undefined : alt}
				data-avatar-fallback="initial"
			>
				{avatarInitial(displayName)}
			</span>
		{:else}
			<span
				class="grid size-full place-items-center"
				role={decorative ? undefined : "img"}
				aria-label={decorative ? undefined : alt}
				aria-hidden={decorative ? "true" : undefined}
				data-avatar-fallback="glyph"
			>
				{#if isPersona}
					<Icons.UserRound
						class="h-[55%] w-[55%]"
						aria-hidden="true"
					/>
				{:else}
					<Icons.UsersRound
						class="h-[55%] w-[55%]"
						aria-hidden="true"
					/>
				{/if}
			</span>
		{/if}
	</span>
	{#if personaMark && isPersona}
		<!-- The row's persona glyph (§6.4), moved onto the face where no name
		     sits beside it to carry it. The ring is the ground the face
		     stands on, so it reads as a notch, not a sticker. -->
		<span
			class="bg-surface-100-900 ring-surface-50-950 text-surface-800-200 absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full ring-2"
			title="Persona"
			data-avatar-persona
		>
			<Icons.UserRound class="size-2.5" aria-hidden="true" />
			<span class="sr-only">Persona</span>
		</span>
	{/if}
</span>
