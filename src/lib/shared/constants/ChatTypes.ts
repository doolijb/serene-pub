export class ChatTypes {
	static readonly ROLEPLAY = "roleplay"
	static readonly ASSISTANT = "assistant"
	static readonly SUMMARIZE = "summarize"

	static readonly ALL = [ChatTypes.ROLEPLAY, ChatTypes.ASSISTANT] as const

	static readonly LABELS: Record<string, string> = {
		[ChatTypes.ROLEPLAY]: "Roleplay Chat",
		[ChatTypes.ASSISTANT]: "Assistant Chat"
	}

	static getLabel(chatType: string): string {
		return ChatTypes.LABELS[chatType] || chatType
	}
}
