import {
	connectionsList,
	connection,
	updateConnection,
	deleteConnection,
	setUserActiveConnection,
	testConnection,
	refreshModels,
	createConnection
} from "./connections"
import {
	sampling,
	samplingConfigsList,
	setUserActiveSamplingConfig,
	createSamplingConfig,
	deleteSamplingConfig,
	updateSamplingConfig
} from "./samplingConfigs"
import {
	characterList,
	character,
	createCharacter,
	updateCharacter,
	deleteCharacter,
	characterCardImport
} from "./characters"
import {
	personaList,
	persona,
	createPersona,
	updatePersona,
	deletePersona
} from "./personas"
import {
	contextConfigsList,
	contextConfig,
	createContextConfig,
	updateContextConfig,
	deleteContextConfig,
	setUserActiveContextConfig
} from "./contextConfigs"
import {
	chat,
	chatsList,
	createChat,
	deleteChatMessage,
	sendPersonaMessage,
	updateChatMessage,
	deleteChat,
	regenerateChatMessage,
	promptTokenCount,
	abortChatMessage,
	triggerGenerateMessage,
	chatMessage,
	updateChat,
	chatMessageSwipeRight,
	chatMessageSwipeLeft,
	toggleChatCharacterActive
} from "./chats"
import {
	promptConfigsList,
	promptConfig,
	createPromptConfig,
	updatePromptConfig,
	deletePromptConfig,
	setUserActivePromptConfig
} from "./promptConfigs"
import { user } from "./users"
import {
	createLorebook,
	createLorebookBinding,
	createWorldLoreEntry,
	deleteWorldLoreEntry,
	lorebook,
	lorebookBindingList,
	lorebookList,
	updateLorebookBinding,
	updateWorldLoreEntry,
	worldLoreEntryList,
	updateWorldLoreEntryPositions,
	deleteLorebook,
	characterLoreEntryList,
	createCharacterLoreEntry,
	deleteCharacterLoreEntry,
	updateCharacterLoreEntry,
	updateCharacterLoreEntryPositions,
	historyEntryList,
	createHistoryEntry,
	deleteHistoryEntry,
	updateHistoryEntry,
	iterateNextHistoryEntry,
	lorebookImport
} from "./lorebooks"
import { updateOllamaManagerEnabled, systemSettings } from "./systemSettings"
import {
	ollamaConnectModel,
	ollamaSearchAvailableModels,
	ollamaSetBaseUrl,
	ollamaModelsList,
	ollamaDeleteModel,
	ollamaListRunningModels,
	ollamaPullModel,
	ollamaVersion,
	ollamaIsUpdateAvailable,
	ollamaCancelPull,
	ollamaGetDownloadProgress,
	ollamaClearDownloadHistory
} from "./ollama"

const userId = 1 // Replace with actual user id

