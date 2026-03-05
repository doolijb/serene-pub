<script lang="ts">
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import CharacterSelectModal from "../modals/CharacterSelectModal.svelte"
	import * as skio from "sveltekit-io"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { onMount, onDestroy, tick } from "svelte"

	interface Props {
		lorebookId: number // ID of the lorebook to edit
	}

	let { lorebookId }: Props = $props()

	const socket = skio.get()

	let showLinkPersonaBindingModal = $state(false)
	let showLinkCharacterBindingModal = $state(false)
	let showAddPersonaBindingModal = $state(false)
	let showAddCharacterBindingModal = $state(false)
	let lorebookBindingId: number | null = $state(null)
	let characterList: Sockets.Characters.List.Response["characterList"] =
		$state([])
	let lorebookBindingList: SelectLorebookBinding[] = $state([])
	let personaList: Sockets.Personas.List.Response["personaList"] = $state([])

	let availableBindingCharacters = $derived.by(() => {
		// Filter out the characters that are already bound to this lorebook
		return characterList.filter(
			(c) =>
				!lorebookBindingList.some(
					(b) => b.characterId === c.id && b.lorebookId === lorebookId
				)
		)
	})

	let availableBindingPersonas = $derived.by(() => {
		// Filter out the personas that are already bound to this lorebook
		return personaList.filter(
			(p) =>
				!lorebookBindingList.some(
					(b) => b.personaId === p.id && b.lorebookId === lorebookId
				)
		)
	})

	// Generate next available binding number
	function getNextBindingNumber(): number {
		const existingNumbers = lorebookBindingList
			.map((b) => {
				const match = b.binding.match(/\{\{char:(\d+)\}\}/)
				return match ? parseInt(match[1], 10) : 0
			})
			.filter((n) => n > 0)

		if (existingNumbers.length === 0) return 1
		return Math.max(...existingNumbers) + 1
	}

	function unlinkBinding(id: number) {
		const req: Sockets.Lorebooks.UpdateBinding.Params = {
			lorebookBinding: {
				id,
				personaId: null,
				characterId: null
			}
		}
		socket?.emit("lorebooks:updateBinding", req)
	}

	function onClickLinkCharacterBinding(bindingId: number) {
		lorebookBindingId = bindingId
		showLinkCharacterBindingModal = true
	}

	function onClickLinkPersonaBinding(bindingId: number) {
		lorebookBindingId = bindingId
		showLinkPersonaBindingModal = true
	}

	function onClickAddCharacterBinding() {
		showAddCharacterBindingModal = true
	}

	function onClickAddPersonaBinding() {
		showAddPersonaBindingModal = true
	}

	function handleLinkPersonaBindingSelect(
		persona: Partial<SelectPersona> & { id: number }
	) {
		showLinkPersonaBindingModal = false
		console.log(
			"Linking persona:",
			persona,
			"to binding:",
			lorebookBindingId
		)
		const req: Sockets.Lorebooks.UpdateBinding.Params = {
			lorebookBinding: {
				id: lorebookBindingId ?? 0,
				personaId: persona.id,
				characterId: null
			}
		}
		console.log("Sending update request:", req)
		socket?.emit("lorebooks:updateBinding", req)
		lorebookBindingId = null
	}

	function handleLinkCharacterBindingSelect(
		character: Partial<SelectCharacter> & { id: number }
	) {
		showLinkCharacterBindingModal = false
		const req: Sockets.Lorebooks.UpdateBinding.Params = {
			lorebookBinding: {
				id: lorebookBindingId ?? 0,
				characterId: character.id ?? null,
				personaId: null
			}
		}
		socket?.emit("lorebooks:updateBinding", req)
		lorebookBindingId = null
	}

	function handleAddPersonaBindingSelect(
		persona: Partial<SelectPersona> & { id: number }
	) {
		showAddPersonaBindingModal = false
		const bindingNumber = getNextBindingNumber()
		const req: Sockets.Lorebooks.CreateBinding.Params = {
			lorebookBinding: {
				lorebookId: lorebookId ?? 0,
				personaId: persona.id ?? null,
				characterId: null,
				binding: `{{char:${bindingNumber}}}`
			}
		}
		socket?.emit("lorebooks:createBinding", req)
		lorebookBindingId = null
	}

	function handleAddCharacterBindingSelect(
		character: Partial<SelectCharacter> & { id: number }
	) {
		showAddCharacterBindingModal = false
		const bindingNumber = getNextBindingNumber()
		const req: Sockets.Lorebooks.CreateBinding.Params = {
			lorebookBinding: {
				lorebookId: lorebookId ?? 0,
				characterId: character.id ?? null,
				personaId: null,
				binding: `{{char:${bindingNumber}}}`
			}
		}
		socket?.emit("lorebooks:createBinding", req)
		lorebookBindingId = null
	}

	function getBindingCharacter(binding: SelectLorebookBinding) {
		// First check if the binding already has the character/persona populated from the server
		const bindingWithRelations = binding as SelectLorebookBinding & {
			character?: SelectCharacter | null
			persona?: SelectPersona | null
		}

		if (bindingWithRelations.character) {
			return bindingWithRelations.character
		}
		if (bindingWithRelations.persona) {
			return bindingWithRelations.persona
		}

		// Fallback to looking them up in the lists
		return binding.characterId
			? characterList.find((c) => c.id === binding.characterId)
			: binding.personaId
				? personaList.find((p) => p.id === binding.personaId)
				: null
	}

	onMount(() => {
		if (!socket) return

		socket.on(
			"characters:list",
			(msg: Sockets.Characters.List.Response) => {
				characterList = msg.characterList || []
			}
		)

		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			personaList = msg.personaList || []
		})

		socket.on(
			"lorebooks:bindingList",
			async (msg: Sockets.Lorebooks.BindingList.Response) => {
				console.log("Received lorebooks:bindingList", msg)
				if (msg.lorebookId === lorebookId) {
					lorebookBindingList = msg.lorebookBindingList || []
					console.log(
						"Updated lorebookBindingList",
						lorebookBindingList
					)
				}
				await tick()
			}
		)

		socket.on(
			"lorebooks:createBinding",
			(msg: Sockets.Lorebooks.CreateBinding.Response) => {
				console.log("Received lorebooks:createBinding", msg)
				toaster.success({
					title: "Binding Created",
					description: "Lorebook binding created successfully."
				})
			}
		)

		socket.on(
			"lorebooks:updateBinding",
			(msg: Sockets.Lorebooks.UpdateBinding.Response) => {
				console.log("Received lorebooks:updateBinding", msg)
				toaster.success({
					title: "Binding Updated",
					description: "Lorebook binding updated successfully."
				})
			}
		)

		console.log(
			"Emitting characters:list, personas:list, and lorebooks:bindingList for lorebookId:",
			lorebookId
		)
		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		const bindingReq: Sockets.Lorebooks.BindingList.Params = {
			lorebookId
		}
		socket.emit("lorebooks:bindingList", bindingReq)
	})

	onDestroy(() => {
		if (!socket) return
		socket.off("characters:list")
		socket.off("personas:list")
		socket.off("lorebooks:bindingList")
		socket.off("lorebooks:createBinding")
		socket.off("lorebooks:updateBinding")
	})
