<script lang="ts">
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		char: Partial<SelectCharacter> | Partial<SelectPersona>
		src?: string
		size?: string
	}

	let {
		char = $bindable(),
		src = $bindable(),
		size = "w-[4em] h-[4em]"
	}: Props = $props()

	// Determine if this is a character or persona
	// Characters have specific fields that personas don't have like 'personality', 'scenario', 'firstMessage'
	// Personas have 'isDefault' field that characters don't have
	let isCharacter = $derived(
		char &&
			("personality" in char ||
				"scenario" in char ||
				"firstMessage" in char)
	)
</script>

<Avatar
	src={src ? src : char ? char.avatar || "" : ""}
	{size}
	imageClasses="object-cover"
	name={char
		? "nickname" in char && char.nickname
			? char.nickname
			: char.name!
		: "Unknown"}
>
	{#if isCharacter}
		<Icons.UsersRound size={36} />
	{:else}
		<Icons.UserRound size={36} />
	{/if}
</Avatar>
