<script lang="ts">
	/**
	 * The scene portraits: faces beside the conversation, from one of two
	 * sources (`settings.source`).
	 *
	 * `pinned` is the two images a person pins from the chat's avatar gallery,
	 * stored in the shared `sceneImages` store and cleared from here. It is the
	 * default because pinning is the only thing a Chat session has to show.
	 *
	 * `scene` is the cast itself — every active session character, and the
	 * persona when `settings.persona` asks for it. A genre that docks this
	 * widget means "who is here", and a fresh session has pinned nothing, so a
	 * docked portrait rail on the pinned source is an empty rail on day one.
	 */
	import * as Icons from "@lucide/svelte"
	import { sceneImages } from "$lib/client/stores/sceneImages"
	import { avatarSrc, type HasAvatar } from "$lib/client/utils/media"
	import { useWidgetContext } from "$lib/shared/widgets/context"
	import {
		openSessionState,
		sessionState
	} from "$lib/client/state/sessionState.svelte"
	import StatBars from "./state/StatBars.svelte"

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId, session }: Props = $props()

	/* ── the mini bar row (settings.bars) ──────────────────────────────────
	 * The common case for stats is one row of bars under a face, so it is a
	 * setting here rather than a second widget beside this one. Off unless
	 * asked for, and drawn from the same resolved state the Stats widget reads.
	 */
	const store = sessionState()
	$effect(() => openSessionState(sessionId))
	const widget = useWidgetContext()
	let settings = $derived(
		(widget?.current?.settings?.v1 ?? {}) as {
			source?: string
			persona?: boolean
			bars?: boolean
		}
	)
	let showBars = $derived(settings.bars === true)
	let fromScene = $derived(settings.source === "scene")
	let showPersona = $derived(settings.persona === true)

	/** The state owner a cast member's values are filed under, by character id. */
	function ownerKeyOf(characterId: number): string | null {
		return store.cast.find((o) => o.id === characterId)?.key ?? null
	}

	/**
	 * ⚠ A pinned portrait is a URL, not a cast member: the scene images carry
	 * no identity. So the owner is found by matching the portrait against a
	 * member's avatar, and a portrait pinned from the gallery instead matches
	 * nothing and gets no bars — no bars at all being the only honest answer to
	 * "whose stats are these". The scene source below has the id and uses it.
	 */
	function ownerKeyFor(src: string | null): string | null {
		if (!src) return null
		for (const member of castMembers) {
			if (
				avatarSrc(member.entity, { full: true }) !== src &&
				avatarSrc(member.entity) !== src
			)
				continue
			const key = ownerKeyOf(member.id)
			if (key) return key
		}
		return null
	}

	interface CastMember {
		id: number
		name: string
		entity: HasAvatar
	}

	/** Everyone still in the session — the scene, before the persona. */
	let castMembers = $derived.by((): CastMember[] => {
		const links =
			(
				session as
					| {
							sessionCharacters?: {
								isActive?: boolean | null
								removedAt?: unknown
								character?:
									| (HasAvatar & {
											id?: number
											name?: string
											nickname?: string | null
									  })
									| null
							}[]
					  }
					| undefined
			)?.sessionCharacters ?? []
		const out: CastMember[] = []
		for (const link of links) {
			const character = link.character
			if (!character?.id || !link.isActive || link.removedAt) continue
			out.push({
				id: character.id,
				name: character.nickname || character.name || "",
				entity: character
			})
		}
		return out
	})

	interface ScenePortrait {
		key: string
		name: string
		src: string | undefined
		/** Null for the persona, which carries no state of its own. */
		ownerKey: string | null
	}

	let scenePortraits = $derived.by((): ScenePortrait[] => {
		const out: ScenePortrait[] = castMembers.map((member) => ({
			key: `character:${member.id}`,
			name: member.name,
			src: avatarSrc(member.entity, { full: true }),
			ownerKey: ownerKeyOf(member.id)
		}))
		if (!showPersona) return out
		const persona = (
			session as
				| {
						sessionPersonas?: {
							persona?:
								| (HasAvatar & {
										id?: number
										name?: string
								  })
								| null
						}[]
				  }
				| undefined
		)?.sessionPersonas?.[0]?.persona
		if (persona?.id)
			out.push({
				key: `persona:${persona.id}`,
				name: persona.name ?? "",
				src: avatarSrc(persona, { full: true }),
				ownerKey: null
			})
		return out
	})

	function clear(side: "left" | "right") {
		sceneImages.update((s) => ({ ...s, [side]: null }))
		// Mirror the page's persistence so a clear survives reload.
		if (sessionId == null) return
		const s = { ...$sceneImages, [side]: null }
		try {
			if (s.left || s.right)
				localStorage.setItem(
					`sceneImages:${sessionId}`,
					JSON.stringify(s)
				)
			else localStorage.removeItem(`sceneImages:${sessionId}`)
		} catch {}
	}

	let hasAny = $derived(!!$sceneImages.left || !!$sceneImages.right)
