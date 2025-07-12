export interface ContentMatcher<T> {
	matches(content: string, entry: T): boolean
}

export class LorebookMatcher implements ContentMatcher<SelectWorldLoreEntry | SelectCharacterLoreEntry> {
	matches(content: string, entry: SelectWorldLoreEntry | SelectCharacterLoreEntry): boolean {
		const msgContent = entry.caseSensitive ? content : content.toLowerCase()
		return entry.keys.split(',').some(key => {
			const keyToCheck = entry.caseSensitive ? key.trim() : key.toLowerCase().trim()
			if (entry.useRegex) {
				const regex = new RegExp(keyToCheck, 'g')
				return regex.test(msgContent)
			} else {
				return msgContent.includes(keyToCheck)
			}
		})
	}
}

export class HistoryMatcher implements ContentMatcher<SelectHistoryEntry> {
	matches(content: string, entry: SelectHistoryEntry): boolean {
		const msgContent = entry.caseSensitive ? content : content.toLowerCase()
		return entry.keys.split(',').some(key => {
			const keyToCheck = entry.caseSensitive ? key : key.toLowerCase()
			if (entry.useRegex) {
				const regex = new RegExp(keyToCheck, 'g')
				return regex.test(msgContent)
			} else {
				return msgContent.includes(keyToCheck)
			}
		})
	}
}
