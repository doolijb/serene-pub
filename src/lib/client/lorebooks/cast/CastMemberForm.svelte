<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
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
		onDelete: () => void
		onLinkCharacter: () => void
		onUnlink: () => void
	}

	let {
		member,
		row,
		hasUnsavedChanges = $bindable(false),
		onSave,
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
	})

	let dirty = $derived(
		draftFor === member.id &&
			(summary.trim() !== (row.summary ?? "") ||
				nodeState !== member.state ||
				nodeVisibility !== member.visibility ||
				(!member.linked &&
					(name.trim() !== (row.name ?? "") ||
						aliasList.join("\u0000") !==
							(row.aliases ?? []).join("\u0000"))))
	)

	$effect(() => {
		hasUnsavedChanges = dirty
	})

	function save() {
		onSave({
			summary: summary.trim() || null,
			nodeState,
			nodeVisibility,
			...(member.linked
				? {}
				: {
						name: name.trim(),
						aliases: aliasList
					})
		})
	}

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
		<button
			class="btn btn-sm preset-filled-success-500 ml-auto"
			type="button"
			disabled={!member.linked && !name.trim()}
			onclick={save}
		>
			<Icons.Save size={14} aria-hidden="true" /> Save
		</button>
	</div>
</div>
