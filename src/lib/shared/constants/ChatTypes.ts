export class ChatTypes {
	static readonly ROLEPLAY = "roleplay"
	static readonly SUMMARIZE = "summarize"

	static readonly ALL = [ChatTypes.ROLEPLAY] as const

	static readonly LABELS: Record<string, string> = {
		[ChatTypes.ROLEPLAY]: "Roleplay Chat"
	}

	static getLabel(chatType: string): string {
		return ChatTypes.LABELS[chatType] || chatType
	}
}
