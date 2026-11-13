<script lang="ts">
	import { getContext } from "svelte"
	import {
		CAST_LINE_NOTE,
		castBannerWords,
		retoldFieldList,
		type CastBannerMember
	} from "./castBannerWords"
	import { openCastMember } from "./openCastMember"
	import CardUpdateOffer from "$lib/client/lorebooks/cast/CardUpdateOffer.svelte"

	/**
	 * The cast line (polish parity L5; it was a banner card over the form): one
	 * muted line under a card's name, each lorebook's name opening that member.
	 * How many members, which retell parts of the card, and what a card is ride
	 * its title. Absent outside the shell, the names are plain text. Worn by the
	 * card editor and the card's profile.
	 */
	let {
		members,
		onChanged
	}: {
		members: CastBannerMember[]
		/** A member was moved to the card's current version: ask the cast line again. */
		onChanged?: () => void
	} = $props()

	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")
	const castBanner = $derived(castBannerWords(members))
</script>

{#if castBanner}
	<p
		class="text-surface-600-400 text-xs"
		title="{castBanner.represents}{castBanner.retells
			? ` ${castBanner.retells}`
			: ''} {CAST_LINE_NOTE}"
		data-cast-line
	>
		{castBanner.lead}
		{#each members as member, i (member.castId)}
			{@const retold = retoldFieldList(member.retold)}
			{#if i > 0},{" "}{/if}{#if panelsCtx}<button
					type="button"
					class="text-primary-ink underline-offset-2 hover:underline"
					aria-label="Open this card's cast member in {member.lorebookName}"
					onclick={() => openCastMember(panelsCtx, member)}
				>
					{member.lorebookName}
				</button>{:else}<span>
					{member.lorebookName}
				</span>{/if}{#if retold}{" "}(retells {retold}){/if}
		{/each}
	</p>
	{#each members as member (member.castId)}
		{#if member.behindCard && member.cardVersion && member.cardCurrentVersion}
			<CardUpdateOffer
				castId={member.castId}
				lorebookId={member.lorebookId}
				memberName={member.memberName}
				cardVersion={member.cardVersion}
				cardCurrentVersion={member.cardCurrentVersion}
				onUpdated={() => onChanged?.()}
			/>
		{/if}
	{/each}
{/if}