</script>

<div>
	<div class="bindings-tab">
		<div class="mb-4 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500 w-full"
				onclick={() => onClickAddCharacterBinding()}
			>
				<Icons.Plus size={16} /> Add Character
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500 w-full"
				onclick={() => onClickAddPersonaBinding()}
			>
				<Icons.Plus size={16} /> Add Persona
			</button>
		</div>
		<div class="relative mb-2 flex w-full flex-wrap gap-3">
			{#key lorebookBindingList.length}
				{#if lorebookBindingList.length === 0}
					<div
						class="text-muted-foreground w-full py-8 text-center text-sm"
					>
						No bindings yet. Add a character or persona binding to
						get started.
					</div>
				{:else}
					{#each lorebookBindingList as binding, i}
						{@render bindingCard(binding)}
					{/each}
				{/if}
			{/key}
		</div>
	</div>
</div>

{#snippet bindingCard(binding: SelectLorebookBinding)}
	{#if binding}
		<!-- Show character card -->
		{@const char = getBindingCharacter(binding)}
		<div
			class="group hover:preset-filled-surface-200-800 relative flex w-full flex-col gap-2 rounded-lg p-3 transition-all"
			class:preset-outlined-surface-300-700={!!char}
			class:preset-outlined-warning-300-700={!char}
		>
			<div class="flex w-full gap-3 overflow-hidden rounded">
				{#if char}
					<div class="binding-avatar">
						<Avatar {char} />
					</div>
					<div class="binding-info">
						<div class="truncate font-semibold select-none">
							{"nickname" in char && char.nickname
								? char.nickname
								: char.name}
						</div>
						<div
							class="text-muted-foreground group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs select-none"
						>
							{"creatorNotes" in char
								? char.creatorNotes
								: char.description}
						</div>
					</div>
				{/if}

				<div class="binding-actions">
					<button
						onclick={() => onClickLinkCharacterBinding(binding.id)}
						class:hidden={binding.personaId || binding.characterId}
						class="btn btn-sm preset-filled-primary-500"
					>
						<Icons.Link size={16} />
						Link Character
					</button>
					<button
						onclick={() => onClickLinkPersonaBinding(binding.id)}
						class:hidden={binding.personaId || binding.characterId}
						class="btn btn-sm preset-filled-primary-500"
					>
						<Icons.Link size={16} />
						Link Persona
					</button>
				</div>
			</div>
			<div>
				<span>
					{binding.characterId ? "Character" : "Persona"} handlebar:
					<span class="text-tertiary-700-300">
						{binding.binding}
					</span>
				</span>
			</div>
			{#if !!char}
				<div
					class="bg-surface-500/75 align absolute top-0 right-0 bottom-0 left-0 flex h-full w-full justify-center opacity-0 hover:opacity-100"
				>
					<button
						onclick={() => unlinkBinding(binding.id)}
						class:disabled={!binding.characterId &&
							!binding.personaId}
						class="btn preset-filled-warning-500 my-auto h-fit"
						title="Unlink Binding"
					>
						<Icons.Link size={16} class="inline" /> Unlink
					</button>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- Link to existing bindings -->

<PersonaSelectModal
	open={showLinkPersonaBindingModal}
	onSelect={handleLinkPersonaBindingSelect}
	onOpenChange={() => (showLinkPersonaBindingModal = false)}
	personas={availableBindingPersonas}
	returnFullPersona={true}
/>
<CharacterSelectModal
	open={showLinkCharacterBindingModal}
	onSelect={handleLinkCharacterBindingSelect}
	onOpenChange={() => (showLinkCharacterBindingModal = false)}
	characters={availableBindingCharacters}
/>

<!-- Modals for adding new bindings -->

<PersonaSelectModal
	open={showAddPersonaBindingModal}
	onSelect={handleAddPersonaBindingSelect}
	onOpenChange={() => (showAddPersonaBindingModal = false)}
	personas={availableBindingPersonas}
	returnFullPersona={true}
/>

<CharacterSelectModal
	open={showAddCharacterBindingModal}
	onSelect={handleAddCharacterBindingSelect}
	onOpenChange={() => (showAddCharacterBindingModal = false)}
	characters={availableBindingCharacters}
/>
