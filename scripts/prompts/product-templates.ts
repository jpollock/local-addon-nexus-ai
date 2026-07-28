export const PRODUCT_CATEGORIES: Record<string, string[]> = {
  'Backpacks & Bags': [
    'daypack',
    'backpacking pack',
    'ultralight backpack',
    'hydration pack',
    'duffel bag',
    'stuff sack set',
  ],
  'Tents & Shelters': [
    '2-person tent',
    '3-person tent',
    '4-person tent',
    'ultralight tent',
    'tarp shelter',
    'bivy sack',
  ],
  'Sleeping Systems': [
    'sleeping bag',
    'down quilt',
    'sleeping pad',
    'camping pillow',
    'sleeping bag liner',
  ],
  'Clothing': [
    'base layer top',
    'insulated jacket',
    'rain jacket',
    'hiking pants',
    'fleece pullover',
    'sun hat',
  ],
  'Footwear': [
    'hiking boots',
    'trail running shoes',
    'approach shoes',
    'camp sandals',
  ],
  'Cooking & Hydration': [
    'backpacking stove',
    'cook set',
    'water filter',
    'water bottle',
    'insulated mug',
  ],
  'Navigation & Safety': [
    'GPS device',
    'headlamp',
    'first aid kit',
    'emergency shelter',
    'compass',
  ],
  'Climbing Gear': [
    'climbing rope',
    'climbing harness',
    'carabiners',
    'climbing helmet',
    'chalk bag',
  ],
  'Winter & Snow': [
    'snowshoes',
    'avalanche beacon',
    'insulated sleeping pad',
    'winter gloves',
  ],
};

export function generateProductNamePrompt(category: string, productType: string): string {
  return `Generate a realistic product name for a ${productType} in the "${category}" category for an outdoor gear retailer.

Requirements:
- Include a fictional brand name (make it sound like a real outdoor brand)
- Include the product type
- Make it sound premium and adventure-oriented
- Keep it under 60 characters

Example formats:
- "Summit Trek 65L Backpacking Pack"
- "Alpine Cloud 20°F Down Sleeping Bag"
- "TrailBlaze Waterproof Hiking Boots"

Write only the product name, no additional text.`;
}

export function generateProductDescriptionPrompt(
  productName: string,
  category: string,
  attributes: Record<string, any>
): string {
  const attrString = Object.entries(attributes)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  return `Write a compelling product description for this outdoor gear item:

Product: ${productName}
Category: ${category}
Specifications: ${attrString}

Requirements:
- Length: 150-300 words
- Tone: Enthusiastic but authentic, technical without being dry
- Focus: Key features, benefits, ideal use cases
- Include 2-3 technical specifications naturally woven into the description
- Mention scenarios where this product excels
- No promotional fluff or exaggerated claims

Write only the product description in plain text format.`;
}

export function generateShortDescriptionPrompt(fullDescription: string): string {
  return `Condense this product description into a compelling 40-60 word short description that captures the key benefits and use case.

Full description:
${fullDescription}

Write only the short description, no additional formatting.`;
}
