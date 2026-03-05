/**
 * Assistant Function Calling Types
 *
 * These types define the structure for assistant functions that work with
 * ANY text completion model (not just those with native function calling).
 */

export interface AssistantFunction {
	name: string
	description: string
	requiresConfirmation: boolean
	requiresAdmin: boolean
	parameters: {
		type: "object"
		properties: Record<
			string,
			{
				type: string
				description: string
				enum?: string[]
				items?: {
					type: string
					enum?: string[]
				}
			}
		>
		required: string[]
	}
	handler?: AssistantFunctionHandler
}

export interface AssistantFunctionCall {
	id: string
	name: string
	arguments: Record<string, any>
	status: "pending" | "executing" | "completed" | "error"
	result?: any
	error?: string
}

export type AssistantFunctionHandler = (params: {
	userId: number
	chatId: number
	args: Record<string, any>
	socket: any
}) => Promise<{
	success: boolean
	data?: any
	error?: string
}>

export interface AssistantFunctionResult {
	functionCall: {
		name: string
		arguments: Record<string, any>
	}
	result: {
		success: boolean
		data?: any
		error?: string
	}
}
