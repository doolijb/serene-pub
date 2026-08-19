/**
 * Sample core contracts — what /contracts would generate.
 *
 * Every entry is a descriptor plus a pinned constructor. Note that the LLM, TTS and
 * image-gen providers are structurally identical: `params` is declared per type, so
 * nothing anywhere switches on modality (17 §1).
 */

import { S } from "@serene-pub/sdk"
import { jinja2, handlebars } from "@serene-pub/sdk"
import {
	describeInput,
	describeQueryType,
	describeTaskType,
	describeProvider,
	describeConsumerTarget,
	pin
} from "@serene-pub/sdk"

// ── Inputs ──────────────────────────────────────────────────────────────────

export const userMessage = pin(
	describeInput({
		id: "core:input/user-message@1",
		ports: { out: { main: S.json, text: S.text, chatScope: S.chatScope } }
	})
)

/**
 * A message that already exists — the trigger carries its id.
 *
 * `messageId` is `row-ids@1` rather than `json` because it *is* a row id, and typing it
 * as one is what makes `updateMessage` wireable at all: the id an update is allowed to
 * take is the id of a row that already exists, which is exactly what an event about an
 * existing message carries (13 §10b).
 */
export const messageCreated = pin(
	describeInput({
		id: "core:input/message-created@1",
		ports: { out: { main: S.json, messageId: S.rowIds } }
	})
)

// ── Queries ─────────────────────────────────────────────────────────────────

export const chatHistory = pin(
	describeQueryType({
		id: "core:query/chat-history@1",
		i18n: { name: { en: "Chat history" } },
		timeoutMs: 2000,
		slots: {
			template: {
				kind: "template",
				engine: jinja2.id,
				facet: "templates"
			},
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					limit: { type: "integer", default: 40 },
					weight: { type: "number", default: 0.4 },
					minInclude: { type: "integer", default: 6 },
					priority: {
						type: "enum",
						of: ["low", "normal", "high", "always"],
						default: "normal"
					}
				}
			}
		},
		ports: {
			in: { scope: S.chatScope, budget: S.budget },
			out: { main: S.candidates, messages: S.candidates }
		}
	})
)

export const lorebookTriggers = pin(
	describeQueryType({
		id: "core:query/lorebook-triggers@1",
		i18n: { name: { en: "Lorebook triggers" } },
		timeoutMs: 2000,
		slots: {
			// A *source* template: it renders one entry, so its scope is the item's shape —
			// which is inside the port's payload, not on the port (16 §4 correction).
			template: {
				kind: "template",
				engine: jinja2.id,
				facet: "templates",
				variables: { entry: ["title", "content", "keys"] }
			},
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					scanDepth: { type: "integer", default: 3 },
					caseSensitive: { type: "boolean", default: false },
					weight: { type: "number", default: 0.35 },
					minInclude: { type: "integer", default: 3 },
					// ST parity items (13 §7i)
					recursionDepth: { type: "integer", default: 0 },
					useRegex: { type: "boolean", default: false }
				}
			}
		},
		ports: {
			in: { text: S.text, scope: S.chatScope },
			out: { main: S.candidates, hits: S.candidates }
		}
	})
)

/** Probability rolls come from the run seed, so they replay (13 §7i). */
export const lorebookProbabilistic = pin(
	describeQueryType({
		id: "core:query/lorebook-probabilistic@1",
		timeoutMs: 2000,
		declaresRandomness: true,
		ports: {
			in: { text: S.text },
			out: { main: S.candidates, hits: S.candidates }
		}
	})
)

export const vectorSearch = pin(
	describeQueryType({
		id: "core:query/vector-search@1",
		timeoutMs: 3000,
		slots: {
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					topK: { type: "integer", default: 12 },
					minScore: { type: "number", default: 0.35 }
				}
			}
		},
		ports: {
			in: {
				/** Several query vectors, one ranked list each. */
				vectors: S.vector,
				scope: S.chatScope
			},
			out: {
				main: S.candidates,
				hits: S.candidates,
				/** One ranked list per query vector, in the order they were given. */
				lists: S.json,
				/**
				 * `cos(i, j)` over `hits`, by index. What MMR needs, without any
				 * embedding leaving the host.
				 */
				similarity: S.json
			}
		}
	})
)

