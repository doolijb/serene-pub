<script lang="ts">
	// Picker shown from EditSessionForm's "Removed" section: lets the caller
	// adopt a removed participant's message history onto a different
	// character/persona they own. Thin wrapper around the existing
	// CharacterSelectModal/PersonaSelectModal pickers rather than a new
	// list UI — the server (sessions:reassignRemovedParticipant) does the real
	// ownership/permission checks; this only collects which entity to
	// reassign to.
	import CharacterSelectModal from "./CharacterSelectModal.svelte"
	import PersonaSelectModal from "./PersonaSelectModal.svelte"

	interface Props {
		open: boolean
		type: "character" | "persona"
		removedName: string
		characters: Partial<SelectCharacter>[]
		personas: Partial<SelectPersona>[]
		onOpenChange: (e: { open: boolean }) => void
		onSelect: (newId: number) => void
	}

	let {
		open = $bindable(),
		type,
		removedName,
		characters,
		personas,
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
		{personas}
		{onOpenChange}
		onSelect={(personaId: number) => onSelect(personaId)}
		title="Reassign to Persona"
		description={`Give a persona ${removedName}'s message history in this session.`}
	/>
{/if}
