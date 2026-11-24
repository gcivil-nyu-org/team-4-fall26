/**
 * What StudySpot should feel like, each feeling shown through three images.
 *
 * Each feeling mixes media, eras and places on purpose: photographs, posters,
 * woodblock prints and paintings from New York, Japan, Iran, China and Europe.
 * Every image is public domain (or released without restrictions) and comes
 * from Wikimedia Commons through its free file API, which serves a resized
 * copy on request, so nothing is downloaded into the repository.
 */

export type Artwork = {
	/** The file's name on Wikimedia Commons. */
	file: string;
	title: string;
	/** Who made it, or the collection it comes from when the maker is unknown. */
	artist: string;
	date: string;
};

export type Feeling = {
	name: string;
	meaning: string;
	artworks: readonly [Artwork, Artwork, Artwork];
};

/** Commons only renders a fixed set of thumbnail widths; these are two of them. */
export function imageUrl(artwork: Artwork, width: 250 | 960 = 960): string {
	return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(artwork.file)}?width=${width}`;
}

/** The file's Commons page, which records where the image came from. */
export function sourceUrl(artwork: Artwork): string {
	return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(artwork.file.replaceAll(' ', '_'))}`;
}

const nyplReadingRoom: Artwork = {
	file: 'New York City public library reading room LCCN2007682035.jpg',
	title: 'Reading room, New York Public Library',
	artist: 'Photograph, Library of Congress',
	date: '1911'
};
const vacationReadingClub: Artwork = {
	file: 'The vacation reading club - join now at your public library LCCN98510373.jpg',
	title: 'The vacation reading club: join now at your public library',
	artist: 'WPA poster',
	date: '1936–39'
};
const twoSisters: Artwork = {
	file: 'Pierre-Auguste Renoir - Two Sisters (On the Terrace) - 1933.455 - Art Institute of Chicago.jpg',
	title: 'Two Sisters (On the Terrace)',
	artist: 'Pierre-Auguste Renoir',
	date: '1881'
};
const eveningSnow: Artwork = {
	file: '東海道五十三次之内 蒲原 夜の雪-Evening Snow MET DP123229.jpg',
	title: 'Evening Snow at Kanbara',
	artist: 'Utagawa Hiroshige',
	date: 'c. 1833'
};
const readingLady: Artwork = {
	file: 'Interior with a Reading Lady (Vilhelm Hammershøi) - Nationalmuseum - 18752.tif',
	title: 'Interior with a Reading Lady',
	artist: 'Vilhelm Hammershøi',
	date: '1900'
};
const rizaAbbasi: Artwork = {
	file: 'Riza-yi-Abbasi 008.jpg',
	title: 'A young man reading',
	artist: 'Reza Abbasi',
	date: 'c. 1625'
};
const suddenShower: Artwork = {
	file: 'Hiroshige, Sudden shower over Shin-Ōhashi bridge and Atake, 1857.jpg',
	title: 'Sudden Shower over Shin-Ōhashi Bridge and Atake',
	artist: 'Utagawa Hiroshige',
	date: '1857'
};
const pikeAndHenry: Artwork = {
	file: 'Pike and Henry Street by Berenice Abbott in 1936.jpg',
	title: 'Pike and Henry Streets, Manhattan',
	artist: 'Berenice Abbott',
	date: '1936'
};
const cityOfNewYork: Artwork = {
	file: 'The city of New York. LOC 75694812.jpg',
	title: 'The City of New York',
	artist: 'Currier & Ives',
	date: '1884'
};
const cafeTerrace: Artwork = {
	file: 'Van Gogh - Terrasse des Cafés an der Place du Forum in Arles am Abend1.jpeg',
	title: 'Café Terrace at Night',
	artist: 'Vincent van Gogh',
	date: '1888'
};
const koishikawa: Artwork = {
	file: 'Tea house at Koishikawa. The morning after a snowfall.jpg',
	title: 'Tea House at Koishikawa, the Morning after a Snowfall',
	artist: 'Katsushika Hokusai',
	date: 'c. 1830'
};
const automat: Artwork = {
	file: 'Automat, ca. 1906 (6648420107).jpg',
	title: 'Horn & Hardart automat, New York',
	artist: 'Library Company of Philadelphia',
	date: 'c. 1906'
};
const literaryGathering: Artwork = {
	file: '文會圖.jpg',
	title: 'Literary Gathering',
	artist: 'Attributed to Emperor Huizong of Song',
	date: 'c. 1100–1125'
};
const locReadingRoom: Artwork = {
	file: 'A reading room in the Library of Congress, Washington, D.C. LCCN2011647046.jpg',
	title: 'A reading room in the Library of Congress',
	artist: 'Photograph, Library of Congress',
	date: '1920'
};
const readTheBooks: Artwork = {
	file: "In March read the books you've always meant to read LCCN98507722.jpg",
	title: 'In March read the books you’ve always meant to read',
	artist: 'WPA poster',
	date: '1936–41'
};

export const FEELINGS: readonly Feeling[] = [
	{
		name: 'Belonging',
		meaning:
			'The feeling of walking into a room and knowing you’re welcome there. Nobody asks what you’re buying or which school you go to. There’s a seat, and it’s yours for the afternoon.',
		artworks: [nyplReadingRoom, vacationReadingClub, twoSisters]
	},
	{
		name: 'Calm',
		meaning:
			'The exhale when you find the corner table by the window. The city drops away, and it’s just you, your work, and enough quiet to think.',
		artworks: [readingLady, eveningSnow, rizaAbbasi]
	},
	{
		name: 'Curiosity',
		meaning:
			'The pull of a neighborhood you’ve never studied in. A reading room you’ve walked past a hundred times, a café two stops further than usual. The city is bigger than your usual three spots.',
		artworks: [suddenShower, pikeAndHenry, cityOfNewYork]
	},
	{
		name: 'Warmth',
		meaning:
			'Steam off a cup, low light, someone sliding over to make room. Studying doesn’t have to feel cold and fluorescent.',
		artworks: [cafeTerrace, koishikawa, automat]
	},
	{
		name: 'Company',
		meaning:
			'The quiet comfort of strangers working nearby. Even on the days you study alone, you’re not alone, and on the others, your people are a message away.',
		artworks: [literaryGathering, locReadingRoom, readTheBooks]
	}
];