export const personaCard = pin(
	describeQueryType({
		id: "core:query/persona-card@1",
		timeoutMs: 1000,
		ports: {
			in: { characterId: S.json },
			out: { main: S.candidates, card: S.candidates }
		}
	})
)

export const messageText = pin(
	describeQueryType({
		id: "core:query/message-text@1",
		timeoutMs: 1000,
		ports: {
			in: { messageId: S.json },
			out: { main: S.text, plain: S.text }
		}
	})
)

/** Illegal by construction elsewhere; used to prove the purity probe. */
export const network = pin(
	describeQueryType({
		id: "test:query/network@1",
		timeoutMs: 1000,
		ports: { out: { main: S.json } }
	})
)

// ── Tasks ───────────────────────────────────────────────────────────────────

export const contextBudget = pin(
	describeTaskType({
		id: "core:task/context-budget@1",
		timeoutMs: 500,
		slots: {
			params: {
				kind: "parameters",
				schema: {
					reserveForReply: { type: "integer", default: 512 },
					safetyMargin: { type: "number", default: 0.05 }
				}
			}
		},
		ports: { out: { main: S.budget, available: S.budget } }
	})
)

export const mergeCandidates = pin(
	describeTaskType({
		id: "core:task/merge-candidates@1",
		timeoutMs: 500,
		slots: {
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					strategy: {
						type: "enum",
						of: ["auto", "vector", "keyword", "hybrid"],
						default: "auto"
					},
					dedup: { type: "boolean", default: true }
				}
			}
		},
		ports: {
			in: { sources: S.candidates },
			out: { main: S.candidates, candidates: S.candidates }
		}
	})
)

const rankPorts = {
	in: { candidates: S.candidates, budget: S.budget },
	out: {
		main: S.candidates,
		candidates: S.candidates,
		/**
		 * The per-candidate trail: score, included, reason, and the signal
		 * breakdown behind it.
		 *
		 * A declared out-port rather than an implementation detail, because it is
		 * what Assemble allocates from — and because a ranker swapped in by a
		 * plugin has to produce it too, or the budget panel goes blank the moment
		 * anyone changes rankers (16 §5c).
		 */
		decisions: S.json
	}
}

/**
 * Shared by every ranker: the ceiling it is ranking against.
 *
 * The default matters more than it looks. Until the executor applied declared
 * defaults, a spec that did not override this got `undefined` — a budget of
 * zero, every block excluded, and a prompt rendered with its lore silently
 * missing and no error anywhere.
 */
const rankSlots = {
	params: {
		kind: "parameters" as const,
		facet: "weights" as const,
		schema: { budget: { type: "integer" as const, default: 4096 } }
	}
}

export const rankHybrid = pin(
	describeTaskType({
		id: "core:task/rank-hybrid@1",
		timeoutMs: 500,
		slots: rankSlots,
		ports: rankPorts
	})
)
export const rankByRecency = pin(
	describeTaskType({
		id: "core:task/rank-by-recency@1",
		timeoutMs: 500,
		slots: rankSlots,
		ports: rankPorts
	})
)
/**
 * The two retrieval query windows, as text.
 *
 * A Task because *how a message is written when it is a query* is a decision —
 * speaker attribution in brackets, emphasis stripped — and a different
 * embedding model might want a different shape. It is also where the two
 * windows are cut, which is the parameter a user with long posts will reach for
 * first.
 */
export const queryWindows = pin(
	describeTaskType({
		id: "core:task/query-windows@1",
		i18n: { name: { en: "Retrieval queries" } },
		timeoutMs: 500,
		slots: {
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					currentWindow: { type: "integer", default: 2 },
					recentWindow: { type: "integer", default: 3 }
				}
			}
		},
		ports: {
			in: { messages: S.messages, cast: S.chatCast },
			out: { main: S.json, current: S.json, recent: S.json }
		}
	})
)

