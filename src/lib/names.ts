import type { Lang } from './i18n.ts';

// A new list gets a random name, so that lists passed between friends can be told apart
// instead of all being called "My picks". The owner can rename it.
const WORDS: Record<Lang, { adjectives: string[]; nouns: string[] }> = {
	en: {
		adjectives: ['Curious', 'Midnight', 'Golden', 'Wandering', 'Cosy', 'Lucky', 'Bright', 'Merry'],
		nouns: ['Owls', 'Foxes', 'Swans', 'Lanterns', 'Bicycles', 'Herons', 'Mermaids', 'Towers']
	},
	da: {
		adjectives: [
			'Nysgerrige',
			'Natlige',
			'Gyldne',
			'Glade',
			'Hyggelige',
			'Heldige',
			'Lyse',
			'Muntre'
		],
		nouns: ['Ugler', 'Ræve', 'Svaner', 'Lygter', 'Cykler', 'Hejrer', 'Havfruer', 'Tårne']
	}
};

const pick = (words: string[]) => words[Math.floor(Math.random() * words.length)];

export function randomListName(lang: Lang): string {
	return `${pick(WORDS[lang].adjectives)} ${pick(WORDS[lang].nouns)}`;
}
