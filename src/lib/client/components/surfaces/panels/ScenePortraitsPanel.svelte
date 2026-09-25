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
	import {
		currentSpriteIn,
		currentSpriteOf,
		spriteSrc
	} from "$lib/client/utils/sprites"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
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
			sprites?: boolean
		}
	)
	/**
	 * Faces follow the conversation (DESIGN-sprites §7): each member shows its
	 * CURRENT sprite — the one on the newest line it spoke — instead of its
	 * avatar. On unless the widget's `sprites` setting turns it off; a member
	 * with no sprites shows its avatar either way.
	 */
	let showSprites = $derived(settings.sprites !== false)
	let messages = $derived(
		(widget?.current?.messages?.v1 ?? []) as {
			id: number
			characterId?: number | null
			isHidden?: boolean
			metadata?: unknown
		}[]
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
		entity: HasAvatar & { spriteSets?: any }
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
		/** The character behind a cast portrait; absent for the persona. */
		characterId?: number
		name: string
		src: string | undefined
		/** Null for the persona, which carries no state of its own. */
		ownerKey: string | null
		/** The card's sprite set names — the face menu offers them. */
		setNames?: string[]
		/** The session's override, when there is one. */
		spriteSet?: string | null
	}

	/**
	 * The session's sprite-set overrides (DESIGN-sprites §2.3), kept current
	 * by the session page from `sessions:spriteSetChanged`.
	 */
	let overrides = $derived(
		((session as any)?.spriteSetOverrides ?? {}) as Record<number, string>
	)

	/**
	 * The face menu's sprite-set switch: show a character in another of its sprite sets for
	 * this session only. The server checks the asker may (the session's or the
	 * character's owner) and pushes the change to every member.
	 */
	const socket = useTypedSocket()
	let setMenuFor = $state<string | null>(null)
	function changeSpriteSet(characterId: number, set: string | null) {
		setMenuFor = null
		if (sessionId == null) return
		socket.emit("sessions:setSpriteSet", { sessionId, characterId, set })
	}

	let scenePortraits = $derived.by((): ScenePortrait[] => {
		const out: ScenePortrait[] = castMembers.map((member) => ({
			key: `character:${member.id}`,
			characterId: member.id,
			name: member.name,
			src: showSprites
				? spriteSrc(
						member.entity,
						currentSpriteIn(
							currentSpriteOf(member.id, messages),
							overrides[member.id]
						),
						{ full: true }
					)
				: avatarSrc(member.entity, { full: true }),
			ownerKey: ownerKeyOf(member.id),
			setNames: ((member.entity as any).spriteSets ?? []).map(
				(s: { name: string }) => s.name
			),
			spriteSet: overrides[member.id] ?? null
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
						{#if showSprites && member.characterId !== undefined && (member.setNames?.length ?? 0) > 1}
							<Popover
								open={setMenuFor === member.key}
								onOpenChange={(e) =>
									(setMenuFor = e.open ? member.key : null)}
								positioning={{ placement: "bottom-end" }}
							>
								<Popover.Trigger
									class="face-sprite-set"
									aria-label="Change {member.name}'s sprite set"
								>
									<Icons.Shirt size={12} aria-hidden="true" />
									<span>{member.spriteSet ?? "Sprite set"}</span>
								</Popover.Trigger>
								<Portal>
									<Popover.Positioner class="z-[1000]!">
										<Popover.Content
											class="card bg-primary-200-800 w-[min(90vw,220px)] space-y-3 p-3 shadow-xl"
										>
											<header class="popover-menu-title">
												<Icons.Shirt size={16} aria-hidden="true" />
												<p>Sprite set</p>
											</header>
											<article class="flex flex-col gap-2" role="menu">
												{#each member.setNames ?? [] as setName (setName)}
													<button
														type="button"
														role="menuitemradio"
														aria-checked={member.spriteSet === setName}
														class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
														onclick={() =>
															changeSpriteSet(member.characterId!, setName)}
													>
														<span>{setName}</span>
													</button>
												{/each}
												<button
													type="button"
													role="menuitemradio"
													aria-checked={!member.spriteSet}
													class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
													onclick={() => changeSpriteSet(member.characterId!, null)}
												>
													<span>As the story has it</span>
												</button>
											</article>
											<p class="text-xs opacity-80">
												For this session only. An outfit, an age or a
												form; the lorebook's cast decides it everywhere
												else.
											</p>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						{/if}
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
		position: relative;
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
	/* Over the portrait's top corner, not under the name: a short widget
	   clips everything below the face, and the switch must stay reachable. */
	:global(.face-sprite-set) {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		max-width: calc(100% - 0.5rem);
		font-size: 0.62rem;
		opacity: 0.85;
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
		color: var(--color-surface-50);
		background: color-mix(in oklab, var(--color-surface-950) 70%, transparent);
	}
	/* STYLE-GUIDE §9: a 44px target on a coarse pointer. */
	@media (pointer: coarse) {
		:global(.face-sprite-set) {
			min-height: 44px;
			padding-inline: 0.75rem;
		}
	}
	:global(.face-sprite-set:hover),
	:global(.face-sprite-set:focus-visible) {
		opacity: 1;
	}
	:global(.face-sprite-set span) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