/**
 * The semantic arm's ranking, as a Task.
 *
 * Nine stages the legacy engine runs inline: fuse the per-query lists, normalise
 * to the top, boost recency and author priority, cut on an adaptive threshold,
 * diversify with MMR, and cap each source. Every constant behind them is a
 * parameter here — one of them carries a `TODO: make configurable` in the
 * original.
 *
 * A Task rather than part of the vector Query because **it is policy**: which of
 * these stages run, and how hard, is exactly what an installation should be able
 * to replace. The Query retrieves and computes similarity; this decides.
 *
 * `similarity` is a port because MMR needs to compare candidates to each other
 * and a Task cannot ask the host for anything (F11). It is a matrix of cosines,
 * not the embeddings — derived, bounded, and not reversible into the vectors.
 */
export const rankSemantic = pin(
	describeTaskType({
		id: "core:task/rank-semantic@1",
		i18n: { name: { en: "Rank semantic results" } },
		timeoutMs: 1000,
		slots: {
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					currentWindow: { type: "integer", default: 2 },
					recentWindow: { type: "integer", default: 3 },
					rrfK: { type: "integer", default: 60 },
					recencyBoost: { type: "number", default: 0.15 },
					recencyDecay: { type: "number", default: 0.01 },
					thresholdMin: { type: "number", default: 0.3 },
					relativeThreshold: { type: "number", default: 0.7 },
					mmrLambda: { type: "number", default: 0.7 }
				}
			}
		},
		ports: {
			in: {
				/**
				 * One entry per query window, each carrying its own per-message
				 * ranked lists and its own similarity matrix. The whole stack
				 * runs per window; the results are concatenated, not fused.
				 */
				windows: S.json,
				messages: S.messages
			},
			out: {
				main: S.candidates,
				candidates: S.candidates,
				diagnostics: S.json
			}
		}
	})
)

/**
 * A plugin's ranker — same kind, same shape, so the swap list offers it (16 §5c).
 *
 * Named `rankRecall`, not `rankSemantic`: binding names derive from the id's
 * name segment and ignore the namespace, so this and `core:task/rank-semantic@1`
 * would both want to be `rankSemantic` and generation would emit one export
 * twice. `checkUnique` now catches that; the id changed here because a plugin
 * naming its ranker after its own product is the better name anyway.
 */
export const rankRecall = pin(
	describeTaskType({
		id: "chariot.recall:rank-recall@1",
		timeoutMs: 500,
		public: true,
		ports: rankPorts
	})
)

export const renderEntries = pin(
	describeTaskType({
		id: "core:task/render-entries@1",
		timeoutMs: 500,
		slots: {
			template: {
				kind: "template",
				engine: jinja2.id,
				facet: "templates"
			}
		},
		ports: {
			in: { entries: S.candidates },
			out: { main: S.renderedBlocks }
		}
	})
)

export const assemble = pin(
	describeTaskType({
		id: "core:task/assemble@2",
		timeoutMs: 1000,
		slots: {
			// An *assembly* template: its scope really is the input ports, so this half of
			// 16 §4's claim holds.
			template: {
				kind: "template",
				// Handlebars, not Jinja: this is the engine Serene Pub's context
				// configs are written in, and the assembly template is the user's
				// existing story string. Declaring the wrong engine would fail
				// parity in a way that reads as a template bug rather than a
				// configuration mistake (12 §2a).
				engine: handlebars.id,
				facet: "templates",
				variables: {
					blocks: "any",
					budget: ["total", "remaining"],
					prompts: ["system", "postHistory"]
				}
			},
			prompts: {
				kind: "prompts",
				facet: "prompts",
				fields: {
					system: { type: "text" },
					postHistory: { type: "text" }
				}
			},
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					budget: { type: "integer", default: 4096 },
					/**
					 * Where the post-history reminder goes, and whether it goes
					 * at all.
					 *
					 * Numbers, so they are parameters rather than prompt text —
					 * a `prompts` slot carries authored strings and typing a
					 * count as one would be the wrong shape wearing a
					 * convenient home. The trigger is a **suppression**: below
					 * it a short chat gets no reminder, because a reinforcement
					 * note two messages after the system prompt is noise.
					 */
					postHistoryDepth: { type: "integer", default: 0 },
					postHistoryTokenTrigger: { type: "integer", default: 0 },
					truncation: {
						type: "enum",
						of: ["oldest-first", "lowest-weight"],
						default: "oldest-first"
					}
				}
			}
		},
		ports: {
			in: {
				candidates: S.candidates,
				budget: S.budget,
				templateContext: S.templateContext
			},
			out: { main: S.assembled, context: S.assembled }
		}
	})
)