</script>

<div class="flex h-full flex-col p-2" data-state-widget="scene-portraits">
	{#if fromScene}
		{#if !scenePortraits.length}
			<div class="empty">
				<Icons.Users size={22} />
				<span>
					Nobody is in this scene yet. Add a character to the session
					and they show up here.
				</span>
			</div>
		{:else}
			<div class="scene">
				{#each scenePortraits as member (member.key)}
					<div class="face" data-scene-member={member.key}>
						{#if member.src}
							<img
								src={member.src}
								alt={member.name}
								class="face-img"
							/>
						{:else}
							<div class="face-img face-blank">
								<Icons.UserRound size={20} aria-hidden="true" />
							</div>
						{/if}
						<span class="face-name">{member.name}</span>
						{#if showBars && member.ownerKey}
							<StatBars ownerKey={member.ownerKey} />
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{:else if !hasAny}
		<div class="empty">
			<Icons.Users size={22} />
			<span>
				No scene portraits set. Click a character's avatar in the chat
				to pin one here.
			</span>
		</div>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-2 gap-2">
			{#each ["left", "right"] as const as side}
				{@const src = $sceneImages[side]}
				{@const ownerKey = showBars ? ownerKeyFor(src) : null}
				<div
					class="relative flex min-h-0 flex-col items-center justify-end"
				>
					{#if src}
						<img
							{src}
							alt="{side} scene portrait"
							class="max-h-full min-h-0 w-full object-contain object-bottom drop-shadow-lg"
						/>
						{#if ownerKey}
							<StatBars {ownerKey} />
						{/if}
						<button
							class="btn-icon preset-tonal-surface btn-icon-sm absolute top-1 right-1 opacity-70 hover:opacity-100"
							onclick={() => clear(side)}
							title="Clear {side} portrait"
							aria-label="Clear {side} portrait"
						>
							<Icons.X size={13} />
						</button>
					{:else}
						<div
							class="border-surface-300-700 text-surface-500 flex h-full w-full items-center justify-center rounded-lg border border-dashed text-[11px]"
						>
							Empty
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		height: 100%;
		padding: 0.75rem;
		text-align: center;
		font-size: 0.72rem;
		opacity: 0.7;
	}
	/* Faces wrap and share the width: the same row reads as a strip above the
	   messages and as a column in a narrow rail, with no second layout. */
	.scene {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		min-height: 0;
		overflow: auto;
		align-content: flex-start;
	}
	.face {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		flex: 1 1 4.5rem;
		max-width: 8rem;
		min-width: 0;
		margin: 0;
	}
	.face-img {
		inline-size: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		object-position: top;
		border-radius: 0.5rem;
		background: color-mix(in oklab, currentColor 8%, transparent);
	}
	.face-blank {
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.5;
	}
	.face-name {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.66rem;
		opacity: 0.8;
	}
</style>