export function connectSockets(io: {
	on: (arg0: string, arg1: (socket: any) => void) => void
	to: (room: string) => any
}) {
	io.on("connect", (socket) => {
		// Attach io to socket for use in handlers
		socket.io = io
		socket.join("user_" + userId)

		// Helper to emit to all user_1 sockets
		function emitToUser(event: string, data: any) {
			io.to("user_" + userId).emit(event, data)
		}

		// Users
		register(socket, user, emitToUser)

		// SamplingConfig
		register(socket, sampling, emitToUser)
		register(socket, samplingConfigsList, emitToUser)
		register(socket, setUserActiveSamplingConfig, emitToUser)
		register(socket, createSamplingConfig, emitToUser)
		register(socket, deleteSamplingConfig, emitToUser)
		register(socket, updateSamplingConfig, emitToUser)

		// Connections
		register(socket, connectionsList, emitToUser)
		register(socket, connection, emitToUser)
		register(socket, createConnection, emitToUser)
		register(socket, updateConnection, emitToUser)
		register(socket, deleteConnection, emitToUser)
		register(socket, setUserActiveConnection, emitToUser)
		register(socket, testConnection, emitToUser)
		register(socket, refreshModels, emitToUser)

		// Ollama Manager
		register(socket, ollamaConnectModel, emitToUser)
		register(socket, ollamaSearchAvailableModels, emitToUser)
		register(socket, ollamaSetBaseUrl, emitToUser)
		register(socket, ollamaModelsList, emitToUser)
		register(socket, ollamaDeleteModel, emitToUser)
		register(socket, ollamaListRunningModels, emitToUser)
		register(socket, ollamaPullModel, emitToUser)
		register(socket, ollamaCancelPull, emitToUser)
		register(socket, ollamaVersion, emitToUser)
		register(socket, ollamaIsUpdateAvailable, emitToUser)
		register(socket, ollamaGetDownloadProgress, emitToUser)
		register(socket, ollamaClearDownloadHistory, emitToUser)

		// App Settings
		register(socket, systemSettings, emitToUser)
		register(socket, updateOllamaManagerEnabled, emitToUser)

		// Characters
		register(socket, characterList, emitToUser)
		register(socket, character, emitToUser)
		register(socket, createCharacter, emitToUser)
		register(socket, updateCharacter, emitToUser)
		register(socket, deleteCharacter, emitToUser)

		// Personas
		register(socket, personaList, emitToUser)
		register(socket, persona, emitToUser)
		register(socket, createPersona, emitToUser)
		register(socket, updatePersona, emitToUser)
		register(socket, deletePersona, emitToUser)

		// Context Configs
		register(socket, contextConfigsList, emitToUser)
		register(socket, contextConfig, emitToUser)
		register(socket, createContextConfig, emitToUser)
		register(socket, updateContextConfig, emitToUser)
		register(socket, deleteContextConfig, emitToUser)
		register(socket, setUserActiveContextConfig, emitToUser)

		// Prompt Configs
		register(socket, promptConfigsList, emitToUser)
		register(socket, promptConfig, emitToUser)
		register(socket, createPromptConfig, emitToUser)
		register(socket, updatePromptConfig, emitToUser)
		register(socket, deletePromptConfig, emitToUser)
		register(socket, setUserActivePromptConfig, emitToUser)

		// Chats
		register(socket, chatsList, emitToUser)
		register(socket, createChat, emitToUser)
		register(socket, chat, emitToUser)
		register(socket, sendPersonaMessage, emitToUser)
		register(socket, characterCardImport, emitToUser)
		register(socket, deleteChatMessage, emitToUser)
		register(socket, updateChatMessage, emitToUser)
		register(socket, deleteChat, emitToUser)
		register(socket, regenerateChatMessage, emitToUser)
		register(socket, promptTokenCount, emitToUser)
		register(socket, abortChatMessage, emitToUser)
		register(socket, triggerGenerateMessage, emitToUser)
		register(socket, chatMessage, emitToUser)
		register(socket, updateChat, emitToUser)
		register(socket, chatMessageSwipeRight, emitToUser)
		register(socket, chatMessageSwipeLeft, emitToUser)
		register(socket, toggleChatCharacterActive, emitToUser)

		// Lorebooks
		register(socket, lorebookList, emitToUser)
		register(socket, lorebook, emitToUser)
		register(socket, createLorebook, emitToUser)
		register(socket, deleteLorebook, emitToUser),
			register(socket, lorebookBindingList, emitToUser)
		register(socket, createLorebookBinding, emitToUser)
		register(socket, updateLorebookBinding, emitToUser)
		register(socket, worldLoreEntryList, emitToUser)
		register(socket, createWorldLoreEntry, emitToUser)
		register(socket, updateWorldLoreEntry, emitToUser)
		register(socket, deleteWorldLoreEntry, emitToUser)
		register(socket, updateWorldLoreEntryPositions, emitToUser)
		register(socket, characterLoreEntryList, emitToUser)
		register(socket, createCharacterLoreEntry, emitToUser)
		register(socket, updateCharacterLoreEntry, emitToUser)
		register(socket, deleteCharacterLoreEntry, emitToUser)
		register(socket, updateCharacterLoreEntryPositions, emitToUser)
		register(socket, historyEntryList, emitToUser)
		register(socket, createHistoryEntry, emitToUser)
		register(socket, updateHistoryEntry, emitToUser)
		register(socket, deleteHistoryEntry, emitToUser)
		register(socket, iterateNextHistoryEntry, emitToUser)
		register(socket, lorebookImport, emitToUser)
		console.log(`Socket connected: ${socket.id} for user ${userId}`)
	})
}

function register(
	socket: any,
	event: (
		socket: any,
		message: any,
		emitToUser: (event: string, data: any) => void
	) => Promise<void>,
	emitToUser: (event: string, data: any) => void
) {
	socket.on(event.name, async (message: any) => {
		try {
			await event(socket, message, emitToUser)
		} catch (error) {
			console.error(`Error handling event ${event.name}:`, error)
			socket.io.to("user_" + userId).emit(`${event.name}Error`, {
				error: "An error occurred while processing your request."
			})
		}
	})
}
