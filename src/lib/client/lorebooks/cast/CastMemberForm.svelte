<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { normalizeSpriteName } from "$lib/shared/sprites"
	import type { CastMember, CastRow } from "../castPool"
	import {
		CAST_STATES,
		CAST_VISIBILITIES,
		stateBadge,
		visibilityBadge
	} from "./castVocabulary"

	/**
	 * One cast member's page: who they are, and where they stand in the world.
	 *
	 * A carded member's name and aliases come from the card and are shown, not
	 * edited — the card is the one place they are written. A background member
	 * has no card, so this is where their name lives.
	 */
	interface Props {
		member: CastMember
		row: CastRow
		hasUnsavedChanges: boolean
		onSave: (patch: {
			summary: string | null
			nodeState: string
			nodeVisibility: string
			name?: string
			aliases?: string[]
		}) => void
		/**
		 * File the change as a dated overlay instead. Absent at now, where
		 * there is nothing to choose between.
		 */
		onAmend?: (patch: Record<string, unknown>) => void
		/** The moment being read, spelled for the button. */
		momentLabel?: string | null
		onDelete: () => void
		onLinkCharacter: () => void
		onUnlink: () => void
	}

	let {
		member,
		row,
		hasUnsavedChanges = $bindable(false),
		onSave,
		onAmend,
		momentLabel = null,
		onDelete,
		onLinkCharacter,
		onUnlink
	}: Props = $props()

	let name = $state("")
	/** Chips rather than a comma-delimited field: one name, one thing to remove. */
	let aliasList = $state<string[]>([])
	let aliasDraft = $state("")
	let summary = $state("")
	let nodeState = $state("active")
	let nodeVisibility = $state("normal")
	/** Which of the card's sprite sets they are drawn with. "" = its default. */
	let spriteSet = $state("")
	/** Which member the draft belongs to, so a list arrival never discards it. */
	let draftFor = $state<number | null>(null)

	let card = $derived(row.character ?? null)

	$effect(() => {
		if (draftFor === member.id) return
		draftFor = member.id
		name = row.name ?? ""
		aliasList = [...(row.aliases ?? [])]
		aliasDraft = ""
		summary = row.summary ?? ""
		nodeState = member.state
		nodeVisibility = member.visibility
		spriteSet = row.spriteSet ?? ""
	})

	let dirty = $derived(
		draftFor === member.id &&
			(summary.trim() !== (row.summary ?? "") ||
				nodeState !== member.state ||
				nodeVisibility !== member.visibility ||
				spriteSet !== (row.spriteSet ?? "") ||
				(!member.linked &&
					(name.trim() !== (row.name ?? "") ||
						aliasList.join("\u0000") !==
							(row.aliases ?? []).join("\u0000"))))
	)

	$effect(() => {
		hasUnsavedChanges = dirty
	})

	/** What is on the form, whether it is going to the member or to a date. */
	function patch() {
		return {
			summary: summary.trim() || null,
			nodeState,
			nodeVisibility,
			// ⚠ Empty means "the card's default set", which is NULL on the row —
			// not the empty string, which would be a set nothing is named.
			spriteSet: spriteSet || null,
			...(member.linked
				? {}
				: {
						name: name.trim(),
						aliases: aliasList
					})
		}
	}

	function save() {
		onSave(patch() as any)
	}

	let saveMenuOpen = $state(false)

	/**
	 * The sprite sets of the card this member RESOLVES to, at this moment.
	 *
	 * ⚠ The resolved card, not the base one: which card represents them is
	 * itself amendable, so reading as of a later year can put them on a
	 * different card with a different set of sets. `row` is already resolved;
	 * `member` is not, and using it would offer the wrong card's sets.
	 *
	 * ⚠ **A set this card does not have is kept, never cleared.** The server
	 * falls back to the card's default and records the miss on the receipt, so
	 * a card swap does not silently throw away what the author wrote. That is
	 * why the stored name is offered as its own option when it is missing.
	 */
	const socket = useTypedSocket()
	let spriteSets = $state<{ name: string; isDefault: boolean }[]>([])
	/**
	 * The card whose list has actually ARRIVED.
	 *
	 * ⚠ An empty `spriteSets` is two different facts — "the reply is still in
	 * flight" and "this card has no sets at all" — and the difference decides
	 * whether a stored name is missing or merely unconfirmed. Without this the
	 * zero-set card never offers the stored name below, which is the one way
	 * the picker could silently drop it.
	 */
	let loadedFor = $state<number | null>(null)

	/**
	 * ⚠ A PRIMITIVE, deliberately — the effect below must depend on the card's
	 * id and nothing else. `row` is rebuilt by `resolvedCast` on every
	 * recompute, so an effect that reads `row.characterId` directly re-runs
	 * whenever any unrelated cast state moves, clearing `spriteSets` a moment
	 * after the reply filled it and firing another request. A `$derived`
	 * holding a number only notifies when the number changes.
	 */
	let cardIdForSprites = $derived(row.characterId ?? null)

	$effect(() => {
		const cardId = cardIdForSprites
		spriteSets = []
		loadedFor = null
		if (cardId == null) return
		const release = declareInterest<"characters:listSprites">(
			interestKey("characters:listSprites", cardId),
			(msg) => {
				if (msg.characterId !== cardId) return
				spriteSets = msg.sets.map((s) => ({
					name: s.name,
					isDefault: s.isDefault
				}))
				loadedFor = cardId
			}
		)
		socket.emit("characters:listSprites", { characterId: cardId })
		return release
	})

	/**
	 * The chosen set, when no set of the resolved card carries that name.
	 *
	 * ⚠ Computed WITHOUT waiting for the list, because it is what keeps the
	 * stored name as an `<option>`: a `<select>` bound to a value no option
	 * carries can write the empty string back over it, and clearing what the
	 * author wrote is the one thing this control must never do.
	 */
	let missingSet = $derived(
		spriteSet &&
			!spriteSets.some(
				(s) => normalizeSpriteName(s.name) === normalizeSpriteName(spriteSet)
			)
			? spriteSet
			: null
	)

	/**
	 * Whether to SAY it is missing — only once the card's list has arrived.
	 *
	 * The option above must exist immediately; the warning must not, or every
	 * card swap flashes "not on this card" for the length of a round trip.
	 */
	let missingConfirmed = $derived(
		missingSet != null && loadedFor === cardIdForSprites
	)

	function addAlias() {
		const value = aliasDraft.trim()
		aliasDraft = ""
		if (!value || aliasList.includes(value)) return
		aliasList = [...aliasList, value]
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-start gap-3">
		<div class="shrink-0">
			{#if card}
				<div
					class="ring-offset-surface-50-950 rounded-full ring-2 ring-offset-2 {stateBadge(
						member.state
					).ring}"
				>
					<Avatar char={card as any} />
				</div>
			{:else}
				<div
					class="ring-offset-surface-50-950 bg-surface-200-800 text-surface-500 flex h-[4em] w-[4em] items-center justify-center rounded-full ring-2 ring-offset-2 {stateBadge(
						member.state
					).ring}"
				>
					<Icons.UserRound size={28} aria-hidden="true" />
				</div>
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<h4 class="truncate text-sm font-semibold">{member.name}</h4>
			<p class="text-tertiary-600-400 truncate font-mono text-xs">
				{member.tag}
			</p>
			<div class="mt-1 flex flex-wrap items-center gap-1">
				<span class="badge preset-tonal-surface text-[10px] capitalize">
					{member.kind}
				</span>
				{#if member.state !== "active"}
					<span
						class="badge {stateBadge(member.state)
							.color} text-[10px]"
					>
						{member.state}
					</span>
				{/if}
				{#if member.visibility !== "normal"}
					<span
						class="badge {visibilityBadge(
							member.visibility
						)} text-[10px]"
					>
						{member.visibility}
					</span>
				{/if}
			</div>
		</div>
		<button
			class="btn btn-sm preset-tonal-error shrink-0 p-1.5"
			type="button"
			onclick={onDelete}
			title="Delete cast member"
			aria-label="Delete cast member"
		>
			<Icons.Trash2 size={14} aria-hidden="true" />
		</button>
	</div>

	{#if !member.linked}
		<div class="flex flex-col gap-1">
			<label class="text-sm font-semibold" for="castName-{member.id}">
				Name
			</label>
			<input
				id="castName-{member.id}"
				class="input text-sm"
				type="text"
				bind:value={name}
			/>
		</div>
		<div class="flex flex-col gap-1">
			<p class="text-sm font-semibold">Also known as</p>
			<div class="flex flex-wrap items-center gap-1">
				{#each aliasList as alias (alias)}
					<span class="chip preset-tonal-surface gap-1">
						{alias}
						<button
							type="button"
							class="opacity-70 hover:opacity-100"
							title="Remove {alias}"
							aria-label="Remove {alias}"
							onclick={() =>
								(aliasList = aliasList.filter(
									(a) => a !== alias
								))}
						>
							<Icons.X size={11} aria-hidden="true" />
						</button>
					</span>
				{/each}
				<label class="sr-only" for="castAlias-{member.id}">
					Add another name
				</label>
				<input
					id="castAlias-{member.id}"
					class="input input-sm w-28 text-xs"
					type="text"
					placeholder="Add…"
					bind:value={aliasDraft}
					onblur={addAlias}
					onkeydown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							addAlias()
						}
						if (e.key === "Escape") aliasDraft = ""
					}}
				/>
			</div>
			<p class="text-surface-700-300 text-xs">
				Other names this member is known by, so scene summarization
				recognises them under a nickname or a title instead of adding a
				second row for the same person.
			</p>
		</div>
	{:else if member.aliases.length > 0}
		<div class="flex flex-col gap-1">
			<p class="text-sm font-semibold">Also known as</p>
			<div class="flex flex-wrap gap-1">
				{#each member.aliases as alias (alias)}
					<span class="chip preset-tonal-surface">{alias}</span>
				{/each}
			</div>
			<p class="text-surface-700-300 text-xs">
				Kept in step with the linked character card's own names. Edit
				them there.
			</p>
		</div>
	{/if}

	<div class="flex flex-col gap-1">
		<label class="text-sm font-semibold" for="castSummary-{member.id}">
			Summary
		</label>
		<textarea
			id="castSummary-{member.id}"
			class="textarea min-h-16 text-sm"
			maxlength="200"
			placeholder="A short line on who this is right now…"
			bind:value={summary}
		></textarea>
		<p class="text-surface-700-300 text-xs">
			Reaches the model only while Visibility is legendary, where it is
			attached to the historical-figures layer of the relationship
			context. At normal visibility it is a note to yourself.
		</p>
		<p class="text-surface-400 text-right text-xs">
			{summary.length} / 200
		</p>
	</div>

	<div class="border-border flex flex-col gap-3 border-t pt-3">
		<p class="text-sm font-semibold">Status in world</p>
		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1">
				<label
					class="text-surface-700-300 text-xs font-semibold uppercase"
					for="castState-{member.id}"
				>
					State
				</label>
				<select
					id="castState-{member.id}"
					class="select text-sm"
					bind:value={nodeState}
				>
					{#each CAST_STATES as s (s)}
						<option value={s}>{s}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label
					class="text-surface-700-300 text-xs font-semibold uppercase"
					for="castVisibility-{member.id}"
				>
					Visibility
				</label>
				<select
					id="castVisibility-{member.id}"
					class="select text-sm"
					bind:value={nodeVisibility}
				>
					{#each CAST_VISIBILITIES as v (v)}
						<option value={v}>{v}</option>
					{/each}
				</select>
			</div>
		</div>
		<p class="text-surface-700-300 text-xs">
			State is your own tracking of who is still around. Normal visibility
			surfaces by relevance, legendary always appears as a historical
			figure, and hidden is kept out of other members' relationship
			context.
		</p>
	</div>

	{#if member.linked && (spriteSets.length > 0 || spriteSet)}
		<div class="border-border flex flex-col gap-1 border-t pt-3">
			<label class="text-sm font-semibold" for="castSpriteSet-{member.id}">
				Sprite set
			</label>
			<select
				id="castSpriteSet-{member.id}"
				class="select text-sm"
				bind:value={spriteSet}
			>
				<option value="">The card's default set</option>
				{#each spriteSets as set (set.name)}
					<option value={set.name}>
						{set.name}{set.isDefault ? " (default)" : ""}
					</option>
				{/each}
				{#if missingSet}
					<!-- ⚠ Offered so choosing it again is possible and saving
					     does not silently drop it. The card they resolve to
					     here has no set by this name; another card may. -->
					<option value={missingSet}>{missingSet} — not on this card</option>
				{/if}
			</select>
			{#if missingConfirmed}
				<p class="text-warning-700-300 text-xs leading-relaxed">
					The card they are drawn with here has no set called
					<strong>{missingSet}</strong>
					, so they fall back to its default. The name is kept: a card
					swap does not throw away what you wrote, and another card may
					have it.
				</p>
			{:else}
				<p class="text-surface-700-300 text-xs leading-relaxed">
					Which of the card's sets this member is drawn with. Sets belong
					to the card; which one they use is theirs, and can be dated like
					anything else on this page.
				</p>
			{/if}
		</div>
	{/if}

	<div class="border-border flex flex-wrap items-center gap-2 border-t pt-3">
		{#if member.linked}
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<p class="text-sm font-semibold">Character card</p>
				<p class="text-surface-600-400 truncate text-xs">
					{member.name}, {member.kind === "persona"
						? "your persona"
						: "character"}
				</p>
			</div>
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				title="Point this member at a different card"
				onclick={onLinkCharacter}
			>
				<Icons.Repeat size={14} aria-hidden="true" /> Change
			</button>
			<button
				class="btn btn-sm preset-tonal-warning"
				type="button"
				onclick={onUnlink}
				title="Detach the card and keep this member as a background character"
			>
				<Icons.Unlink size={14} aria-hidden="true" /> Unlink card
			</button>
		{:else}
			<!-- One picker: a persona IS a character, so "link a persona" and
				"link a character" were always the same act. -->
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				onclick={onLinkCharacter}
			>
				<Icons.Link size={14} aria-hidden="true" /> Link character
			</button>
		{/if}
		{#if onAmend && momentLabel}
			<!-- The same two-action save the entry editor offers, and the same
			     rule: the one that rewrites what was always true is in the
			     menu, never the primary (STYLE-GUIDE §6.1). -->
			<div class="ml-auto flex items-center">
				<button
					class="btn btn-sm preset-filled-success-500 rounded-r-none"
					type="button"
					disabled={!member.linked && !name.trim()}
					onclick={() => onAmend(patch())}
					title="File this change as an amendment dated {momentLabel}"
				>
					<Icons.Save size={14} aria-hidden="true" />
					Save as of {momentLabel}
				</button>
				<Popover
					open={saveMenuOpen}
					onOpenChange={(e) => (saveMenuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn btn-sm preset-filled-success-500 rounded-l-none border-l border-white/25 p-2"
						title="Other ways to save this change"
						aria-label="Other ways to save this change"
					>
						<Icons.ChevronDown size={16} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-100-900 flex w-[min(90vw,320px)] flex-col gap-3 p-4 shadow-xl"
							>
								<div class="flex flex-col gap-1">
									<span class="text-sm font-semibold">
										Save as of {momentLabel}
									</span>
									<p
										class="text-surface-700-300 text-xs leading-relaxed"
									>
										They stay as they are. The change begins
										at {momentLabel} and reads from then on.
									</p>
								</div>
								<hr class="border-surface-300-700" />
								<div class="flex flex-col gap-2">
									<p
										class="text-surface-700-300 text-xs leading-relaxed"
									>
										Or change them outright: they read this
										way <strong>everywhere</strong>
										, on every line and at every moment — including
										before
										{momentLabel}, where it is who they
										always were.
									</p>
									<button
										class="btn btn-sm preset-tonal-warning w-full justify-start"
										type="button"
										disabled={!member.linked &&
											!name.trim()}
										onclick={() => {
											saveMenuOpen = false
											save()
										}}
									>
										<Icons.PenLine
											size={14}
											aria-hidden="true"
										/>
										Change the member
									</button>
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			</div>
		{:else}
			<button
				class="btn btn-sm preset-filled-success-500 ml-auto"
				type="button"
				disabled={!member.linked && !name.trim()}
				onclick={save}
			>
				<Icons.Save size={14} aria-hidden="true" /> Save
			</button>
		{/if}
	</div>
</div>