/**
 * Builds the object a context template renders against.
 *
 * A Task, not a Query, even though it reads the cast: what it *is* is the
 * resolution — which characters appear, which get named, which scenario wins —
 * and that is a decision anyone should be able to replace. The read reaches the
 * host like any other (F11 keeps the services out of the Task itself).
 *
 * Separate from Assemble on purpose. Assemble allocates a budget and renders;
 * this decides what there is to render. A plugin that wants different character
 * cards should not have to reimplement token allocation to get them.
 */
export const chatCast = pin(
	describeQueryType({
		id: "core:query/chat-cast@1",
		i18n: { name: { en: "Chat cast" } },
		timeoutMs: 2000,
		ports: {
			in: { scope: S.chatScope },
			out: { main: S.chatCast, cast: S.chatCast }
		}
	})
)

export const buildTemplateContext = pin(
	describeTaskType({
		id: "core:task/build-template-context@1",
		i18n: { name: { en: "Build template context" } },
		timeoutMs: 2000,
		/**
		 * The example-dialogue pick. Declaring it is what gets `ctx.random` — the
		 * run-seeded RNG — instead of `Math.random()`, so the same run replayed
		 * chooses the same example and a different turn still gets variety.
		 */
		declaresRandomness: true,
		/**
		 * The authored text. It arrives as config rather than on a port because it
		 * *is* config — the same prompt config the assembly template renders from,
		 * layered instance → user → chat like every other slot.
		 */
		slots: {
			prompts: {
				kind: "prompts",
				facet: "prompts",
				fields: {
					systemPrompt: { type: "text" },
					postHistoryInstructions: { type: "text" },
					// Narrator-only, and load-bearing: it names the seed line in
					// no-perspective mode and resolves `{{narratorName}}` in the
					// config's own text.
					narratorName: { type: "text" }
				}
			}
		},
		ports: {
			in: { cast: S.chatCast },
			out: {
				main: S.templateContext,
				templateContext: S.templateContext,
				/**
				 * The name on the trailing assistant line.
				 *
				 * Its own port rather than a field inside the context, because
				 * nothing renders `{{seedName}}` — it is not a template variable.
				 * It is what the message processor writes on the line the model
				 * continues from, and in narrator mode it is the one name that
				 * must *not* be the joined cast list: seeding "Alice and Cara:"
				 * teaches the model to write joint dialogue instead of narrating.
				 */
				seedName: S.text
			}
		}
	})
)

/**
 * Chat rows into the objects a template renders.
 *
 * A Task rather than part of the history Query, because naming a message —
 * which participant said it, under what name at the time — is a *decision*, and
 * decisions are the things a plugin should be able to replace. The Query returns
 * rows; this says who spoke.
 */
export const processMessages = pin(
	describeTaskType({
		id: "core:task/process-messages@1",
		i18n: { name: { en: "Process messages" } },
		timeoutMs: 1000,
		ports: {
			in: {
				messages: S.messages,
				cast: S.chatCast,
				templateContext: S.templateContext,
				seedName: S.text
			},
			out: { main: S.messages, messages: S.messages }
		}
	})
)

/** Turns provider output back into candidate blocks — the map/reduce join. */
export const toCandidates = pin(
	describeTaskType({
		id: "core:task/to-candidates@1",
		timeoutMs: 500,
		ports: {
			in: { items: S.text },
			out: { main: S.candidates, candidates: S.candidates }
		}
	})
)

/** An author defaulting review ON for their own consumer — and unable to forbid it (F14). */
export const attachImage = pin(
	describeConsumerTarget({
		id: "core:consumer/attach-image@1",
		effects: "write",
		timeoutMs: 5000,
		reviewDefault: "sync",
		causesEvent: "core:event/message-updated@1",
		ports: { in: { image: S.image }, out: { main: S.writeResult } }
	})
)

