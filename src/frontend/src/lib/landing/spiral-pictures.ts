/**
 * Pictures for the closing spiral: third places in historical art. Cafés,
 * dance gardens, boulevards, parks, riverside lunches, reading rooms and
 * libraries -- mostly Monet and the Impressionists around him, with a few
 * older and further-flung scenes of people gathering to read and talk.
 *
 * Every file is public domain or CC0 on Wikimedia Commons, and is served
 * resized by Commons' free file API, so nothing is stored in the repository.
 */
const FILES: readonly string[] = [
	// Claude Monet
	'Claude Monet, The Luncheon on the Grass, c. 1865, NGA 93067.jpg',
	'Claude Monet 024.jpg',
	'Monet - Impression, Sunrise.jpg',
	'Claude Monet - Boulevard des Capucines - Google Art Project.jpg',
	'Claude Monet - The Saint-Lazare Station - Google Art Project.jpg',
	'Garden at Sainte-Adresse MET DT48.jpg',
	'Claude Monet - Water Lilies - Google Art Project.jpg',
	'La Grenouillère MET DT833.jpg',
	'Poppy Fields near Argenteuil MET DT1034.jpg',
	'The Parc Monceau MET DT1889.jpg',
	'Claude Monet - La Japonaise (Museum of Fine Arts, Boston).jpg',
	'Claude Monet - Springtime - Walters 3711.jpg',
	// Renoir
	'Auguste Renoir - Dance at Le Moulin de la Galette - Google Art Project.jpg',
	'Pierre-Auguste Renoir - Luncheon of the Boating Party - Google Art Project.jpg',
	'Auguste Renoir, Pont Neuf, Paris, 1872, NGA 52202.jpg',
	'Auguste Renoir - La Grenouillère.jpg',
	'Pierre-Auguste Renoir - Two Sisters (On the Terrace) - 1933.455 - Art Institute of Chicago.jpg',
	// Manet, Degas, Caillebotte, Seurat
	'Edouard Manet, A Bar at the Folies-Bergère.jpg',
	'Edouard Manet Music in the Tuileries 1862.jpg',
	'Edouard Manet, Corner of a Café-Concert, ca. 1878-80.jpg',
	'Edgar Degas - In a Café - Google Art Project.jpg',
	'Gustave Caillebotte - Paris Street; Rainy Day - Google Art Project.jpg',
	"Georges Seurat - Un dimanche après-midi à l'île de la Grande Jatte.jpg",
	// Van Gogh, Pissarro, Morisot, Cassatt, Toulouse-Lautrec, Bonnard, Sargent
	'Van Gogh - The Night Café (1888).jpg',
	'Van Gogh - Terrasse des Cafés an der Place du Forum in Arles am Abend1.jpeg',
	'Camille Pissarro - Boulevard Montmartre, Spring - Google Art Project.jpg',
	'Camille Pissarro - Boulevard Montmartre at Night - c 1897 - National Gallery UK.jpg',
	'Berthe Morisot - La Lecture (1873).jpg',
	'Lady at the Tea Table MET DT516.jpg',
	'Mary Cassatt Woman Reading in a Garden.jpg',
	'Henri de Toulouse-Lautrec - At the Moulin Rouge - Google Art Project.jpg',
	'Pierre Bonnard Place Clichy, Evening.jpg',
	'John Singer Sargent, Café sur la Riva degli Schiavoni, Venise.jpg',
	// Rooms for reading, and gatherings further afield
	'Ludwig Passini - Künstler im Cafe Greco in Rom.jpg',
	'Interior with a Reading Lady (Vilhelm Hammershøi) - Nationalmuseum - 18752.tif',
	'Vilhelm Hammershøi Interior with a Table, Bookcase and Windsor Chair Strandgade 25.jpg',
	'Tea house at Koishikawa. The morning after a snowfall.jpg',
	'文會圖.jpg',
	'Riza-yi-Abbasi 008.jpg',
	'New York City public library reading room LCCN2007682035.jpg',
	'A reading room in the Library of Congress, Washington, D.C. LCCN2011647046.jpg',
	'Automat, ca. 1906 (6648420107).jpg'
];

/** 250 is one of the thumbnail widths Commons renders ahead of time. */
export const SPIRAL_PICTURES: readonly string[] = FILES.map(
	(file) =>
		`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=250`
);
