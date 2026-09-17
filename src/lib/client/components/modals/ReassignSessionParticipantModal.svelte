<script lang="ts">
	// Picker shown from EditSessionForm's "Removed" section: lets the caller
	// adopt a removed participant's message history onto a different
	// character they own — as a cast member, or as the persona they speak as.
	// Thin wrapper around the existing CharacterSelectModal/PersonaSelectModal
	// pickers rather than a new list UI — the server
	// (sessions:reassignRemovedParticipant) does the real ownership/permission
	// checks; this only collects which entity to reassign to.
	import CharacterSelectModal from "./CharacterSelectModal.svelte"
	import PersonaSelectModal from "./PersonaSelectModal.svelte"

	interface Props {
		open: boolean
		type: "character" | "persona"
		removedName: string
		characters: Partial<SelectCharacter>[]
		/**
		 * Characters already voiced as a persona in this session — hidden from
		 * the persona picker, which reads `characters:list` itself.
		 */
		excludePersonaIds?: number[]
		onOpenChange: (e: { open: boolean }) => void
		onSelect: (newId: number) => void
	}

	let {
		open = $bindable(),
		type,
		removedName,
		characters,
		excludePersonaIds = [],
		onOpenChange,
		onSelect
	}: Props = $props()
</script>

{#if type === "character"}
	<CharacterSelectModal
		{open}
		{characters}
		{onOpenChange}
		onSelect={(c) => onSelect(c.id)}
	/>
{:else}
	<PersonaSelectModal
		{open}
		excludeIds={excludePersonaIds}
		{onOpenChange}
		onSelect={(personaId: number) => onSelect(personaId)}
		title="Reassign to Persona"
		description={`Give a persona ${removedName}'s message history in this session.`}
	/>
{/if}
