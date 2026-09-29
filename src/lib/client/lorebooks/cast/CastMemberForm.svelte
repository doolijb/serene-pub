<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { normalizeSpriteName } from "$lib/shared/sprites"
	import type { CastMember, CastRow } from "../castPool"
	import {
		draftFollowsRow,
		memberDraftOf,
		memberPatch,
		sameMemberDraft,
		type MemberDraft
	} from "./memberDraft"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import {
		CAST_STATES,
		CAST_VISIBILITIES,
		stateBadge,
		visibilityBadge
	} from "./castVocabulary"

	/**
	 * One cast member's page: who they are, and where they stand in the world.
	 *
	 * A background member's name and other names are edited here. A carded
	 * member is NAMED by their card, but their other names are their own
	 * (#114, cast-first): editable here like anyone's, with the card's names
	 * merged in by the server and every name they were known by before the
	 * card was linked kept — changing or unlinking the card never takes those
	 * away.
	 *
	 * ⚠ The form draws the member as they READ at the moment being read, so the
	 * row moves under it. The draft remembers what it was built from
	 * (`pristine`), follows the row while clean, and every save hands both up so
	 * the write is only what the author changed (`memberDraft.ts`).
	 */
	interface Props {
		member: CastMember
		row: CastRow
		hasUnsavedChanges: boolean
		/**
		 * Write the change to the member. Handed the draft's patch and the patch
		 * it was built from; resolves true once the server has it.
		 */
		onSave: (
			patch: Record<string, unknown>,
			pristine: Record<string, unknown>
		) => Promise<boolean>
		/**
		 * File the change as a dated overlay instead. Absent at now, where
		 * there is nothing to choose between.
		 */
		onAmend?: (
			patch: Record<string, unknown>,
			pristine: Record<string, unknown>
		) => Promise<boolean>
		/** The moment being read, spelled for the button. */
		momentLabel?: string | null
		onDelete: () => void
		/**
		 * Pick a card. `"amend"` files it from the moment being read; `"base"`
		 * changes the member outright. At now it is always `"base"`.
		 */
		onLinkCharacter: (how: CardWrite) => void
		onUnlink: (how: CardWrite) => void
	}

	type CardWrite = "amend" | "base"

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

	/** Chips rather than a comma-delimited field: one name, one thing to remove. */
	let draft = $state<MemberDraft>(memberDraftOf({ id: 0 }))
	/** What the draft was built from — the "as built" half of every diff. */
	let pristine = $state<MemberDraft>(memberDraftOf({ id: 0 }))
	let aliasDraft = $state("")
	/** Which member the draft belongs to, so a list arrival never discards it. */
	let draftFor = $state<number | null>(null)
	/** A write of ours is on its way; the save controls stand down. */
	let saving = $state(false)

	let card = $derived(row.character ?? null)

	function seed() {
		draft = memberDraftOf(row)
		pristine = memberDraftOf(row)
	}

	$effect(() => {
		if (draftFor === member.id) return
		draftFor = member.id
		aliasDraft = ""
		seed()
	})

	let dirty = $derived(
		draftFor === member.id &&
			!sameMemberDraft(draft, pristine, member.linked)
	)

	/**
	 * The draft follows the moment (and the line, and every amendment that
	 * lands) while it is clean (#106). Edits in flight are never discarded to
	 * follow a reading; their save is still a diff against `pristine`.
	 */
	$effect(() => {
		if (draftFor !== member.id || saving) return
		if (
			draftFollowsRow({
				draft: $state.snapshot(draft) as MemberDraft,
				pristine: $state.snapshot(pristine) as MemberDraft,
				row,
				linked: member.linked
			})
		)
			seed()
	})

	$effect(() => {
		hasUnsavedChanges = dirty
	})

	/**
	 * Send the form one way or the other, and once it has landed make what
	 * was sent the new "as built" — so typing done while waiting stays dirty,
	 * and a save the row does not reflect (an amendment still wins) lets the
	 * clean form re-read the row.
	 */
	async function submit(
		write: (
			patch: Record<string, unknown>,
			pristine: Record<string, unknown>
		) => Promise<boolean>
	) {
		if (saving) return
		const forId = member.id
		const linked = member.linked
		const sent = $state.snapshot(draft) as MemberDraft
		saving = true
		let ok = false
		try {
			ok = await write(
				memberPatch(sent, linked),
				memberPatch($state.snapshot(pristine) as MemberDraft, linked)
			)
		} finally {
			saving = false
		}
		if (ok && draftFor === forId) pristine = sent
	}

	function save() {
		void submit(onSave)
	}

	function amend() {
		if (onAmend) void submit(onAmend)
	}

	let saveMenuOpen = $state(false)

	/** Read at a moment, a card change is dated from it (#115). */
	let cardDated = $derived(!!onAmend && !!momentLabel)

	let cardMenuItems = $derived([
		member.linked
			? {
					label: "Change the card everywhere",
					icon: Icons.Repeat,
					title: "They read as drawn with the new card on every line and at every moment, before this one too",
					onSelect: () => onLinkCharacter("base")
				}
			: {
					label: "Link a card everywhere",
					icon: Icons.Link,
					title: "They read as drawn with the card on every line and at every moment, before this one too",
					onSelect: () => onLinkCharacter("base")
				},
		member.linked && {
			label: "Unlink the card everywhere",
			icon: Icons.Unlink,
			destructive: true,
			title: "They read as a background character on every line and at every moment",
			onSelect: () => onUnlink("base")
		}
	])

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
	 * stored name as a row of the picker, labelled as missing rather than
	 * showing bare, and choosable again after picking something else —
	 * clearing what the author wrote is the one thing this control must never
	 * do.
	 */
	let missingSet = $derived(
		draft.spriteSet &&
			!spriteSets.some(
				(s) => normalizeSpriteName(s.name) === normalizeSpriteName(draft.spriteSet)
			)
			? draft.spriteSet
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

	/**
	 * Names folded in from members merged into this one (`absorbedAliases`):
	 * the member answers to them, but they are the merge's to keep, not the
	 * alias list's to edit.
	 */
	let absorbedNames = $derived(
		member.aliases.filter((a) => !draft.aliases.includes(a))
	)

	function addAlias() {
		const value = aliasDraft.trim()
		aliasDraft = ""
		if (!value || draft.aliases.includes(value)) return
		draft.aliases = [...draft.aliases, value]
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
				<span class="badge preset-tonal-surface text-[11px] capitalize">
					{member.kind}
				</span>
				{#if member.state !== "active"}
					<span
						class="badge {stateBadge(member.state)
							.color} text-[11px]"
					>
						{member.state}
					</span>
				{/if}
				{#if member.visibility !== "normal"}
					<span
						class="badge {visibilityBadge(
							member.visibility
						)} text-[11px]"
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
				bind:value={draft.name}
			/>
		</div>
	{/if}
	<div class="flex flex-col gap-1">
		<p class="text-sm font-semibold">Also known as</p>
		<div class="flex flex-wrap items-center gap-1">
			{#each draft.aliases as alias (alias)}
				<span class="chip preset-tonal-surface gap-1">
					{alias}
					<button
						type="button"
						class="opacity-70 hover:opacity-100"
						title="Remove {alias}"
						aria-label="Remove {alias}"
						onclick={() =>
							(draft.aliases = draft.aliases.filter(
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
			second row for the same person.{member.linked
				? " They are the member's own: the card's names are added to them, and changing or unlinking the card keeps them."
				: ""}
		</p>
		{#if absorbedNames.length > 0}
			<p class="text-surface-700-300 text-xs">
				Also answers to {absorbedNames.join(", ")}: names kept from
				before a card was linked, or from members merged into this one.
			</p>
		{/if}
	</div>

	<div class="flex flex-col gap-1">
		<label class="text-sm font-semibold" for="castSummary-{member.id}">
			Summary
		</label>
		<textarea
			id="castSummary-{member.id}"
			class="textarea min-h-16 text-sm"
			maxlength="200"
			placeholder="A short line on who this is right now…"
			bind:value={draft.summary}
		></textarea>
		<p class="text-surface-700-300 text-xs">
			Reaches the model only while Visibility is legendary, where it is
			attached to the historical-figures layer of the relationship
			context. At normal visibility it is a note to yourself.
		</p>
		<p class="text-surface-600-400 text-right text-xs">
			{draft.summary.length} / 200
		</p>
	</div>

	<div class="border-border flex flex-col gap-3 border-t pt-3">
		<p class="text-sm font-semibold">Status in world</p>
		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1">
				<Select
					label="State"
					class="text-surface-600-400 min-w-0 text-xs [&_input]:text-sm [&_input]:text-surface-950-50"
					options={CAST_STATES.map((s) => ({ value: s, label: s }))}
					value={draft.nodeState}
					onValueChange={(v) => {
						if (v) draft.nodeState = v
					}}
				/>
			</div>
			<div class="flex flex-col gap-1">
				<Select
					label="Visibility"
					class="text-surface-600-400 min-w-0 text-xs [&_input]:text-sm [&_input]:text-surface-950-50"
					options={CAST_VISIBILITIES.map((v) => ({ value: v, label: v }))}
					value={draft.nodeVisibility}
					onValueChange={(v) => {
						if (v) draft.nodeVisibility = v
					}}
				/>
			</div>
		</div>
		<p class="text-surface-700-300 text-xs">
			State is your own tracking of who is still around. Normal visibility
			surfaces by relevance, legendary always appears as a historical
			figure, and hidden is kept out of other members' relationship
			context.
		</p>
	</div>

	{#if member.linked && (spriteSets.length > 0 || draft.spriteSet)}
		<div class="border-border flex flex-col gap-1 border-t pt-3">
			<!-- ⚠ The missing set stays a row so choosing it again is possible
			     and saving does not silently drop it. The card they resolve to
			     here has no set by this name; another card may. -->
			<Select
				label="Sprite set"
				class="text-sm"
				options={[
					{ value: "", label: "The card's default set" },
					...spriteSets.map((set) => ({
						value: set.name,
						label: `${set.name}${set.isDefault ? " (default)" : ""}`
					})),
					...(missingSet
						? [{ value: missingSet, label: `${missingSet} — not on this card` }]
						: [])
				]}
				bind:value={draft.spriteSet}
			/>
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

	<!-- ⚠ Which card represents them is amendable like any other field
	     (#115): read at a moment, Change and Unlink are DATED from it, and the
	     outright rewrite is in the menu, never the primary (STYLE-GUIDE §6.1). -->
	<div class="border-border flex flex-col gap-2 border-t pt-3" data-cast-card>
		<div class="flex flex-wrap items-center gap-2">
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
					disabled={saving}
					title={cardDated
						? `Draw this member with a different card from ${momentLabel}`
						: "Point this member at a different card"}
					onclick={() => onLinkCharacter(cardDated ? "amend" : "base")}
				>
					<Icons.Repeat size={14} aria-hidden="true" /> Change
				</button>
				<button
					class="btn btn-sm preset-tonal-warning"
					type="button"
					disabled={saving}
					onclick={() => onUnlink(cardDated ? "amend" : "base")}
					title={cardDated
						? `Detach the card from ${momentLabel}; before then they keep it`
						: "Detach the card and keep this member as a background character"}
				>
					<Icons.Unlink size={14} aria-hidden="true" /> Unlink card
				</button>
			{:else}
				<!-- One picker: a persona IS a character, so "link a persona" and
					"link a character" were always the same act. -->
				<p class="min-w-0 flex-1 text-sm font-semibold">Character card</p>
				<button
					class="btn btn-sm preset-tonal-surface"
					type="button"
					disabled={saving}
					title={cardDated
						? `Draw this member with a card from ${momentLabel}`
						: "Draw this member with a character card"}
					onclick={() => onLinkCharacter(cardDated ? "amend" : "base")}
				>
					<Icons.Link size={14} aria-hidden="true" /> Link character
				</button>
			{/if}
			{#if cardDated}
				<RowMenu
					label="Card"
					triggerLabel="Other ways to change the card"
					triggerTitle="Other ways to change the card"
					width={300}
					items={cardMenuItems}
				/>
			{/if}
		</div>
		{#if cardDated}
			<p class="text-surface-700-300 text-xs" data-cast-card-dated>
				{member.linked ? "Change and Unlink" : "Linking"} here
				{member.linked ? "are" : "is"} dated {momentLabel}: before then
				they read as they do now. The menu changes the card everywhere.
			</p>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		{#if onAmend && momentLabel}
			<!-- The same two-action save the entry editor offers, and the same
			     rule: the one that rewrites what was always true is in the
			     menu, never the primary (STYLE-GUIDE §6.1). -->
			<div class="ml-auto flex items-center">
				<button
					class="btn btn-sm preset-filled-primary-500 rounded-r-none"
					type="button"
					disabled={saving || (!member.linked && !draft.name.trim())}
					onclick={amend}
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
						class="btn btn-sm preset-filled-primary-500 rounded-l-none border-l border-white/25 p-2"
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
										disabled={saving ||
											(!member.linked &&
												!draft.name.trim())}
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
				class="btn btn-sm preset-filled-primary-500 ml-auto"
				type="button"
				disabled={saving || (!member.linked && !draft.name.trim())}
				onclick={save}
			>
				<Icons.Save size={14} aria-hidden="true" /> Save
			</button>
		{/if}
	</div>
</div>
