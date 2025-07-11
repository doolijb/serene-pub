<script lang="ts">
import { Modal } from "@skeletonlabs/skeleton-svelte"

interface Props {
    open: boolean;
    onOpenChange: (e: { open: boolean }) => void;
    onConfirm: () => void;
    onCancel: () => void;
    name?: string;
    type?: 'character' | 'persona';
}

let {
    open = $bindable(),
    onOpenChange,
    onConfirm,
    onCancel,
    name = '',
    type = 'character',
}: Props = $props();
</script>

<Modal
    {open}
    {onOpenChange}
    contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
    backdropClasses="backdrop-blur-sm"
>
    {#snippet content()}
        <header class="flex justify-between">
            <h2 class="h2">Remove {type === 'persona' ? 'Persona' : 'Character'}?</h2>
        </header>
        <article>
            <p class="opacity-60">
                Are you sure you want to remove {type === 'persona' ? 'this persona' : 'this character'}{name ? ` (${name})` : ''} from the chat?
            </p>
        </article>
        <footer class="flex justify-end gap-4">
            <button class="btn preset-filled-surface-500" onclick={onCancel}>
                Cancel
            </button>
            <button class="btn preset-filled-error-500" onclick={onConfirm}>
                Remove
            </button>
        </footer>
    {/snippet}
</Modal>
