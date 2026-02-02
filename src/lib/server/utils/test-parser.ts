/**
 * Test for parseReasoningFormat with array parameters
 */

import { parseReasoningFormat } from "./parseReasoningFormat"

// Test 1: Simple function call
const test1 = `{reasoning: "Looking up character", functions?: [listCharacters(search:"Hina")]}`
console.log("Test 1 - Simple function:")
console.log(JSON.stringify(parseReasoningFormat(test1), null, 2))

// Test 2: Function with array parameter
const test2 = `{reasoning: "Creating character", functions?: [draftCharacter(userRequest:"Create a samurai named Kenji", additionalFields:["personality","scenario"])]}`
console.log("\nTest 2 - Function with array:")
console.log(JSON.stringify(parseReasoningFormat(test2), null, 2))

// Test 3: Multiple functions
const test3 = `{reasoning: "Need multiple lookups", functions?: [listCharacters(search:"Sarah"), listWorlds(name:"Fantasy")]}`
console.log("\nTest 3 - Multiple functions:")
console.log(JSON.stringify(parseReasoningFormat(test3), null, 2))

// Test 4: Empty functions array
const test4 = `{reasoning: "No functions needed", functions?: []}`
console.log("\nTest 4 - Empty array:")
console.log(JSON.stringify(parseReasoningFormat(test4), null, 2))

// Test 5: The actual format from the screenshot
const test5 = `{reasoning: "User wants to create a new character, so will generate a draft using draftCharacter()", functions?: [draftCharacter(userRequest:"Create a samurai character named Kenji with skill in katana and bow. He has honorable, disciplined personality.", additionalFields:["personality","scenario"])]}`
console.log("\nTest 5 - Real-world example:")
console.log(JSON.stringify(parseReasoningFormat(test5), null, 2))
