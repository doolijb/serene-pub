/**
 * Which model the instance's chat **capability default** actually runs on, when
 * it runs on Ollama at all.
 *
 * A capability default is an (endpoint, model) PAIR — an endpoint has no model
 * it "means" — so BOTH halves have to be present and both have to match: the
 * pair's endpoint must be the Ollama one it names, and the model name comes
 * from that endpoint's own `connection_models` row. A registration naming only
 * the endpoint is incomplete and labels nothing "in use for chat".
 *
 * Shared by the Installed and Available tabs so the star, the sort and the
 * delete guard are all one claim: this is what a reply would run on. Pure, so
 * it is testable without a socket.
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/** The transform a session's replies are generated under. */
const CHAT_CAPABILITY = "text->text"

export function ollamaChatDefaultModelName(
	connectionsList:
		| Sockets.Connections.List.Response["connectionsList"]
		| undefined,
	capabilityDefaults: Record<string, Sockets.CapabilityDefault> | undefined
): string | null {
	const pair = capabilityDefaults?.[CHAT_CAPABILITY]
	if (!pair?.connectionId || !pair.connectionModelId) return null
	const endpoint = connectionsList?.find((c) => c.id === pair.connectionId)
	if (endpoint?.type !== CONNECTION_TYPE.OLLAMA) return null
	return (
		endpoint.models?.find((m) => m.id === pair.connectionModelId)?.model ??
		null
	)
}
