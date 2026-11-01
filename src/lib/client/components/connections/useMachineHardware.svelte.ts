/**
 * 🚧 The one place the client asks the pub what computer it runs on.
 *
 * The finder (memory tier) and the KoboldCPP build picker both propose an
 * answer from the same fact. Each asking for itself would be two interest
 * declarations and two copies of the handler; this does it once and both read
 * `.current`. Call it during component init: it declares interest first, then
 * emits on mount, because effects run in creation order and a declaration made
 * after the emit would miss the reply.
 *
 * `undefined` while unanswered; `null` when the server said nothing usable
 * (not an admin, or detection failed). The last answer is kept at module level
 * so a view mounted later starts from it; it still asks again, because the
 * server's answer is cached per boot and cheap.
 */
import { onMount } from "svelte"
import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
import { useInterest } from "$lib/client/sockets/interest.svelte"
import type { MachineHardware } from "$lib/shared/connections/machineHardware"

let lastAnswer: MachineHardware | null | undefined = undefined

export function useMachineHardware(): {
	readonly current: MachineHardware | null | undefined
} {
	const socket = useTypedSocket()
	let current = $state<MachineHardware | null | undefined>(lastAnswer)

	function handle(msg: Sockets.Models.MachineHardware.Response) {
		lastAnswer = msg.error ? null : (msg.hardware ?? null)
		current = lastAnswer
	}

	useInterest<"models:machineHardware">("models:machineHardware", handle)

	onMount(() => {
		socket.emit("models:machineHardware", {})
	})

	return {
		get current() {
			return current
		}
	}
}
