import fs from 'fs/promises';
import path from 'path';
import { CharacterCardReader } from '@lenml/char-card-reader';
import yaml from 'js-yaml';

interface CardMetadata {
	name: string;
	description: string;
	tags: string[];
	category?: string;
	author?: string;
	version?: string;
	filePath: string;
	spec: string;
}

/**
 * Recursively scan a directory for character/persona card files
 */
async function scanDirectory(dir: string): Promise<string[]> {
	const files: string[] = [];
	const entries = await fs.readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await scanDirectory(fullPath)));
		} else if (entry.isFile() && entry.name.endsWith('.png')) {
			files.push(fullPath);
		}
	}

	return files;
}

/**
 * Extract metadata from a character card file
 */
async function extractMetadata(filePath: string): Promise<CardMetadata | null> {
	try {
		const reader = new CharacterCardReader();
		const cardData = await reader.parse(filePath);

		if (!cardData) {
			console.warn(`Failed to parse card: ${filePath}`);
			return null;
		}

		// Extract first 150 characters of description for preview
		const description = cardData.data.description?.slice(0, 150) || '';
		const descriptionPreview = description.length === 150 ? description + '...' : description;

		return {
			name: cardData.data.name || path.basename(filePath, '.png'),
			description: descriptionPreview,
			tags: cardData.data.tags || [],
			category: cardData.data.extensions?.category,
			author: cardData.data.creator || cardData.data.extensions?.author,
			version: cardData.data.spec_version || 'v2',
			filePath: path.relative(process.cwd(), filePath),
			spec: cardData.data.spec || 'chara_card_v2'
		};
	} catch (error) {
		console.error(`Error processing ${filePath}:`, error);
		return null;
	}
}

/**
 * Group cards by category and sort alphabetically
 */
function organizeCards(cards: CardMetadata[]): Record<string, CardMetadata[]> {
	const organized: Record<string, CardMetadata[]> = {};

	for (const card of cards) {
		const category = card.category || 'Uncategorized';
		if (!organized[category]) {
			organized[category] = [];
		}
		organized[category].push(card);
	}

	// Sort each category alphabetically by name
	for (const category in organized) {
		organized[category].sort((a, b) => a.name.localeCompare(b.name));
	}

	return organized;
}

/**
 * Generate YAML index file
 */
function generateYAML(organizedCards: Record<string, CardMetadata[]>): string {
	const output: any = {
		version: '1.0.0',
		updated: new Date().toISOString(),
		categories: []
	};

	// Sort categories alphabetically
	const sortedCategories = Object.keys(organizedCards).sort();

	for (const category of sortedCategories) {
		const cards = organizedCards[category];
		output.categories.push({
			name: category,
			cards: cards.map((card) => ({
				name: card.name,
				description: card.description,
				tags: card.tags,
				author: card.author,
				version: card.version,
				spec: card.spec,
				file: card.filePath
			}))
		});
	}

	return yaml.dump(output, {
		lineWidth: 100,
		quotingType: '"',
		forceQuotes: false
	});
}

/**
 * Main execution
 */
async function main() {
	console.log('🔍 Scanning for character cards...');
	const characterFiles = await scanDirectory('./character-cards');
	console.log(`Found ${characterFiles.length} character card files`);

	console.log('🔍 Scanning for persona cards...');
	const personaFiles = await scanDirectory('./persona-cards');
	console.log(`Found ${personaFiles.length} persona card files`);

	// Process character cards
	console.log('\n📝 Processing character cards...');
	const characterMetadata: CardMetadata[] = [];
	for (const file of characterFiles) {
		const metadata = await extractMetadata(file);
		if (metadata) {
			characterMetadata.push(metadata);
		}
	}

	// Process persona cards
	console.log('📝 Processing persona cards...');
	const personaMetadata: CardMetadata[] = [];
	for (const file of personaFiles) {
		const metadata = await extractMetadata(file);
		if (metadata) {
			personaMetadata.push(metadata);
		}
	}

	// Organize and generate YAML
	console.log('\n📦 Organizing cards by category...');
	const organizedCharacters = organizeCards(characterMetadata);
	const organizedPersonas = organizeCards(personaMetadata);

	console.log('✍️  Generating characters.yaml...');
	const charactersYAML = generateYAML(organizedCharacters);
	await fs.writeFile('./characters.yaml', charactersYAML, 'utf-8');

	console.log('✍️  Generating personas.yaml...');
	const personasYAML = generateYAML(organizedPersonas);
	await fs.writeFile('./personas.yaml', personasYAML, 'utf-8');

	console.log('\n✅ Index files generated successfully!');
	console.log(`   - characters.yaml (${characterMetadata.length} cards)`);
	console.log(`   - personas.yaml (${personaMetadata.length} cards)`);
}

main().catch(console.error);
