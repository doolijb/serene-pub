export class SessionTypes {
	static readonly ROLEPLAY = "roleplay"
	static readonly SUMMARIZE = "summarize"

	static readonly ALL = [SessionTypes.ROLEPLAY] as const

	static readonly LABELS: Record<string, string> = {
		[SessionTypes.ROLEPLAY]: "Roleplay Session"
	}

	static getLabel(sessionType: string): string {
		return SessionTypes.LABELS[sessionType] || sessionType
	}
}