export const chunkText = pin(
	describeTaskType({
		id: "core:task/chunk-text@1",
		timeoutMs: 1000,
		ports: { in: { text: S.text }, out: { main: S.json, items: S.json } }
	})
)

export const roll = pin(
	describeTaskType({
		id: "chariot.dice-tray:roll@1",
		i18n: { name: { en: "Roll dice" } },
		timeoutMs: 200,
		declaresRandomness: true,
		public: true,
		ports: {
			in: { notation: S.text },
			out: { main: S.json, total: S.json }
		}
	})
)

export const gate = pin(
	describeTaskType({
		id: "test:task/gate@1",
		timeoutMs: 500,
		ports: { in: { main: S.json }, out: { main: S.json } }
	})
)

export const slow = pin(
	describeTaskType({
		id: "test:task/slow@1",
		timeoutMs: 30,
		ports: { in: { main: S.json }, out: { main: S.json } }
	})
)

export const passthrough = pin(
	describeTaskType({
		id: "test:task/passthrough@1",
		timeoutMs: 500,
		toggleable: true,
		ports: { in: { main: S.json }, out: { main: S.json } }
	})
)

export const badToggleable = pin(
	describeTaskType({
		id: "test:task/bad-toggleable@1",
		timeoutMs: 500,
		toggleable: true,
		ports: { in: { main: S.text }, out: { main: S.image } }
	})
)

// ── Providers — identical structure across three modalities (17 §2) ─────────

export const embedText = pin(
	describeProvider({
		id: "core:provider/embed-text@1",
		shape: S.embeddings,
		effects: "external",
		timeoutMs: 5000,
		slots: {
			connection: { kind: "connection", shape: S.embeddings },
			params: {
				kind: "parameters",
				schema: {
					enabled: {
						type: "enum",
						of: ["auto", "on", "off"],
						default: "auto"
					}
				}
			}
		},
		ports: {
			in: {
				text: S.text,
				/** Batched: one call, one vector each, in order. */
				texts: S.json
			},
			out: { main: S.vector, vector: S.vector, vectors: S.json }
		}
	})
)

export const generateText = pin(
	describeProvider({
		id: "core:provider/generate-text@1",
		i18n: { name: { en: "Generate reply" } },
		shape: S.textGen,
		effects: "external",
		timeoutMs: 120000,
		timeoutKind: "idle",
		usage: "response.usage",
		slots: {
			connection: { kind: "connection", shape: S.textGen },
			sampling: { kind: "sampling", shape: S.textGen },
			prompts: {
				kind: "prompts",
				facet: "prompts",
				fields: {
					system: { type: "text" },
					postHistory: { type: "text" }
				}
			},
			template: {
				kind: "template",
				engine: jinja2.id,
				facet: "templates"
			},
			params: {
				kind: "parameters",
				facet: "weights",
				schema: { stopSequences: { type: "string[]" } }
			}
		},
		ports: {
			in: { context: S.assembled },
			out: { main: S.textStream, text: S.textStream }
		}
	})
)

export const speak = pin(
	describeProvider({
		id: "core:provider/speak@1",
		i18n: { name: { en: "Speak" } },
		shape: S.tts,
		effects: "external",
		timeoutMs: 60000,
		slots: {
			connection: { kind: "connection", shape: S.tts },
			sampling: { kind: "sampling", shape: S.tts },
			template: {
				kind: "template",
				engine: jinja2.id,
				facet: "templates"
			},
			params: {
				kind: "parameters",
				facet: "weights",
				schema: { skipCodeBlocks: { type: "boolean", default: true } }
			}
		},
		ports: { in: { text: S.text }, out: { main: S.audio, audio: S.audio } }
	})
)

