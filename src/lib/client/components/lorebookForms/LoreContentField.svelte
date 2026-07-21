<script lang="ts">
	import { Editor } from "@tiptap/core"
	import StarterKit from "@tiptap/starter-kit"
	import { onMount } from "svelte"
	import LorebookBindingTag from "../../utils/tiptapLorebookBindingTag"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import Placeholder from "@tiptap/extension-placeholder"
	import LegacyTag from "$lib/client/utils/tiptapLegacyTag"
	import type { EditorView } from "prosemirror-view"

	interface Props {
		content: string
		lorebookBindingList: Sockets.Lorebooks.BindingList.Response["lorebookBindingList"]
	}

	let { content = $bindable(), lorebookBindingList = $bindable() }: Props =
		$props()

	let editor: Editor
	let editorEl: HTMLDivElement
	let isBold = $state(false)
	let canUndo = $state(false)
	let canRedo = $state(false)
	let addBindingOpenState = $state(false)

	function getLabel(tag: string) {
		const binding = lorebookBindingList.find((b) => b.binding == tag)
		return (
			binding?.character?.nickname ||
			binding?.character?.name ||
			binding?.persona?.name ||
			tag
		)
	}

	function getCharType(tag: string): "character" | "persona" | "unknown" {
		const binding = lorebookBindingList.find((b) => b.binding == tag)
		return binding?.characterId
			? "character"
			: binding?.personaId
				? "persona"
				: "unknown"
	}

	function updateToolbarStates() {
		if (!editor) return
		isBold = editor.isActive("bold")
		canUndo = editor.can().undo()
		canRedo = editor.can().redo()
	}

	function getContentWithCharTags(editor: Editor): string {
		if (!editor) return ""
		const doc = editor.state.doc
		let result = ""
		doc.descendants((node) => {
			if (node.type.name === "LorebookBindingTag") {
				// Use the correct {{char:#}} syntax (double braces)
				result += `{{char:${node.attrs.id}}}`
			} else if (node.type.name === "legacyTag") {
				result += node.attrs.original
			} else if (node.isText) {
				result += node.text
			} else if (node.isBlock) {
				result += "\n"
			}
			return true
		})
		return result
	}

	// Helper: parse {{char:N}} and double-brace legacy tags in plain text to Tiptap doc JSON
	function parseCharTagsToTiptapDoc(text: string) {
		const parts = []
		let lastIndex = 0
		// Regex for {{char:N}} and double-brace legacy tags only ({{user}}, {{char}}, {{persona}}, {{character}})
		const regex =
			/\{\{char:(\d+)\}\}|\{\{(user|char|persona|character)\}\}/g
		let match
		while ((match = regex.exec(text)) !== null) {
			if (match.index > lastIndex) {
				parts.push({
					type: "text",
					text: text.slice(lastIndex, match.index)
				})
			}
			if (match[1]) {
				// {{char:N}} - numbered binding syntax
				parts.push({
					type: "LorebookBindingTag",
					attrs: { id: match[1] }
				})
			} else if (match[2]) {
				// {{user}}, {{char}}, etc. - double-brace legacy tag syntax
				parts.push({
					type: "legacyTag",
					attrs: {
						tag: `{{${match[2]}}}`,
						original: `{{${match[2]}}}`
					}
				})
			}
			lastIndex = match.index + match[0].length
		}
		if (lastIndex < text.length) {
			parts.push({ type: "text", text: text.slice(lastIndex) })
		}
		return {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: parts
				}
			]
		}
	}

	function forceRawContentCopy(view: EditorView, arg1: () => string) {
		const listener = (event: ClipboardEvent) => {
			const text = arg1()
			event.clipboardData?.setData("text/plain", text)
			event.preventDefault()
		}
		view.dom.addEventListener("copy", listener)

		// Clean up the event listener when the component is destroyed
		return () => {
			view.dom.removeEventListener("copy", listener)
		}
	}

	onMount(() => {
		editor = new Editor({
			element: editorEl,
			content: parseCharTagsToTiptapDoc(content),
			extensions: [
				StarterKit,
				LorebookBindingTag.configure({ getLabel, getCharType }),
				LegacyTag.configure({})
				// Placeholder.configure({
				//     placeholder: ({ node }) => "A subterranean metropolis carved into the bones of a long-dead titan..."
				// }),
			],
			onUpdate: ({ editor }) => {
				content = getContentWithCharTags(editor)
				updateToolbarStates()
			}
		})
		editor.on("selectionUpdate", updateToolbarStates)
		updateToolbarStates()

		// Ensure copying from tiptap always copies the raw textarea content
		forceRawContentCopy(editor.view, () => content)
	})
</script>

<div class="">
	<div class="tiptap-toolbar mb-1">
		<Popover
			open={addBindingOpenState}
			onOpenChange={(e) => (addBindingOpenState = e.open)}
			positioning={{ placement: "bottom" }}
		>
			<Popover.Trigger
				class="btn btn-sm preset-filled-surface-500"
				title="Insert Character Tag"
				aria-label="Insert Character Tag"
			>
				<Icons.UserPlus size={16} />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner class="z-[1000]!">
					<Popover.Content class="card preset-filled-surface-100-900 shadow-xl p-4">
						<div class="flex flex-col gap-2">
							<div class="mb-2 text-sm font-semibold">
								Insert Character Tag
							</div>
							{#each lorebookBindingList as binding}
								{@const char = binding.character || binding.persona}
								<button
									class="btn"
									class:preset-filled-primary-500={!!binding.characterId}
									class:preset-filled-surface-500={!!binding.personaId}
									class:preset-filled-warning-500={!char}
									onclick={() => {
										editor.commands.insertLorebookBindingTag(
											binding.binding
										)
										addBindingOpenState = false
									}}
									title={char
										? `${("nickname" in char && char.nickname) || char.name}`
										: binding.binding}
								>
									{char
										? ("nickname" in char && char.nickname) || char.name
										: binding.binding}
								</button>
							{/each}
						</div>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
		<button
			class="btn btn-sm preset-filled-surface-500"
			title="Undo"
			onclick={() => editor && editor.chain().focus().undo().run()}
			disabled={!canUndo}
		>
			<Icons.Undo size={16} />
		</button>
		<button
			class="btn btn-sm preset-filled-surface-500"
			title="Redo"
			onclick={() => editor && editor.chain().focus().redo().run()}
			disabled={!canRedo}
		>
			<Icons.Repeat size={16} />
		</button>
	</div>

	<!-- <textarea
		bind:value={content}
		class="textarea textarea-lg w-full"
        placeholder="A subterranean metropolis carved into the bones of a long-dead titan..."
	></textarea> -->

	<div
		bind:this={editorEl}
		class="tiptap-content preset-filled-surface-200-800 rounded-lg"
		placeholder="A subterranean metropolis carved into the bones of a long-dead titan..."
	></div>
</div>

<style lang="postcss">
	@reference "tailwindcss";

	:global {
	}
</style>
