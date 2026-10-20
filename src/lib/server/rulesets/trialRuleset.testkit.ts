/**
 * Test kit: a ruleset declared the way a plugin declares one — two
 * repertoires (weapons, conditions), a check, a derived stat — for the
 * ruleset handler's tests. Never imported by app code.
 */

import { defineAttributeSlot, defineRepertoire, defineRuleset, getRuleset, type RulesetDecl } from "@serene-pub/sdk"

export const TRIAL = "test:ruleset/trial@1"
export const STR = "test:slot/str@1"
export const HP = "test:slot/hp@1"
export const DEFENSE = "test:slot/defense@1"
export const GEAR = "test:slot/gear@1"
export const AILS = "test:slot/ails@1"
export const OATH = "test:slot/oath@1"

/** Declare the slots and the ruleset (idempotent); returns every slot for a genre. */
export function declareTrial() {
	const stats = [
		defineAttributeSlot(STR, {
			type: "integer",
			label: { en: "Strength" },
			descriptor: "How strong they are.",
			appliesTo: ["cast"],
			config: { min: -5, max: 10 },
			default: 0
		}),
		defineAttributeSlot(HP, {
			type: "integer",
			label: { en: "Health" },
			descriptor: "How much punishment they can take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 30 },
			default: 20
		}),
		defineAttributeSlot(DEFENSE, {
			type: "derived",
			label: { en: "Defense" },
			descriptor: "How hard they are to hit.",
			appliesTo: ["cast"],
			derive: "owner.str | plus: 10"
		})
	]
	const weapons = defineRepertoire("weapons", {
		label: { en: "Weapons" },
		prose: "Weapons: what a character fights with.",
		// `equipped` is a universal piece part since 2026-10-17: declared nowhere, read everywhere.
		mechanics: [
			{ verb: "modify", target: "attack", value: 2, bonusType: "gear", predicate: { path: "piece.equipped", truthy: true } },
			{ verb: "modify", on: "hit", target: "attack", value: 1, bonusType: "gear" },
			{ verb: "modify", on: "hit", target: "attack", value: 1 },
			{ verb: "modify", on: "use", target: "hp", value: -1 }
		]
	})
	const conditions = defineRepertoire("conditions", {
		label: { en: "Conditions" },
		prose: "Conditions: what ails a character.",
		mechanics: [
			{ verb: "modify", on: "elapsed", every: 2, target: "hp", value: -1, predicate: { traits: { any: ["poison"] } } },
			{ verb: "modify", on: "at", at: "100-01-01 12:00", target: "hp", value: -5, predicate: { traits: { any: ["curse"] } } },
			{ verb: "rider", target: "str", text: "Feels it in every step.", predicate: { traits: { any: ["poison"] } } }
		]
	})
	const decl: RulesetDecl =
		getRuleset(TRIAL) ??
		defineRuleset(TRIAL, {
			name: { en: "Trial" },
			voice: {
				prose: "Trial is told in words: no numbers reach the story.",
				mechanics: "Trial resolves checks with a d20; the model narrates the outcome it is given.",
				scripts: "Trial runs its checks; narrate the outcomes."
			},
			conventions: {
				dice: { sides: 20, modifierOf: "str" },
				degrees: {
					bands: [
						{ id: "fumble", label: { en: "Fumble" }, five: "crit-fail" },
						{ id: "miss", label: { en: "Miss" }, five: "fail", from: -9 },
						{ id: "hit", label: { en: "Hit" }, five: "success", from: 0 },
						{ id: "great", label: { en: "Great hit" }, five: "crit", from: 10 }
					],
					naturalShift: { high: 20, low: 1 }
				},
				time: { unit: "hour" }
			},
			stats: [{ id: STR }, { id: HP }, { id: DEFENSE }],
			selectors: { attack: { kind: "check", base: "str" } },
			repertoires: [weapons, conditions]
		})
	const lists = [
		defineAttributeSlot(GEAR, {
			type: "list",
			label: { en: "Gear" },
			descriptor: "What they fight with.",
			appliesTo: ["cast"],
			config: { repertoire: `${TRIAL}#weapons` }
		}),
		defineAttributeSlot(AILS, {
			type: "list",
			label: { en: "Ails" },
			descriptor: "What ails them.",
			appliesTo: ["cast"],
			config: { repertoire: `${TRIAL}#conditions` }
		}),
		defineAttributeSlot(OATH, {
			type: "text",
			label: { en: "Oath" },
			descriptor: "What they swore.",
			appliesTo: ["cast"]
		})
	]
	return { decl, slots: [...stats, ...lists] }
}