export const renderImage = pin(
	describeProvider({
		id: "chariot.comfy:render-image@1",
		shape: S.imageGen,
		effects: "external",
		public: true,
		timeoutMs: 300000,
		slots: {
			connection: { kind: "connection", shape: S.imageGen },
			sampling: { kind: "sampling", shape: S.imageGen },
			prompts: {
				kind: "prompts",
				facet: "prompts",
				fields: {
					positive: { type: "text" },
					negative: { type: "text" }
				}
			},
			params: {
				kind: "parameters",
				facet: "weights",
				schema: { steps: { type: "integer", default: 25 } }
			}
		},
		ports: {
			in: { context: S.assembled },
			out: { main: S.image, image: S.image }
		}
	})
)

/** An MCP tool. Effectful by default — annotations never decide gating (F31, 14 §4). */
export const mcpTool = pin(
	describeProvider({
		id: "core:provider/mcp-tool@1",
		shape: S.json,
		effects: "external",
		timeoutMs: 30000,
		slots: { connection: { kind: "connection", shape: S.json } },
		ports: { in: { args: S.json }, out: { main: S.json, result: S.json } }
	})
)

/** Consumes a stream and may finish before it ends (01 §11). */
export const firstJson = pin(
	describeTaskType({
		id: "core:task/first-json@1",
		timeoutMs: 5000,
		earlyExit: true,
		ports: { in: { main: S.textStream }, out: { main: S.json } }
	})
)

/** Same in-port, but no earlyExit declared — used to prove stream-abandoned. */
export const sloppyStream = pin(
	describeTaskType({
		id: "test:task/sloppy-stream@1",
		timeoutMs: 5000,
		ports: { in: { main: S.textStream }, out: { main: S.json } }
	})
)

// ── Consumers ───────────────────────────────────────────────────────────────

/**
 * Create a message.
 *
 * Split from the old `commitMessage`, which decided new-vs-update from whether an id
 * happened to be present (13 §10b). That was an implicit branch, and F25 exists because
 * implicit branches are unreadable: two specs that did different things looked identical,
 * and the receipt could not tell you which had happened. Two ids, two names, no inference.
 *
 * Gate-eligible, so it publishes the discriminated write result rather than raw ids
 * (13 §7j-b). Under async review this is a proposal a reviewer may still reject.
 */
export const createMessage = pin(
	describeConsumerTarget({
		id: "core:consumer/create-message@1",
		effects: "write",
		timeoutMs: 5000,
		causesEvent: "core:event/message-created@1",
		ports: {
			in: { text: S.text },
			out: { main: S.writeResult, messageId: S.writeResult }
		}
	})
)

/**
 * Update an existing message — a regenerate, a swipe, an edit.
 *
 * `target` takes `row-ids@1`, which means **a message created earlier in the same run
 * cannot be updated by a second node**, because `write-result@1` is not assignable to it.
 * That is the ruling, not an oversight: under async review the created row may never
 * exist, so a create → update pair in one spec is a dangling write waiting for a rejection.
 *
 * The case people reach for this with — write a placeholder, fill it as tokens arrive — is
 * streaming, and streaming is one node with a settled output (01 §11), not two nodes and a
 * hope. The case this *is* for is the one where the id comes from outside the run: the user
 * clicked a message, so the id is on the Input.
 */
export const updateMessage = pin(
	describeConsumerTarget({
		id: "core:consumer/update-message@1",
		effects: "write",
		timeoutMs: 5000,
		causesEvent: "core:event/message-updated@1",
		ports: {
			in: { target: S.rowIds, text: S.text },
			out: { main: S.writeResult, messageId: S.writeResult }
		}
	})
)

export const attachAudio = pin(
	describeConsumerTarget({
		id: "core:consumer/attach-audio@1",
		effects: "write",
		timeoutMs: 5000,
		causesEvent: "core:event/message-updated@1",
		ports: { in: { audio: S.audio }, out: { main: S.writeResult } }
	})
)

export const savePluginData = pin(
	describeConsumerTarget({
		id: "core:consumer/save-plugin-data@1",
		effects: "write",
		timeoutMs: 5000,
		ports: { in: { value: S.json }, out: { main: S.writeResult } }
	})
)

export const emitSocket = pin(
	describeConsumerTarget({
		id: "core:consumer/emit-socket@1",
		effects: "emit",
		timeoutMs: 1000,
		ports: { in: { from: S.json }, out: { main: S.json } }
	})
)
