# Alpine Outfitters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-scale WordPress demo site (Alpine Outfitters) with 500+ AI-generated content pieces showcasing Nexus AI fleet management and WP Engine Intelligent Web capabilities.

**Architecture:** Content generation scripts (TypeScript) → AI APIs (Anthropic/OpenAI) → JSON output → WP-CLI import → WordPress site in Local → Push to WPE environments (Prod/Staging/Dev) → Power KB sync.

**Tech Stack:** 
- Content generation: Node.js, TypeScript, @anthropic-ai/sdk, @faker-js/faker
- WordPress: 7.0+, WooCommerce 9.x, ACF Pro, WPE Hub Plugin
- Deployment: Local by WP Engine, WPE hosting, Nexus AI CLI

## Global Constraints

- WordPress 7.0+ required (for AI features)
- PHP 8.2+ required
- Node.js 18+ for content generation scripts
- Repository location: `/Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo`
- Local site name: `alpineoutfitters.local`
- WPE install name: `alpineoutfitters`
- Content counts: 300 posts, 200 products, 30 trips, 40 destinations, 30 pages, 12 team
- All AI-generated content must be coherent, on-brand (adventurous, authentic, technical)
- Price range: $20-$500 for products
- Trip price range: $200-$3000
- Featured images: placeholders with AI-generated alt text
- Internal linking: 10-20% of blog posts link to products/destinations

---

## Phase 1: Repository Setup & Infrastructure

### Task 1: Initialize Repository Structure

**Files:**
- Create: `/Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo/`
- Create: `package.json`, `.gitignore`, `README.md`, `.env.example`, `tsconfig.json`
- Create: `scripts/`, `docs/`, `wp-content/plugins/alpine-acf-config/`

**Interfaces:**
- Produces: Repository root directory structure, ready for scripts and WordPress assets

- [ ] **Step 1: Create repository directory**

```bash
mkdir -p /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo
cd /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo
```

- [ ] **Step 2: Initialize git repository**

```bash
git init
git branch -M main
```

- [ ] **Step 3: Create directory structure**

```bash
mkdir -p scripts/{generators,importers,prompts,utils}
mkdir -p docs
mkdir -p wp-content/plugins/alpine-acf-config/acf-json
mkdir -p data
```

- [ ] **Step 4: Create .gitignore**

```bash
cat > .gitignore << 'EOF'
# Node
node_modules/
npm-debug.log
.DS_Store

# Environment
.env

# Generated content (JSON files - regenerate from scripts)
data/*.json

# WordPress uploads (too large for git)
wp-content/uploads/

# Local config
*.local.json
.vscode/

# Build artifacts
dist/
*.log
EOF
```

- [ ] **Step 5: Create README.md**

```markdown
# Alpine Outfitters Demo Site

Production-scale WordPress demo showcasing Nexus AI and WP Engine Intelligent Web.

## Quick Start

\`\`\`bash
cd scripts
npm install
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# Generate all content
npm run generate:all

# Import to Local site (requires site "alpineoutfitters.local" to exist)
npm run import:all --site alpineoutfitters.local
\`\`\`

## Documentation

- [Design Spec](docs/design.md) - Complete design specification
- [Setup Guide](docs/SETUP.md) - Detailed setup instructions
- [Generation Guide](docs/GENERATION.md) - How to run content generation scripts

## Content

- 300 blog posts across 6 categories
- 200 WooCommerce products across 10 categories  
- 30 guided trips (custom post type)
- 40 trail destinations (custom post type)
- 30 static pages
- 12 team members

## Tech Stack

- WordPress 7.0+
- WooCommerce 9.x
- Advanced Custom Fields Pro
- WPE Hub Plugin (Intelligent Web integration)
- Node.js 18+ (content generation)
- TypeScript
```

- [ ] **Step 6: Create .env.example**

```bash
cat > .env.example << 'EOF'
# AI Provider API Keys (choose one or multiple)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Target WordPress Site
SITE_URL=http://alpineoutfitters.local
WP_CLI_PATH=/usr/local/bin/wp
SITE_NAME=alpineoutfitters.local

# Content Generation Settings
POSTS_COUNT=300
PRODUCTS_COUNT=200
TRIPS_COUNT=30
DESTINATIONS_COUNT=40
PAGES_COUNT=30
TEAM_COUNT=12

# AI Generation Settings
AI_MODEL=claude-3-5-sonnet-20241022
BATCH_SIZE=10
MAX_RETRIES=3
GENERATION_DELAY_MS=1000

# Output Settings
OUTPUT_DIR=../data
VERBOSE=true
DRY_RUN=false
EOF
```

- [ ] **Step 7: Commit repository structure**

```bash
git add .
git commit -m "feat: initialize alpine-outfitters-demo repository structure"
```

---

### Task 2: TypeScript Configuration & Dependencies

**Files:**
- Create: `scripts/package.json`
- Create: `scripts/tsconfig.json`

**Interfaces:**
- Consumes: Repository structure from Task 1
- Produces: Node.js project with TypeScript, AI SDKs, Faker, dotenv configured

- [ ] **Step 1: Create scripts/package.json**

```json
{
  "name": "alpine-outfitters-content-generator",
  "version": "1.0.0",
  "description": "AI-powered content generation for Alpine Outfitters demo site",
  "type": "module",
  "scripts": {
    "generate:all": "tsx generate-content.ts --all",
    "generate:posts": "tsx generate-content.ts --type posts",
    "generate:products": "tsx generate-content.ts --type products",
    "generate:trips": "tsx generate-content.ts --type trips",
    "generate:destinations": "tsx generate-content.ts --type destinations",
    "generate:pages": "tsx generate-content.ts --type pages",
    "generate:team": "tsx generate-content.ts --type team",
    "import:all": "tsx importers/wp-cli-importer.ts --all",
    "import:posts": "tsx importers/wp-cli-importer.ts --type posts",
    "import:products": "tsx importers/wp-cli-importer.ts --type products",
    "import:trips": "tsx importers/wp-cli-importer.ts --type trips",
    "import:destinations": "tsx importers/wp-cli-importer.ts --type destinations",
    "import:pages": "tsx importers/wp-cli-importer.ts --type pages",
    "import:team": "tsx importers/wp-cli-importer.ts --type team",
    "verify": "tsx importers/verify-import.ts",
    "preview": "tsx preview-content.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@faker-js/faker": "^9.0.0",
    "dotenv": "^16.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.15.0",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create scripts/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd scripts
npm install
```

- [ ] **Step 4: Verify TypeScript setup**

```bash
npx tsx --version
# Should output: 4.15.0 or similar
```

- [ ] **Step 5: Commit package configuration**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "feat: add TypeScript and AI SDK dependencies"
```

---

### Task 3: Shared Utilities & Types

**Files:**
- Create: `scripts/utils/types.ts`
- Create: `scripts/utils/config.ts`
- Create: `scripts/utils/logger.ts`

**Interfaces:**
- Consumes: package.json dependencies from Task 2
- Produces: `loadConfig(): Config`, `logger.info/error()`, shared TypeScript types for all generators

- [ ] **Step 1: Create scripts/utils/types.ts**

```typescript
export interface Config {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  siteUrl: string;
  wpCliPath: string;
  siteName: string;
  postsCount: number;
  productsCount: number;
  tripsCount: number;
  destinationsCount: number;
  pagesCount: number;
  teamCount: number;
  aiModel: string;
  batchSize: number;
  maxRetries: number;
  generationDelayMs: number;
  outputDir: string;
  verbose: boolean;
  dryRun: boolean;
}

export interface BlogPost {
  title: string;
  content: string;
  excerpt: string;
  author: string;
  publishDate: string;
  categories: string[];
  tags: string[];
  featuredImageAlt?: string;
  internalLinks?: Array<{ type: 'product' | 'destination'; id: number }>;
}

export interface Product {
  name: string;
  description: string;
  shortDescription: string;
  price: number;
  sku: string;
  weight: number;
  stockQuantity: number;
  categories: string[];
  tags: string[];
  attributes: Record<string, string | number>;
  variations?: Array<{ size?: string; color?: string; sku: string; price: number }>;
}

export interface Trip {
  title: string;
  content: string;
  duration: number;
  difficulty: number;
  price: number;
  groupSize: { min: number; max: number };
  itinerary: Array<{ day: number; activities: string }>;
  season: string[];
  region: string;
  relatedDestinations: number[];
  requiredGear: number[];
}

export interface Destination {
  title: string;
  content: string;
  distance: number;
  elevationGain: number;
  difficulty: number;
  trailType: 'loop' | 'out-and-back' | 'point-to-point';
  gps: string;
  permitRequired: boolean;
  permitDetails?: string;
  bestSeasons: string[];
  region: string;
  relatedTrips?: number[];
  recommendedGear?: number[];
}

export interface Page {
  title: string;
  content: string;
  slug: string;
  parentSlug?: string;
}

export interface TeamMember {
  name: string;
  bio: string;
  yearsExperience: number;
  certifications: string[];
  specialties: string[];
  email: string;
  favoriteDestinations?: number[];
  guidedTrips?: number[];
}
```

- [ ] **Step 2: Create scripts/utils/config.ts**

```typescript
import dotenv from 'dotenv';
import { Config } from './types.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(): Config {
  // Load .env from scripts directory
  dotenv.config({ path: path.join(__dirname, '../.env') });

  const config: Config = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    siteUrl: process.env.SITE_URL || 'http://alpineoutfitters.local',
    wpCliPath: process.env.WP_CLI_PATH || '/usr/local/bin/wp',
    siteName: process.env.SITE_NAME || 'alpineoutfitters.local',
    postsCount: parseInt(process.env.POSTS_COUNT || '300', 10),
    productsCount: parseInt(process.env.PRODUCTS_COUNT || '200', 10),
    tripsCount: parseInt(process.env.TRIPS_COUNT || '30', 10),
    destinationsCount: parseInt(process.env.DESTINATIONS_COUNT || '40', 10),
    pagesCount: parseInt(process.env.PAGES_COUNT || '30', 10),
    teamCount: parseInt(process.env.TEAM_COUNT || '12', 10),
    aiModel: process.env.AI_MODEL || 'claude-3-5-sonnet-20241022',
    batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    generationDelayMs: parseInt(process.env.GENERATION_DELAY_MS || '1000', 10),
    outputDir: process.env.OUTPUT_DIR || '../data',
    verbose: process.env.VERBOSE === 'true',
    dryRun: process.env.DRY_RUN === 'true',
  };

  // Validate required fields
  if (!config.anthropicApiKey && !config.openaiApiKey) {
    throw new Error('ANTHROPIC_API_KEY or OPENAI_API_KEY must be set in .env');
  }

  return config;
}
```

- [ ] **Step 3: Create scripts/utils/logger.ts**

```typescript
import { Config } from './types.js';

class Logger {
  private verbose: boolean = false;

  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  info(message: string, ...args: any[]) {
    console.log(`ℹ️  ${message}`, ...args);
  }

  debug(message: string, ...args: any[]) {
    if (this.verbose) {
      console.log(`🔍 ${message}`, ...args);
    }
  }

  success(message: string, ...args: any[]) {
    console.log(`✅ ${message}`, ...args);
  }

  error(message: string, ...args: any[]) {
    console.error(`❌ ${message}`, ...args);
  }

  warn(message: string, ...args: any[]) {
    console.warn(`⚠️  ${message}`, ...args);
  }
}

export const logger = new Logger();
```

- [ ] **Step 4: Test utilities compile**

```bash
cd scripts
npx tsx --check utils/types.ts utils/config.ts utils/logger.ts
```

Expected: No TypeScript errors

- [ ] **Step 5: Commit utilities**

```bash
git add utils/
git commit -m "feat: add shared utilities (types, config, logger)"
```

---

## Phase 2: AI Client & Content Generation Core

### Task 4: AI Client Wrapper

**Files:**
- Create: `scripts/utils/ai-client.ts`

**Interfaces:**
- Consumes: `Config` from Task 3, Anthropic SDK from package.json
- Produces: `generateText(prompt: string): Promise<string>`, `generateBatch(prompts: string[]): Promise<string[]>`

- [ ] **Step 1: Create scripts/utils/ai-client.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Config } from './types.js';
import { logger } from './logger.js';

export class AIClient {
  private anthropic: Anthropic | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    if (config.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    }
  }

  async generateText(prompt: string, retries = 0): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      logger.debug(`Generating text (attempt ${retries + 1})...`);
      
      const response = await this.anthropic.messages.create({
        model: this.config.aiModel,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from AI');
      }

      return textBlock.text;
    } catch (error: any) {
      if (retries < this.config.maxRetries) {
        logger.warn(`AI request failed, retrying (${retries + 1}/${this.config.maxRetries})...`);
        await this.delay(this.config.generationDelayMs * (retries + 1));
        return this.generateText(prompt, retries + 1);
      }
      logger.error('AI request failed after max retries:', error.message);
      throw error;
    }
  }

  async generateBatch(prompts: string[]): Promise<string[]> {
    const results: string[] = [];
    
    for (let i = 0; i < prompts.length; i++) {
      logger.debug(`Generating ${i + 1}/${prompts.length}...`);
      const result = await this.generateText(prompts[i]);
      results.push(result);
      
      // Rate limiting delay between requests
      if (i < prompts.length - 1) {
        await this.delay(this.config.generationDelayMs);
      }
    }
    
    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 2: Test AI client compiles**

```bash
cd scripts
npx tsx --check utils/ai-client.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit AI client**

```bash
git add utils/ai-client.ts
git commit -m "feat: add AI client wrapper with retry logic"
```

---

### Task 5: Faker Helpers for Realistic Data

**Files:**
- Create: `scripts/utils/faker-helpers.ts`

**Interfaces:**
- Consumes: @faker-js/faker from package.json
- Produces: `randomDate(startDate, endDate)`, `randomPrice(min, max)`, `randomSKU()`, `randomAuthor()`, `randomRegion()`

- [ ] **Step 1: Create scripts/utils/faker-helpers.ts**

```typescript
import { faker } from '@faker-js/faker';

export const AUTHORS = [
  'Sarah Mitchell',
  'Jake Thompson',
  'Elena Rodriguez',
  'Marcus Chen',
  'Amy Patel',
  'Jordan Williams',
];

export const REGIONS = [
  'Pacific Northwest',
  'Sierra Nevada',
  'Rocky Mountains',
  'Desert Southwest',
  'Eastern Mountains',
];

export function randomDate(startDate: Date, endDate: Date): string {
  const date = faker.date.between({ from: startDate, to: endDate });
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

export function randomPrice(min: number, max: number): number {
  return parseFloat(faker.commerce.price({ min, max, dec: 0 }));
}

export function randomSKU(prefix = 'AO'): string {
  return `${prefix}-${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`;
}

export function randomAuthor(): string {
  return faker.helpers.arrayElement(AUTHORS);
}

export function randomRegion(): string {
  return faker.helpers.arrayElement(REGIONS);
}

export function randomWeight(minOz: number, maxOz: number): number {
  return parseFloat(faker.number.float({ min: minOz, max: maxOz, fractionDigits: 1 }));
}

export function randomElevationGain(min: number, max: number): number {
  return faker.number.int({ min, max });
}

export function randomDistance(min: number, max: number): number {
  return parseFloat(faker.number.float({ min, max, fractionDigits: 1 }));
}

export function randomGPS(region: string): string {
  // Approximate GPS coordinates for each region
  const coords = {
    'Pacific Northwest': { latMin: 45, latMax: 49, lonMin: -124, lonMax: -117 },
    'Sierra Nevada': { latMin: 36, latMax: 40, lonMin: -121, lonMax: -118 },
    'Rocky Mountains': { latMin: 37, latMax: 45, lonMin: -111, lonMax: -105 },
    'Desert Southwest': { latMin: 31, latMax: 37, lonMin: -114, lonMax: -106 },
    'Eastern Mountains': { latMin: 35, latMax: 44, lonMin: -83, lonMax: -71 },
  };

  const regionCoords = coords[region as keyof typeof coords] || coords['Rocky Mountains'];
  
  const lat = faker.number.float({
    min: regionCoords.latMin,
    max: regionCoords.latMax,
    fractionDigits: 4,
  });
  const lon = faker.number.float({
    min: regionCoords.lonMin,
    max: regionCoords.lonMax,
    fractionDigits: 4,
  });

  return `${lat}, ${lon}`;
}
```

- [ ] **Step 2: Test faker helpers compile**

```bash
cd scripts
npx tsx --check utils/faker-helpers.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit faker helpers**

```bash
git add utils/faker-helpers.ts
git commit -m "feat: add faker helpers for realistic data generation"
```

---

### Task 6: WP-CLI Wrapper

**Files:**
- Create: `scripts/utils/wp-cli.ts`

**Interfaces:**
- Consumes: `Config` from Task 3
- Produces: `runWPCLI(command: string): Promise<string>`, `importPosts(jsonPath: string): Promise<number>`

- [ ] **Step 1: Create scripts/utils/wp-cli.ts**

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from './types.js';
import { logger } from './logger.js';

const execAsync = promisify(exec);

export class WPCLIClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async runWPCLI(command: string): Promise<string> {
    const fullCommand = `${this.config.wpCliPath} ${command} --path=${this.getSitePath()}`;
    
    logger.debug(`Running: ${fullCommand}`);
    
    try {
      const { stdout, stderr } = await execAsync(fullCommand);
      if (stderr && !stderr.includes('Warning')) {
        logger.warn('WP-CLI stderr:', stderr);
      }
      return stdout.trim();
    } catch (error: any) {
      logger.error('WP-CLI command failed:', error.message);
      throw error;
    }
  }

  async importPosts(jsonPath: string, postType = 'post'): Promise<number> {
    logger.info(`Importing ${postType} from ${jsonPath}...`);
    
    const output = await this.runWPCLI(
      `post create ${jsonPath} --format=json --post_type=${postType} --porcelain`
    );
    
    const ids = output.split('\n').filter(Boolean);
    logger.success(`Imported ${ids.length} ${postType}s`);
    return ids.length;
  }

  async importProducts(jsonPath: string): Promise<number> {
    logger.info(`Importing products from ${jsonPath}...`);
    
    const output = await this.runWPCLI(
      `wc product create ${jsonPath} --format=json --user=1`
    );
    
    const results = JSON.parse(output);
    const count = Array.isArray(results) ? results.length : 1;
    logger.success(`Imported ${count} products`);
    return count;
  }

  async getPostCount(postType = 'post'): Promise<number> {
    const output = await this.runWPCLI(`post list --post_type=${postType} --format=count`);
    return parseInt(output, 10);
  }

  async getProductCount(): Promise<number> {
    const output = await this.runWPCLI(`wc product list --format=count`);
    return parseInt(output, 10);
  }

  private getSitePath(): string {
    // Assumes Local sites are in ~/Local Sites/{site-name}/app/public
    return `~/Local\\ Sites/${this.config.siteName}/app/public`;
  }
}
```

- [ ] **Step 2: Test WP-CLI wrapper compiles**

```bash
cd scripts
npx tsx --check utils/wp-cli.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit WP-CLI wrapper**

```bash
git add utils/wp-cli.ts
git commit -m "feat: add WP-CLI wrapper for import operations"
```

---

## Phase 3: Content Generation - Blog Posts

### Task 7: Blog Post Prompt Templates

**Files:**
- Create: `scripts/prompts/post-templates.ts`

**Interfaces:**
- Produces: `generatePostPrompt(category: string, topic: string): string`

- [ ] **Step 1: Create scripts/prompts/post-templates.ts**

```typescript
export const CATEGORIES = [
  'Hiking & Backpacking',
  'Camping',
  'Climbing',
  'Gear Reviews',
  'Trip Reports',
  'Conservation & Leave No Trace',
];

export const TOPICS_BY_CATEGORY: Record<string, string[]> = {
  'Hiking & Backpacking': [
    'trail navigation basics',
    'choosing the right backpack',
    'water treatment methods',
    'meal planning for multi-day trips',
    'building hiking endurance',
    'leave no trace principles',
    'hiking with kids',
    'solo hiking safety',
    'trail etiquette',
    'winter hiking preparation',
  ],
  'Camping': [
    'campsite selection tips',
    'camp cooking techniques',
    'staying warm in cold weather',
    'bear safety and food storage',
    'car camping vs backpacking',
    'campfire building and safety',
    'camping with dogs',
    'ultralight camping gear',
    'camping in rain',
    'camp kitchen organization',
  ],
  'Climbing': [
    'intro to rock climbing',
    'climbing safety fundamentals',
    'choosing climbing shoes',
    'rope management',
    'belaying best practices',
    'sport climbing vs trad climbing',
    'building anchor systems',
    'climbing training exercises',
    'route reading skills',
    'climbing ethics',
  ],
  'Gear Reviews': [
    'best tents for backpacking',
    'sleeping bag temperature ratings explained',
    'water filter comparison',
    'hiking boot vs trail runner',
    'ultralight backpack review',
    'camp stove efficiency tests',
    'down vs synthetic insulation',
    'GPS device comparison',
    'headlamp brightness shootout',
    'rain jacket waterproof testing',
  ],
  'Trip Reports': [
    'summit attempt on Mount Rainier',
    'backpacking the John Muir Trail',
    'weekend in Yosemite Valley',
    'climbing in Joshua Tree',
    'Colorado 14er challenge',
    'Pacific Crest Trail section hike',
    'winter camping in the Rockies',
    'Appalachian Trail thru-hike',
    'desert backpacking in Utah',
    'alpine lakes loop adventure',
  ],
  'Conservation & Leave No Trace': [
    'pack it in, pack it out',
    'reducing trail impact',
    'responsible wildlife viewing',
    'campfire alternatives',
    'protecting water sources',
    'trail maintenance volunteering',
    'sustainable outdoor recreation',
    'educating others on LNT',
    'minimizing noise pollution',
    'respecting wildlife corridors',
  ],
};

export function generatePostPrompt(category: string, topic: string, wordCount: number): string {
  return `You are a professional outdoor writer for Alpine Outfitters, an outdoor gear retailer and adventure company.

Write a comprehensive blog post about "${topic}" for the "${category}" category.

Requirements:
- Length: ${wordCount} words
- Tone: Adventurous, authentic, knowledgeable but not overly technical
- Audience: Outdoor enthusiasts ranging from beginners to experienced adventurers
- Focus: Practical, actionable advice based on real experience
- Brand voice: Environmental stewardship, safety-conscious, expert guidance

Structure:
- Engaging introduction that hooks the reader
- 3-5 main sections with clear subheadings
- Specific tips, techniques, or recommendations
- Conclusion with key takeaways

Do NOT include:
- Placeholder text or [insert X here] markers
- Overly promotional language
- Links to external sites (we'll add internal links later)
- Author bylines or publishing dates

Write only the article content in plain text format (no markdown formatting).`;
}

export function generateExcerptPrompt(title: string, content: string): string {
  return `Given this blog post title and content, write a compelling 2-sentence excerpt (max 150 characters) that summarizes the key value and entices readers to click.

Title: ${title}

Content: ${content.substring(0, 500)}...

Write only the excerpt text, no additional formatting.`;
}
```

- [ ] **Step 2: Test prompts compile**

```bash
cd scripts
npx tsx --check prompts/post-templates.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit post templates**

```bash
git add prompts/post-templates.ts
git commit -m "feat: add blog post prompt templates"
```

---

### Task 8: Blog Post Generator

**Files:**
- Create: `scripts/generators/blog-posts.ts`

**Interfaces:**
- Consumes: `AIClient` (Task 4), `generatePostPrompt()` (Task 7), faker helpers (Task 5)
- Produces: `generateBlogPosts(count: number): Promise<BlogPost[]>`

- [ ] **Step 1: Create scripts/generators/blog-posts.ts**

```typescript
import { AIClient } from '../utils/ai-client.js';
import { Config, BlogPost } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { randomDate, randomAuthor } from '../utils/faker-helpers.js';
import { faker } from '@faker-js/faker';
import {
  CATEGORIES,
  TOPICS_BY_CATEGORY,
  generatePostPrompt,
  generateExcerptPrompt,
} from '../prompts/post-templates.js';

export class BlogPostGenerator {
  private aiClient: AIClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.aiClient = new AIClient(config);
  }

  async generateBlogPosts(count: number): Promise<BlogPost[]> {
    logger.info(`Generating ${count} blog posts...`);
    const posts: BlogPost[] = [];
    
    const postsPerCategory = Math.ceil(count / CATEGORIES.length);
    
    for (const category of CATEGORIES) {
      const categoryTopics = TOPICS_BY_CATEGORY[category];
      const categoryPostCount = Math.min(postsPerCategory, categoryTopics.length);
      
      logger.info(`Generating ${categoryPostCount} posts for category: ${category}`);
      
      for (let i = 0; i < categoryPostCount && posts.length < count; i++) {
        const topic = categoryTopics[i % categoryTopics.length];
        const post = await this.generateSinglePost(category, topic);
        posts.push(post);
        
        logger.success(`Generated post ${posts.length}/${count}: "${post.title}"`);
      }
    }
    
    return posts;
  }

  private async generateSinglePost(category: string, topic: string): Promise<BlogPost> {
    // Random word count between 500-2000
    const wordCount = faker.number.int({ min: 500, max: 2000 });
    
    // Generate title first
    const titlePrompt = `Write an engaging, SEO-friendly blog post title about "${topic}" for the "${category}" category. The title should be 60-80 characters, action-oriented, and include specific value. Write only the title, no quotes or formatting.`;
    const title = await this.aiClient.generateText(titlePrompt);
    
    // Generate content
    const contentPrompt = generatePostPrompt(category, topic, wordCount);
    const content = await this.aiClient.generateText(contentPrompt);
    
    // Generate excerpt
    const excerptPrompt = generateExcerptPrompt(title, content);
    const excerpt = await this.aiClient.generateText(excerptPrompt);
    
    // Generate featured image alt text
    const altPrompt = `Write a descriptive alt text (max 125 characters) for a featured image that would accompany this blog post. Focus on visual description of outdoor adventure scenes. Title: "${title}". Write only the alt text.`;
    const featuredImageAlt = await this.aiClient.generateText(altPrompt);
    
    // Assign metadata
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2026-01-01');
    const publishDate = randomDate(startDate, endDate);
    const author = randomAuthor();
    
    // Generate tags based on content keywords
    const tags = this.extractTags(content, category);
    
    return {
      title: title.trim(),
      content: content.trim(),
      excerpt: excerpt.trim(),
      author,
      publishDate,
      categories: [category],
      tags,
      featuredImageAlt: featuredImageAlt.trim(),
    };
  }

  private extractTags(content: string, category: string): string[] {
    const tags: Set<string> = new Set();
    
    // Common outdoor activity tags
    const activityTags = ['hiking', 'backpacking', 'camping', 'climbing', 'mountaineering', 'skiing'];
    const gearTags = ['tent', 'backpack', 'sleeping bag', 'stove', 'boots', 'rain gear'];
    const skillTags = ['beginner', 'intermediate', 'advanced', 'expert'];
    const seasonTags = ['spring', 'summer', 'fall', 'winter'];
    
    const allPossibleTags = [...activityTags, ...gearTags, ...skillTags, ...seasonTags];
    
    const lowerContent = content.toLowerCase();
    
    for (const tag of allPossibleTags) {
      if (lowerContent.includes(tag)) {
        tags.add(tag);
      }
    }
    
    // Add category-based tag
    if (category === 'Hiking & Backpacking') tags.add('hiking');
    if (category === 'Camping') tags.add('camping');
    if (category === 'Climbing') tags.add('climbing');
    if (category === 'Gear Reviews') tags.add('gear');
    if (category === 'Trip Reports') tags.add('adventure');
    if (category === 'Conservation & Leave No Trace') tags.add('conservation');
    
    // Limit to 5-8 tags
    const tagArray = Array.from(tags);
    return faker.helpers.arrayElements(tagArray, { min: 5, max: Math.min(8, tagArray.length) });
  }
}
```

- [ ] **Step 2: Test blog post generator compiles**

```bash
cd scripts
npx tsx --check generators/blog-posts.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit blog post generator**

```bash
git add generators/blog-posts.ts
git commit -m "feat: add blog post generator with AI content creation"
```

---

## Phase 4: Content Generation - Products

### Task 9: Product Prompt Templates

**Files:**
- Create: `scripts/prompts/product-templates.ts`

**Interfaces:**
- Produces: `generateProductPrompt(category: string, productType: string): string`

- [ ] **Step 1: Create scripts/prompts/product-templates.ts**

```typescript
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
```

- [ ] **Step 2: Test product prompts compile**

```bash
cd scripts
npx tsx --check prompts/product-templates.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit product templates**

```bash
git add prompts/product-templates.ts
git commit -m "feat: add product prompt templates"
```

---

---

### Task 10: Product Generator

**Files:**
- Create: `scripts/generators/products.ts`

**Interfaces:**
- Consumes: `AIClient` (Task 4), product prompts (Task 9), faker helpers (Task 5)
- Produces: `generateProducts(count: number): Promise<Product[]>`

- [ ] **Step 1: Create scripts/generators/products.ts**

```typescript
import { AIClient } from '../utils/ai-client.js';
import { Config, Product } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { randomPrice, randomSKU, randomWeight } from '../utils/faker-helpers.js';
import { faker } from '@faker-js/faker';
import {
  PRODUCT_CATEGORIES,
  generateProductNamePrompt,
  generateProductDescriptionPrompt,
  generateShortDescriptionPrompt,
} from '../prompts/product-templates.js';

export class ProductGenerator {
  private aiClient: AIClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.aiClient = new AIClient(config);
  }

  async generateProducts(count: number): Promise<Product[]> {
    logger.info(`Generating ${count} products...`);
    const products: Product[] = [];
    
    const categories = Object.keys(PRODUCT_CATEGORIES);
    const productsPerCategory = Math.ceil(count / categories.length);
    
    for (const category of categories) {
      const productTypes = PRODUCT_CATEGORIES[category];
      const categoryProductCount = Math.min(productsPerCategory, productTypes.length * 4);
      
      logger.info(`Generating ${categoryProductCount} products for category: ${category}`);
      
      for (let i = 0; i < categoryProductCount && products.length < count; i++) {
        const productType = productTypes[i % productTypes.length];
        const product = await this.generateSingleProduct(category, productType);
        products.push(product);
        
        logger.success(`Generated product ${products.length}/${count}: "${product.name}"`);
      }
    }
    
    return products;
  }

  private async generateSingleProduct(category: string, productType: string): Promise<Product> {
    // Generate product name
    const namePrompt = generateProductNamePrompt(category, productType);
    const name = await this.aiClient.generateText(namePrompt);
    
    // Generate attributes based on product type
    const attributes = this.generateAttributes(category, productType);
    
    // Generate full description
    const descPrompt = generateProductDescriptionPrompt(name, category, attributes);
    const description = await this.aiClient.generateText(descPrompt);
    
    // Generate short description
    const shortDescPrompt = generateShortDescriptionPrompt(description);
    const shortDescription = await this.aiClient.generateText(shortDescPrompt);
    
    // Generate pricing and inventory
    const price = randomPrice(20, 500);
    const sku = randomSKU();
    const weight = this.generateWeight(productType);
    const stockQuantity = faker.number.int({ min: 50, max: 200 });
    
    // Generate tags
    const tags = this.generateTags(category, productType, attributes);
    
    // Generate variations if applicable (clothing, footwear)
    const variations = this.shouldHaveVariations(category)
      ? this.generateVariations(price, sku)
      : undefined;
    
    return {
      name: name.trim(),
      description: description.trim(),
      shortDescription: shortDescription.trim(),
      price,
      sku,
      weight,
      stockQuantity,
      categories: [category],
      tags,
      attributes,
      variations,
    };
  }

  private generateAttributes(category: string, productType: string): Record<string, string | number> {
    const attrs: Record<string, string | number> = {};
    
    // Category-specific attributes
    if (category === 'Backpacks & Bags') {
      attrs.capacity = faker.number.int({ min: 20, max: 80 });
      attrs.capacity_unit = 'liters';
      attrs.torso_fit = faker.helpers.arrayElement(['S-M', 'M-L', 'One Size']);
    }
    
    if (category === 'Tents & Shelters') {
      attrs.capacity = faker.helpers.arrayElement(['1-person', '2-person', '3-person', '4-person']);
      attrs.seasons = faker.helpers.arrayElement(['3-season', '4-season', 'Summer']);
      attrs.floor_area = faker.number.int({ min: 25, max: 60 });
      attrs.floor_area_unit = 'sq ft';
    }
    
    if (category === 'Sleeping Systems') {
      if (productType.includes('bag') || productType.includes('quilt')) {
        attrs.temperature_rating = faker.helpers.arrayElement(['-20°F', '0°F', '15°F', '30°F', '40°F']);
        attrs.insulation = faker.helpers.arrayElement(['Down', 'Synthetic']);
      }
      if (productType.includes('pad')) {
        attrs.r_value = faker.number.float({ min: 1.0, max: 7.0, fractionDigits: 1 });
        attrs.thickness = faker.number.float({ min: 1.5, max: 4.0, fractionDigits: 1 });
        attrs.thickness_unit = 'inches';
      }
    }
    
    if (category === 'Clothing') {
      attrs.material = faker.helpers.arrayElement(['Merino Wool', 'Synthetic', 'Down', 'Fleece', 'Nylon']);
      attrs.waterproof = faker.helpers.arrayElement(['Yes', 'No', 'Water Resistant']);
    }
    
    if (category === 'Footwear') {
      attrs.waterproof = faker.helpers.arrayElement(['Yes', 'No']);
      attrs.ankle_support = faker.helpers.arrayElement(['High', 'Mid', 'Low']);
    }
    
    if (category === 'Cooking & Hydration') {
      if (productType.includes('stove')) {
        attrs.fuel_type = faker.helpers.arrayElement(['Canister', 'Liquid', 'Multi-fuel']);
        attrs.boil_time = `${faker.number.int({ min: 2, max: 8 })} minutes`;
      }
      if (productType.includes('filter')) {
        attrs.filter_type = faker.helpers.arrayElement(['Pump', 'Gravity', 'Squeeze', 'UV']);
        attrs.capacity = `${faker.number.int({ min: 1, max: 4 })} liters`;
      }
    }
    
    if (category === 'Climbing Gear') {
      if (productType.includes('rope')) {
        attrs.rope_type = faker.helpers.arrayElement(['Dynamic', 'Static']);
        attrs.diameter = `${faker.number.float({ min: 8.5, max: 11.0, fractionDigits: 1 })}mm`;
        attrs.length = `${faker.helpers.arrayElement([30, 50, 60, 70])}m`;
      }
    }
    
    return attrs;
  }

  private generateWeight(productType: string): number {
    // Weight in ounces
    const weights: Record<string, [number, number]> = {
      tent: [32, 96],
      backpack: [48, 128],
      'sleeping bag': [16, 48],
      jacket: [8, 24],
      stove: [2, 12],
      default: [4, 32],
    };
    
    for (const [key, range] of Object.entries(weights)) {
      if (productType.includes(key)) {
        return randomWeight(range[0], range[1]);
      }
    }
    
    return randomWeight(weights.default[0], weights.default[1]);
  }

  private generateTags(
    category: string,
    productType: string,
    attributes: Record<string, any>
  ): string[] {
    const tags = new Set<string>();
    
    // Activity tags
    if (category.includes('Backpack') || category.includes('Sleeping')) {
      tags.add('backpacking');
    }
    if (category.includes('Climbing')) {
      tags.add('climbing');
    }
    
    // Feature tags
    if (attributes.waterproof === 'Yes') tags.add('waterproof');
    if (attributes.insulation === 'Down') tags.add('down');
    if (attributes.insulation === 'Synthetic') tags.add('synthetic');
    if (attributes.seasons === '4-season') tags.add('winter');
    if (productType.includes('ultralight')) tags.add('ultralight');
    
    // Material tags
    if (attributes.material) {
      tags.add(attributes.material.toLowerCase().replace(' ', '-'));
    }
    
    // Generic tags
    tags.add('gear');
    tags.add(category.toLowerCase().split(' ')[0]);
    
    return Array.from(tags).slice(0, 6);
  }

  private shouldHaveVariations(category: string): boolean {
    return category === 'Clothing' || category === 'Footwear';
  }

  private generateVariations(basePrice: number, baseSku: string): Array<{
    size?: string;
    color?: string;
    sku: string;
    price: number;
  }> {
    const sizes = ['S', 'M', 'L', 'XL'];
    const colors = faker.helpers.arrayElements(
      ['Black', 'Navy', 'Olive', 'Red', 'Blue', 'Gray'],
      { min: 2, max: 3 }
    );
    
    const variations = [];
    
    for (const size of sizes) {
      for (const color of colors) {
        variations.push({
          size,
          color,
          sku: `${baseSku}-${size}-${color.substring(0, 3).toUpperCase()}`,
          price: basePrice + faker.number.int({ min: -10, max: 10 }),
        });
      }
    }
    
    return variations;
  }
}
```

- [ ] **Step 2: Test product generator compiles**

```bash
cd scripts
npx tsx --check generators/products.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit product generator**

```bash
git add generators/products.ts
git commit -m "feat: add product generator with attributes and variations"
```

---

## Phase 5: Content Generation - Custom Post Types

### Task 11: Trip Generator

**Files:**
- Create: `scripts/prompts/trip-templates.ts`
- Create: `scripts/generators/trips.ts`

**Interfaces:**
- Consumes: `AIClient`, faker helpers
- Produces: `generateTrips(count: number): Promise<Trip[]>`

- [ ] **Step 1: Create scripts/prompts/trip-templates.ts**

```typescript
export const TRIP_TYPES = [
  { name: 'Summit Climb', difficulty: [3, 5], duration: [3, 7], priceRange: [800, 2500] },
  { name: 'Backpacking Trip', difficulty: [2, 4], duration: [2, 7], priceRange: [400, 1800] },
  { name: 'Rock Climbing Weekend', difficulty: [3, 4], duration: [2, 3], priceRange: [350, 800] },
  { name: 'Alpine Trek', difficulty: [3, 5], duration: [4, 10], priceRange: [1000, 3000] },
  { name: 'Day Hiking Adventure', difficulty: [1, 2], duration: [1, 1], priceRange: [150, 300] },
  { name: 'Winter Expedition', difficulty: [4, 5], duration: [5, 14], priceRange: [1500, 3000] },
];

export function generateTripDescriptionPrompt(
  tripName: string,
  region: string,
  duration: number,
  difficulty: number
): string {
  return `Write a compelling trip description for this guided outdoor adventure:

Trip: ${tripName}
Region: ${region}
Duration: ${duration} days
Difficulty: ${difficulty}/5

Requirements:
- Length: 300-500 words
- Tone: Inspiring but realistic, adventure-focused
- Include: Overview of the experience, daily highlights, physical requirements, what makes this trip special
- Mention: Stunning scenery, wildlife possibilities, cultural/historical context
- Emphasize: Expert guides, safety, small group experience
- Do NOT include: Pricing, dates, or booking information

Write only the trip description in plain text format.`;
}

export function generateItineraryPrompt(
  tripName: string,
  duration: number,
  region: string
): string {
  return `Create a day-by-day itinerary for this ${duration}-day guided trip:

Trip: ${tripName}
Region: ${region}

For each day, write 2-3 sentences describing:
- Location and route
- Key activities and experiences
- Approximate mileage/elevation if applicable
- Meals and lodging

Format as JSON array:
[
  { "day": 1, "activities": "Day 1 description..." },
  { "day": 2, "activities": "Day 2 description..." }
]

Write only the JSON array, no additional text.`;
}
```

- [ ] **Step 2: Create scripts/generators/trips.ts**

```typescript
import { AIClient } from '../utils/ai-client.js';
import { Config, Trip } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { randomRegion } from '../utils/faker-helpers.js';
import { faker } from '@faker-js/faker';
import {
  TRIP_TYPES,
  generateTripDescriptionPrompt,
  generateItineraryPrompt,
} from '../prompts/trip-templates.js';

export class TripGenerator {
  private aiClient: AIClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.aiClient = new AIClient(config);
  }

  async generateTrips(count: number): Promise<Trip[]> {
    logger.info(`Generating ${count} guided trips...`);
    const trips: Trip[] = [];
    
    for (let i = 0; i < count; i++) {
      const trip = await this.generateSingleTrip();
      trips.push(trip);
      logger.success(`Generated trip ${i + 1}/${count}: "${trip.title}"`);
    }
    
    return trips;
  }

  private async generateSingleTrip(): Promise<Trip> {
    // Select random trip type
    const tripType = faker.helpers.arrayElement(TRIP_TYPES);
    const region = randomRegion();
    const duration = faker.number.int({
      min: tripType.duration[0],
      max: tripType.duration[1],
    });
    const difficulty = faker.number.int({
      min: tripType.difficulty[0],
      max: tripType.difficulty[1],
    });
    const price = faker.number.int({
      min: tripType.priceRange[0],
      max: tripType.priceRange[1],
    });
    
    // Generate trip name
    const namePrompt = `Generate a compelling name for a ${duration}-day ${tripType.name.toLowerCase()} in the ${region}. Make it specific and inspiring. Include a landmark or destination name. Keep it under 60 characters. Write only the trip name.`;
    const title = await this.aiClient.generateText(namePrompt);
    
    // Generate description
    const descPrompt = generateTripDescriptionPrompt(title, region, duration, difficulty);
    const content = await this.aiClient.generateText(descPrompt);
    
    // Generate itinerary
    const itineraryPrompt = generateItineraryPrompt(title, duration, region);
    const itineraryText = await this.aiClient.generateText(itineraryPrompt);
    
    let itinerary: Array<{ day: number; activities: string }> = [];
    try {
      itinerary = JSON.parse(itineraryText);
    } catch (error) {
      logger.warn('Failed to parse itinerary JSON, generating fallback');
      itinerary = this.generateFallbackItinerary(duration);
    }
    
    // Generate metadata
    const seasons = this.selectSeasons(duration, difficulty);
    const groupSize = {
      min: faker.number.int({ min: 4, max: 6 }),
      max: faker.number.int({ min: 8, max: 12 }),
    };
    
    return {
      title: title.trim(),
      content: content.trim(),
      duration,
      difficulty,
      price,
      groupSize,
      itinerary,
      season: seasons,
      region,
      relatedDestinations: [], // Will be populated during import
      requiredGear: [], // Will be populated during import
    };
  }

  private selectSeasons(duration: number, difficulty: number): string[] {
    const allSeasons = ['Spring', 'Summer', 'Fall', 'Winter'];
    
    // High difficulty or long trips avoid winter
    if (difficulty >= 4 || duration >= 10) {
      return faker.helpers.arrayElements(['Spring', 'Summer', 'Fall'], { min: 1, max: 2 });
    }
    
    // Winter trips
    if (difficulty === 5) {
      return ['Winter'];
    }
    
    // Most trips are spring/summer/fall
    return faker.helpers.arrayElements(allSeasons, { min: 1, max: 3 });
  }

  private generateFallbackItinerary(duration: number): Array<{ day: number; activities: string }> {
    const itinerary = [];
    for (let day = 1; day <= duration; day++) {
      itinerary.push({
        day,
        activities: `Day ${day} activities and experiences.`,
      });
    }
    return itinerary;
  }
}
```

- [ ] **Step 3: Test trip generator compiles**

```bash
cd scripts
npx tsx --check generators/trips.ts
```

Expected: No TypeScript errors

- [ ] **Step 4: Commit trip generator**

```bash
git add prompts/trip-templates.ts generators/trips.ts
git commit -m "feat: add trip generator with itineraries"
```

---

### Task 12: Destination Generator

**Files:**
- Create: `scripts/prompts/destination-templates.ts`
- Create: `scripts/generators/destinations.ts`

**Interfaces:**
- Consumes: `AIClient`, faker helpers (GPS coordinates)
- Produces: `generateDestinations(count: number): Promise<Destination[]>`

- [ ] **Step 1: Create scripts/prompts/destination-templates.ts**

```typescript
export const DESTINATION_TYPES = [
  'day hike',
  'backpacking route',
  'climbing area',
  'campsite',
  'summit',
  'alpine lake',
  'canyon',
  'waterfall',
];

export function generateDestinationDescriptionPrompt(
  name: string,
  region: string,
  distance: number,
  elevationGain: number,
  difficulty: number
): string {
  return `Write a detailed destination guide for this outdoor location:

Destination: ${name}
Region: ${region}
Distance: ${distance} miles
Elevation Gain: ${elevationGain} feet
Difficulty: ${difficulty}/5

Requirements:
- Length: 200-400 words
- Include: Trail overview, key features, scenic highlights, best times to visit
- Mention: Notable viewpoints, wildlife, wildflowers (if applicable), water sources
- Describe: The trail experience, what makes this destination special
- Include: Any permits or regulations if this seems like a popular/protected area
- Tone: Informative, inspiring, focused on the experience

Write only the destination description in plain text format.`;
}
```

- [ ] **Step 2: Create scripts/generators/destinations.ts**

```typescript
import { AIClient } from '../utils/ai-client.js';
import { Config, Destination } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { randomRegion, randomDistance, randomElevationGain, randomGPS } from '../utils/faker-helpers.js';
import { faker } from '@faker-js/faker';
import { DESTINATION_TYPES, generateDestinationDescriptionPrompt } from '../prompts/destination-templates.js';

export class DestinationGenerator {
  private aiClient: AIClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.aiClient = new AIClient(config);
  }

  async generateDestinations(count: number): Promise<Destination[]> {
    logger.info(`Generating ${count} destinations...`);
    const destinations: Destination[] = [];
    
    for (let i = 0; i < count; i++) {
      const destination = await this.generateSingleDestination();
      destinations.push(destination);
      logger.success(`Generated destination ${i + 1}/${count}: "${destination.title}"`);
    }
    
    return destinations;
  }

  private async generateSingleDestination(): Promise<Destination> {
    const region = randomRegion();
    const destType = faker.helpers.arrayElement(DESTINATION_TYPES);
    const difficulty = faker.number.int({ min: 1, max: 5 });
    
    // Generate stats based on difficulty
    const distance = this.generateDistance(difficulty);
    const elevationGain = this.generateElevation(difficulty);
    const trailType = faker.helpers.arrayElement(['loop', 'out-and-back', 'point-to-point'] as const);
    
    // Generate destination name
    const namePrompt = `Generate a realistic name for a ${destType} in the ${region}. Use actual mountain, peak, lake, or trail naming conventions. Make it sound like a real place. Keep it under 50 characters. Write only the destination name.`;
    const title = await this.aiClient.generateText(namePrompt);
    
    // Generate description
    const descPrompt = generateDestinationDescriptionPrompt(title, region, distance, elevationGain, difficulty);
    const content = await this.aiClient.generateText(descPrompt);
    
    // Generate GPS coordinates
    const gps = randomGPS(region);
    
    // Determine permit requirement (harder/more popular trails often need permits)
    const permitRequired = difficulty >= 4 && faker.datatype.boolean();
    const permitDetails = permitRequired
      ? `Permit required. Apply online through recreation.gov at least ${faker.number.int({ min: 2, max: 12 })} weeks in advance.`
      : undefined;
    
    // Select best seasons based on elevation and difficulty
    const bestSeasons = this.selectBestSeasons(elevationGain, region);
    
    return {
      title: title.trim(),
      content: content.trim(),
      distance,
      elevationGain,
      difficulty,
      trailType,
      gps,
      permitRequired,
      permitDetails,
      bestSeasons,
      region,
    };
  }

  private generateDistance(difficulty: number): number {
    const ranges: Record<number, [number, number]> = {
      1: [2, 5],
      2: [4, 8],
      3: [6, 12],
      4: [10, 18],
      5: [15, 26],
    };
    const range = ranges[difficulty];
    return randomDistance(range[0], range[1]);
  }

  private generateElevation(difficulty: number): number {
    const ranges: Record<number, [number, number]> = {
      1: [200, 800],
      2: [500, 1500],
      3: [1000, 2500],
      4: [2000, 4500],
      5: [3500, 7000],
    };
    const range = ranges[difficulty];
    return randomElevationGain(range[0], range[1]);
  }

  private selectBestSeasons(elevationGain: number, region: string): string[] {
    // High elevation = shorter season
    if (elevationGain > 4000) {
      return ['Summer', 'Early Fall'];
    }
    
    // Desert regions have different seasons
    if (region === 'Desert Southwest') {
      return ['Spring', 'Fall', 'Winter'];
    }
    
    // Most trails are best in spring/summer/fall
    return faker.helpers.arrayElements(['Spring', 'Summer', 'Fall'], { min: 2, max: 3 });
  }
}
```

- [ ] **Step 3: Test destination generator compiles**

```bash
cd scripts
npx tsx --check generators/destinations.ts
```

Expected: No TypeScript errors

- [ ] **Step 4: Commit destination generator**

```bash
git add prompts/destination-templates.ts generators/destinations.ts
git commit -m "feat: add destination generator with trail info and GPS"
```

---

### Task 13: Pages Generator

**Files:**
- Create: `scripts/prompts/page-templates.ts`
- Create: `scripts/generators/pages.ts`

**Interfaces:**
- Consumes: `AIClient`
- Produces: `generatePages(count: number): Promise<Page[]>`

- [ ] **Step 1: Create scripts/prompts/page-templates.ts**

```typescript
export const PAGES = [
  { title: 'About Us', slug: 'about', type: 'about' },
  { title: 'Contact', slug: 'contact', type: 'contact' },
  { title: 'Trip FAQs', slug: 'trip-faqs', type: 'faq' },
  { title: 'Gear Rental Policies', slug: 'gear-rental', type: 'policy' },
  { title: 'Packing Lists', slug: 'packing-lists', type: 'resource' },
  { title: 'Trip Preparation Guide', slug: 'trip-preparation', type: 'resource' },
  { title: 'Leave No Trace Principles', slug: 'leave-no-trace', type: 'resource' },
  { title: 'Waiver & Safety', slug: 'waiver-safety', type: 'policy' },
  { title: 'Privacy Policy', slug: 'privacy-policy', type: 'policy' },
  { title: 'Terms of Service', slug: 'terms-of-service', type: 'policy' },
  { title: 'Shipping & Returns', slug: 'shipping-returns', type: 'policy' },
  { title: 'Careers', slug: 'careers', type: 'about' },
  { title: 'Getting Started with Backpacking', slug: 'getting-started-backpacking', type: 'resource' },
  { title: 'How to Choose a Sleeping Bag', slug: 'choose-sleeping-bag', type: 'resource' },
  { title: 'Layering for Cold Weather', slug: 'cold-weather-layering', type: 'resource' },
  { title: 'Water Purification Methods', slug: 'water-purification', type: 'resource' },
  { title: 'Navigation Basics', slug: 'navigation-basics', type: 'resource' },
  { title: 'Trip Planning Checklist', slug: 'trip-planning-checklist', type: 'resource' },
];

export function generatePagePrompt(pageTitle: string, pageType: string): string {
  const prompts: Record<string, string> = {
    about: `Write an "About Us" page for Alpine Outfitters, an outdoor gear retailer and guided trip company. Include: company mission (connecting people with nature), history (founded 2010), values (environmental stewardship, safety, expertise), team overview. Length: 300-500 words. Tone: Authentic, passionate about outdoors.`,
    
    contact: `Write a Contact page for Alpine Outfitters. Include: invitation to reach out, hours of operation (Mon-Fri 9am-6pm PT, Sat 10am-4pm), email (info@alpineoutfitters.com), phone (555-HIKE-NOW), physical store address (fictional), and note about trip planning consultations. Length: 200-300 words.`,
    
    faq: `Write a comprehensive FAQ page for guided outdoor trips. Include 10-12 Q&A pairs covering: what's included, group sizes, difficulty levels, required fitness, what to bring, weather considerations, refund policy, dietary accommodations, age requirements, guide qualifications. Length: 600-800 words total.`,
    
    policy: `Write a ${pageTitle} page for Alpine Outfitters. Be professional, clear, and fair. Cover standard policies for this type of page. Length: 400-600 words.`,
    
    resource: `Write an educational resource page titled "${pageTitle}" for outdoor enthusiasts. Provide practical, actionable advice. Include clear sections, specific tips, and beginner-friendly explanations. Length: 500-700 words.`,
  };
  
  const prompt = prompts[pageType] || prompts.resource;
  
  return `${prompt}

Write only the page content in plain text format. No title (we'll add that separately).`;
}
```

- [ ] **Step 2: Create scripts/generators/pages.ts**

```typescript
import { AIClient } from '../utils/ai-client.js';
import { Config, Page } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { PAGES, generatePagePrompt } from '../prompts/page-templates.ts';

export class PageGenerator {
  private aiClient: AIClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.aiClient = new AIClient(config);
  }

  async generatePages(count: number): Promise<Page[]> {
    logger.info(`Generating ${count} pages...`);
    const pages: Page[] = [];
    
    const pagesToGenerate = PAGES.slice(0, count);
    
    for (let i = 0; i < pagesToGenerate.length; i++) {
      const pageConfig = pagesToGenerate[i];
      const page = await this.generateSinglePage(pageConfig);
      pages.push(page);
      logger.success(`Generated page ${i + 1}/${count}: "${page.title}"`);
    }
    
    return pages;
  }

  private async generateSinglePage(pageConfig: {
    title: string;
    slug: string;
    type: string;
  }): Promise<Page> {
    const prompt = generatePagePrompt(pageConfig.title, pageConfig.type);
    const content = await this.aiClient.generateText(prompt);
    
    return {
      title: pageConfig.title,
      slug: pageConfig.slug,
      content: content.trim(),
    };
  }
}
```

- [ ] **Step 3: Test pages generator compiles**

```bash
cd scripts
npx tsx --check generators/pages.ts
```

Expected: No TypeScript errors

- [ ] **Step 4: Commit pages generator**

```bash
git add prompts/page-templates.ts generators/pages.ts
git commit -m "feat: add pages generator for static content"
```

---

### Task 14: Team Members Generator

**Files:**
- Create: `scripts/prompts/team-templates.ts`
- Create: `scripts/generators/team.ts`

**Interfaces:**
- Consumes: `AIClient`, faker
- Produces: `generateTeamMembers(count: number): Promise<TeamMember[]>`

- [ ] **Step 1: Create scripts/prompts/team-templates.ts**

```typescript
export const TEAM_ROLES = [
  { role: 'Lead Guide', count: 3, experienceMin: 10, experienceMax: 20 },
  { role: 'Climbing Specialist', count: 2, experienceMin: 8, experienceMax: 15 },
  { role: 'Backpacking Guide', count: 3, experienceMin: 5, experienceMax: 12 },
  { role: 'Winter Specialist', count: 2, experienceMin: 7, experienceMax: 15 },
  { role: 'Operations Staff', count: 2, experienceMin: 3, experienceMax: 8 },
];

export const CERTIFICATIONS = [
  'Wilderness First Responder (WFR)',
  'Leave No Trace Trainer',
  'AMGA Single Pitch Instructor',
  'AMGA Rock Guide',
  'AMGA Alpine Guide',
  'Avalanche Level 1',
  'Avalanche Level 2',
  'Avalanche Level 3',
  'Swift Water Rescue',
  'CPR/AED Certified',
];

export function generateTeamBioPrompt(
  name: string,
  role: string,
  yearsExperience: number,
  certifications: string[]
): string {
  return `Write a professional bio for this outdoor guide/staff member:

Name: ${name}
Role: ${role}
Years of Experience: ${yearsExperience}
Certifications: ${certifications.join(', ')}

Requirements:
- Length: 200-300 words
- Tone: Professional but approachable, passionate about outdoors
- Include: How they got into guiding, specialties, favorite trips/destinations, personal philosophy about outdoor education
- Mention: Specific skills or experiences that make them great at their role
- Make it personal and authentic

Write only the bio in plain text format, third person.`;
}
```

- [ ] **Step 2: Create scripts/generators/team.ts**

```typescript
import { AIClient } from '../utils/ai-client.js';
import { Config, TeamMember } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { faker } from '@faker-js/faker';
import {
  TEAM_ROLES,
  CERTIFICATIONS,
  generateTeamBioPrompt,
} from '../prompts/team-templates.js';

export class TeamMemberGenerator {
  private aiClient: AIClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.aiClient = new AIClient(config);
  }

  async generateTeamMembers(count: number): Promise<TeamMember[]> {
    logger.info(`Generating ${count} team members...`);
    const teamMembers: TeamMember[] = [];
    
    for (const roleConfig of TEAM_ROLES) {
      for (let i = 0; i < roleConfig.count && teamMembers.length < count; i++) {
        const member = await this.generateSingleMember(roleConfig);
        teamMembers.push(member);
        logger.success(`Generated team member ${teamMembers.length}/${count}: "${member.name}"`);
      }
    }
    
    return teamMembers;
  }

  private async generateSingleMember(roleConfig: {
    role: string;
    experienceMin: number;
    experienceMax: number;
  }): Promise<TeamMember> {
    const name = faker.person.fullName();
    const yearsExperience = faker.number.int({
      min: roleConfig.experienceMin,
      max: roleConfig.experienceMax,
    });
    
    // Select certifications based on role
    const certifications = this.selectCertifications(roleConfig.role, yearsExperience);
    
    // Generate bio
    const bioPrompt = generateTeamBioPrompt(name, roleConfig.role, yearsExperience, certifications);
    const bio = await this.aiClient.generateText(bioPrompt);
    
    // Generate specialties
    const specialties = this.generateSpecialties(roleConfig.role);
    
    // Generate email
    const email = this.generateEmail(name);
    
    return {
      name,
      bio: bio.trim(),
      yearsExperience,
      certifications,
      specialties,
      email,
    };
  }

  private selectCertifications(role: string, yearsExperience: number): string[] {
    const certs = new Set<string>();
    
    // Everyone has WFR and CPR
    certs.add('Wilderness First Responder (WFR)');
    certs.add('CPR/AED Certified');
    
    // Role-specific certifications
    if (role.includes('Climbing')) {
      certs.add(faker.helpers.arrayElement([
        'AMGA Single Pitch Instructor',
        'AMGA Rock Guide',
        'AMGA Alpine Guide',
      ]));
    }
    
    if (role.includes('Winter')) {
      certs.add('Avalanche Level 1');
      if (yearsExperience > 8) {
        certs.add('Avalanche Level 2');
      }
    }
    
    if (role.includes('Lead Guide') && yearsExperience > 12) {
      certs.add('Leave No Trace Trainer');
    }
    
    // Add 1-2 additional random certifications for experienced guides
    if (yearsExperience > 10) {
      const additionalCerts = faker.helpers.arrayElements(
        CERTIFICATIONS.filter((c) => !certs.has(c)),
        { min: 1, max: 2 }
      );
      additionalCerts.forEach((c) => certs.add(c));
    }
    
    return Array.from(certs);
  }

  private generateSpecialties(role: string): string[] {
    const specialtiesByRole: Record<string, string[]> = {
      'Lead Guide': ['Expedition Planning', 'Risk Management', 'Wilderness Medicine', 'Navigation'],
      'Climbing Specialist': ['Rock Climbing', 'Alpine Climbing', 'Anchor Building', 'Rope Systems'],
      'Backpacking Guide': ['Trail Selection', 'Lightweight Travel', 'Camp Craft', 'Wilderness Skills'],
      'Winter Specialist': ['Snow Travel', 'Avalanche Assessment', 'Winter Camping', 'Ski Touring'],
      'Operations Staff': ['Logistics', 'Gear Management', 'Client Services', 'Trip Coordination'],
    };
    
    const pool = specialtiesByRole[role] || ['Outdoor Education', 'Group Dynamics', 'Environmental Ethics'];
    
    return faker.helpers.arrayElements(pool, { min: 2, max: 4 });
  }

  private generateEmail(name: string): string {
    const firstName = name.split(' ')[0].toLowerCase();
    const lastName = name.split(' ')[1]?.toLowerCase() || 'guide';
    return `${firstName}.${lastName}@alpineoutfitters.com`;
  }
}
```

- [ ] **Step 3: Test team generator compiles**

```bash
cd scripts
npx tsx --check generators/team.ts
```

Expected: No TypeScript errors

- [ ] **Step 4: Commit team generator**

```bash
git add prompts/team-templates.ts generators/team.ts
git commit -m "feat: add team member generator with bios and certifications"
```

---

## Phase 6: Main Orchestrator & Import

### Task 15: Main Content Generation CLI

**Files:**
- Create: `scripts/generate-content.ts`

**Interfaces:**
- Consumes: All generators (Tasks 8, 10, 11, 12, 13, 14)
- Produces: JSON files in `data/` directory for each content type

- [ ] **Step 1: Create scripts/generate-content.ts**

```typescript
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { BlogPostGenerator } from './generators/blog-posts.js';
import { ProductGenerator } from './generators/products.js';
import { TripGenerator } from './generators/trips.js';
import { DestinationGenerator } from './generators/destinations.js';
import { PageGenerator } from './generators/pages.js';
import { TeamMemberGenerator } from './generators/team.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  logger.setVerbose(config.verbose);
  
  const type = args.find((arg) => arg.startsWith('--type='))?.split('=')[1];
  const generateAll = args.includes('--all');
  
  if (!type && !generateAll) {
    logger.error('Usage: tsx generate-content.ts --all OR --type=posts|products|trips|destinations|pages|team');
    process.exit(1);
  }
  
  // Ensure output directory exists
  const outputDir = path.resolve(__dirname, config.outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  
  if (generateAll || type === 'posts') {
    await generatePosts(config, outputDir);
  }
  
  if (generateAll || type === 'products') {
    await generateProducts(config, outputDir);
  }
  
  if (generateAll || type === 'trips') {
    await generateTrips(config, outputDir);
  }
  
  if (generateAll || type === 'destinations') {
    await generateDestinations(config, outputDir);
  }
  
  if (generateAll || type === 'pages') {
    await generatePages(config, outputDir);
  }
  
  if (generateAll || type === 'team') {
    await generateTeam(config, outputDir);
  }
  
  logger.success('Content generation complete!');
}

async function generatePosts(config: any, outputDir: string) {
  logger.info(`\n=== Generating Blog Posts ===`);
  const generator = new BlogPostGenerator(config);
  const posts = await generator.generateBlogPosts(config.postsCount);
  const outputPath = path.join(outputDir, 'posts.json');
  await fs.writeFile(outputPath, JSON.stringify(posts, null, 2));
  logger.success(`Saved ${posts.length} posts to ${outputPath}`);
}

async function generateProducts(config: any, outputDir: string) {
  logger.info(`\n=== Generating Products ===`);
  const generator = new ProductGenerator(config);
  const products = await generator.generateProducts(config.productsCount);
  const outputPath = path.join(outputDir, 'products.json');
  await fs.writeFile(outputPath, JSON.stringify(products, null, 2));
  logger.success(`Saved ${products.length} products to ${outputPath}`);
}

async function generateTrips(config: any, outputDir: string) {
  logger.info(`\n=== Generating Trips ===`);
  const generator = new TripGenerator(config);
  const trips = await generator.generateTrips(config.tripsCount);
  const outputPath = path.join(outputDir, 'trips.json');
  await fs.writeFile(outputPath, JSON.stringify(trips, null, 2));
  logger.success(`Saved ${trips.length} trips to ${outputPath}`);
}

async function generateDestinations(config: any, outputDir: string) {
  logger.info(`\n=== Generating Destinations ===`);
  const generator = new DestinationGenerator(config);
  const destinations = await generator.generateDestinations(config.destinationsCount);
  const outputPath = path.join(outputDir, 'destinations.json');
  await fs.writeFile(outputPath, JSON.stringify(destinations, null, 2));
  logger.success(`Saved ${destinations.length} destinations to ${outputPath}`);
}

async function generatePages(config: any, outputDir: string) {
  logger.info(`\n=== Generating Pages ===`);
  const generator = new PageGenerator(config);
  const pages = await generator.generatePages(config.pagesCount);
  const outputPath = path.join(outputDir, 'pages.json');
  await fs.writeFile(outputPath, JSON.stringify(pages, null, 2));
  logger.success(`Saved ${pages.length} pages to ${outputPath}`);
}

async function generateTeam(config: any, outputDir: string) {
  logger.info(`\n=== Generating Team Members ===`);
  const generator = new TeamMemberGenerator(config);
  const team = await generator.generateTeamMembers(config.teamCount);
  const outputPath = path.join(outputDir, 'team.json');
  await fs.writeFile(outputPath, JSON.stringify(team, null, 2));
  logger.success(`Saved ${team.length} team members to ${outputPath}`);
}

main().catch((error) => {
  logger.error('Generation failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Test orchestrator compiles**

```bash
cd scripts
npx tsx --check generate-content.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit main orchestrator**

```bash
git add generate-content.ts
git commit -m "feat: add main content generation orchestrator CLI"
```

---

### Task 16: WP-CLI Import Scripts

**Files:**
- Create: `scripts/importers/wp-cli-importer.ts`

**Interfaces:**
- Consumes: Generated JSON files from Task 15, `WPCLIClient` from Task 6
- Produces: Imported content in WordPress via WP-CLI

- [ ] **Step 1: Create scripts/importers/wp-cli-importer.ts**

```typescript
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { WPCLIClient } from '../utils/wp-cli.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  logger.setVerbose(config.verbose);
  
  const wpCli = new WPCLIClient(config);
  
  const type = args.find((arg) => arg.startsWith('--type='))?.split('=')[1];
  const importAll = args.includes('--all');
  const siteArg = args.find((arg) => arg.startsWith('--site='))?.split('=')[1];
  
  // Override site name if provided
  if (siteArg) {
    config.siteName = siteArg;
  }
  
  if (!type && !importAll) {
    logger.error('Usage: tsx wp-cli-importer.ts --all OR --type=posts|products|trips|destinations|pages|team [--site=sitename]');
    process.exit(1);
  }
  
  const dataDir = path.resolve(__dirname, '../data');
  
  if (importAll || type === 'posts') {
    await importPosts(wpCli, dataDir);
  }
  
  if (importAll || type === 'products') {
    await importProducts(wpCli, dataDir);
  }
  
  if (importAll || type === 'trips') {
    await importTrips(wpCli, dataDir);
  }
  
  if (importAll || type === 'destinations') {
    await importDestinations(wpCli, dataDir);
  }
  
  if (importAll || type === 'pages') {
    await importPages(wpCli, dataDir);
  }
  
  if (importAll || type === 'team') {
    await importTeam(wpCli, dataDir);
  }
  
  logger.success('Import complete!');
}

async function importPosts(wpCli: WPCLIClient, dataDir: string) {
  logger.info(`\n=== Importing Blog Posts ===`);
  const jsonPath = path.join(dataDir, 'posts.json');
  const count = await wpCli.importPosts(jsonPath, 'post');
  logger.success(`Imported ${count} posts`);
}

async function importProducts(wpCli: WPCLIClient, dataDir: string) {
  logger.info(`\n=== Importing Products ===`);
  const jsonPath = path.join(dataDir, 'products.json');
  const count = await wpCli.importProducts(jsonPath);
  logger.success(`Imported ${count} products`);
}

async function importTrips(wpCli: WPCLIClient, dataDir: string) {
  logger.info(`\n=== Importing Trips ===`);
  const jsonPath = path.join(dataDir, 'trips.json');
  const count = await wpCli.importPosts(jsonPath, 'trip');
  logger.success(`Imported ${count} trips`);
}

async function importDestinations(wpCli: WPCLIClient, dataDir: string) {
  logger.info(`\n=== Importing Destinations ===`);
  const jsonPath = path.join(dataDir, 'destinations.json');
  const count = await wpCli.importPosts(jsonPath, 'destination');
  logger.success(`Imported ${count} destinations`);
}

async function importPages(wpCli: WPCLIClient, dataDir: string) {
  logger.info(`\n=== Importing Pages ===`);
  const jsonPath = path.join(dataDir, 'pages.json');
  const count = await wpCli.importPosts(jsonPath, 'page');
  logger.success(`Imported ${count} pages`);
}

async function importTeam(wpCli: WPCLIClient, dataDir: string) {
  logger.info(`\n=== Importing Team Members ===`);
  const jsonPath = path.join(dataDir, 'team.json');
  const count = await wpCli.importPosts(jsonPath, 'team');
  logger.success(`Imported ${count} team members`);
}

main().catch((error) => {
  logger.error('Import failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Test importer compiles**

```bash
cd scripts
npx tsx --check importers/wp-cli-importer.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit importer**

```bash
git add importers/wp-cli-importer.ts
git commit -m "feat: add WP-CLI importer for all content types"
```

---

### Task 17: Verification Script

**Files:**
- Create: `scripts/importers/verify-import.ts`

**Interfaces:**
- Consumes: `WPCLIClient`
- Produces: Console report of import counts vs expected counts

- [ ] **Step 1: Create scripts/importers/verify-import.ts**

```typescript
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { WPCLIClient } from '../utils/wp-cli.js';

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  
  const siteArg = args.find((arg) => arg.startsWith('--site='))?.split('=')[1];
  if (siteArg) {
    config.siteName = siteArg;
  }
  
  const wpCli = new WPCLIClient(config);
  
  logger.info(`\n=== Verifying Import for ${config.siteName} ===\n`);
  
  const checks = [
    { name: 'Blog Posts', type: 'post', expected: config.postsCount },
    { name: 'Products', type: 'product', expected: config.productsCount, isProduct: true },
    { name: 'Trips', type: 'trip', expected: config.tripsCount },
    { name: 'Destinations', type: 'destination', expected: config.destinationsCount },
    { name: 'Pages', type: 'page', expected: config.pagesCount },
    { name: 'Team Members', type: 'team', expected: config.teamCount },
  ];
  
  let allPassed = true;
  
  for (const check of checks) {
    try {
      const actual = check.isProduct
        ? await wpCli.getProductCount()
        : await wpCli.getPostCount(check.type);
      
      const status = actual >= check.expected ? '✅' : '❌';
      const message = `${status} ${check.name}: ${actual}/${check.expected}`;
      
      if (actual >= check.expected) {
        logger.success(message);
      } else {
        logger.error(message);
        allPassed = false;
      }
    } catch (error: any) {
      logger.error(`❌ ${check.name}: Failed to check (${error.message})`);
      allPassed = false;
    }
  }
  
  logger.info('');
  
  if (allPassed) {
    logger.success('All import counts verified!');
  } else {
    logger.error('Some imports did not meet expected counts');
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Verification failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Test verification script compiles**

```bash
cd scripts
npx tsx --check importers/verify-import.ts
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit verification script**

```bash
git add importers/verify-import.ts
git commit -m "feat: add import verification script"
```

---

## Phase 7: WordPress Site Setup

### Task 18: Create Local WordPress Site

**Files:**
- Create: `docs/SETUP.md`

**Interfaces:**
- Produces: WordPress site in Local with proper configuration

- [ ] **Step 1: Open Local by WP Engine**

Launch Local application

- [ ] **Step 2: Create new site**

Click "Create a new site" or "+" button

- [ ] **Step 3: Configure site settings**

```
Site Name: Alpine Outfitters
Local Site Domain: alpineoutfitters.local
Environment: Preferred (or Custom with PHP 8.2+)
WordPress Version: 7.0 or later
```

- [ ] **Step 4: Set WordPress credentials**

```
WordPress Username: admin
WordPress Password: (choose a secure password)
WordPress Email: admin@alpineoutfitters.local
```

- [ ] **Step 5: Start the site**

Click "Start Site" and wait for services to initialize

- [ ] **Step 6: Verify site is running**

Visit `http://alpineoutfitters.local` in browser
Expected: WordPress site loads with default theme

- [ ] **Step 7: Document setup in docs/SETUP.md**

Create documentation file in main repo:

```bash
cd /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo
cat > docs/SETUP.md << 'EOF'
# Alpine Outfitters Setup Guide

## Prerequisites

- [Local by WP Engine](https://localwp.com/) 9.0.0+
- Node.js 18+
- Anthropic API key (for content generation)

## Step 1: Create Local WordPress Site

1. Open Local by WP Engine
2. Create new site:
   - Name: "Alpine Outfitters"
   - Domain: `alpineoutfitters.local`
   - Environment: PHP 8.2+, WordPress 7.0+
3. WordPress Admin Credentials:
   - Username: `admin`
   - Password: (your choice)

## Step 2: Install Required Plugins

SSH into site or use WP Admin:

```bash
# Required plugins
- WooCommerce 9.x
- Advanced Custom Fields Pro
- WP AI Experiments
- WPE Hub Plugin (for Intelligent Web)
- Yoast SEO or Rank Math
```

## Step 3: Generate Content

```bash
cd scripts
npm install
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# Generate all content
npm run generate:all

# This creates JSON files in data/ directory
```

## Step 4: Import Content to WordPress

```bash
# Import all content types
npm run import:all --site alpineoutfitters.local

# Verify import
npm run verify --site alpineoutfitters.local
```

## Step 5: Index with Nexus AI

```bash
# Reindex site for semantic search
nexus scan reindex --site alpineoutfitters.local

# Test search
nexus search "winter camping" --site alpineoutfitters.local
```

## Step 6: Deploy to WP Engine (Optional)

See deployment section in main README.
EOF
```

- [ ] **Step 8: Commit setup documentation**

```bash
git add docs/SETUP.md
git commit -m "docs: add WordPress site setup guide"
```

---

### Task 19: Install WordPress Plugins

**Files:**
- None (manual installation in WordPress)

**Interfaces:**
- Consumes: Running WordPress site from Task 18
- Produces: WordPress with WooCommerce, ACF Pro, AI features installed

- [ ] **Step 1: Install WooCommerce**

```bash
# Via WP-CLI
wp plugin install woocommerce --activate --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

Expected: WooCommerce installed and activated

- [ ] **Step 2: Install Advanced Custom Fields Pro**

Upload ACF Pro zip via WP Admin → Plugins → Add New → Upload Plugin
OR place in `wp-content/plugins/` and activate via WP-CLI

- [ ] **Step 3: Install WP AI Experiments**

```bash
wp plugin install wp-ai-experiments --activate --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

- [ ] **Step 4: Install Yoast SEO**

```bash
wp plugin install wordpress-seo --activate --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

- [ ] **Step 5: Install WPE Hub Plugin (for Intelligent Web)**

Download from WP Engine, upload via WP Admin

- [ ] **Step 6: Verify all plugins active**

```bash
wp plugin list --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

Expected: All plugins show `active` status

---

### Task 20: Configure WooCommerce

**Files:**
- None (WooCommerce setup wizard)

**Interfaces:**
- Consumes: WooCommerce plugin from Task 19
- Produces: Configured store settings

- [ ] **Step 1: Run WooCommerce Setup Wizard**

Visit: `http://alpineoutfitters.local/wp-admin/admin.php?page=wc-setup-checklist`

- [ ] **Step 2: Configure store details**

```
Store Address: 123 Mountain Way
City: Boulder
State: Colorado
ZIP: 80301
Country: United States
Currency: USD
```

- [ ] **Step 3: Configure shipping**

Enable "Flat Rate" shipping: $10.00

- [ ] **Step 4: Configure tax settings**

Enable tax calculation (or disable for demo simplicity)

- [ ] **Step 5: Configure payments**

Skip payment setup (demo site, not processing real payments)

- [ ] **Step 6: Verify WooCommerce ready**

Visit: Shop page should exist at `http://alpineoutfitters.local/shop`

---

---

### Task 21: Create ACF Field Groups

**Files:**
- Create: `wp-content/plugins/alpine-acf-config/acf-json/` (field group exports)

**Interfaces:**
- Consumes: ACF Pro from Task 19
- Produces: Custom post types (trip, destination, team) with ACF fields configured

- [ ] **Step 1: Create Trip custom post type**

```bash
# Via WP Admin → Custom Post Types → Add New
# OR via wp eval:
wp eval 'register_post_type("trip", ["public" => true, "label" => "Trips", "supports" => ["title", "editor", "thumbnail"]]);' --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

- [ ] **Step 2: Create ACF field group for Trips**

WP Admin → Custom Fields → Add New:

```
Field Group Name: Trip Details
Location: Post Type is equal to trip

Fields:
1. Duration (Number) - Required
2. Difficulty Rating (Range, 1-5) - Required
3. Price Per Person (Number, prepend $) - Required
4. Group Size Min (Number)
5. Group Size Max (Number)
6. Itinerary (Repeater)
   - Day (Number)
   - Activities (Textarea)
7. Season (Checkbox: Spring, Summer, Fall, Winter)
8. Region (Select: Pacific Northwest, Sierra Nevada, Rocky Mountains, Desert Southwest, Eastern Mountains)
9. Related Destinations (Relationship: Post Type = destination)
10. Required Gear (Relationship: Post Type = product)
```

- [ ] **Step 3: Export Trip field group to JSON**

ACF Pro → Tools → Export Field Groups → Select "Trip Details" → Generate Export Code → Copy JSON

Save to: `wp-content/plugins/alpine-acf-config/acf-json/group_trip.json`

- [ ] **Step 4: Create Destination custom post type**

```bash
wp eval 'register_post_type("destination", ["public" => true, "label" => "Destinations", "supports" => ["title", "editor", "thumbnail"]]);' --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

- [ ] **Step 5: Create ACF field group for Destinations**

WP Admin → Custom Fields → Add New:

```
Field Group Name: Destination Details
Location: Post Type is equal to destination

Fields:
1. Distance (Number, step 0.1, append "miles")
2. Elevation Gain (Number, append "feet")
3. Difficulty Rating (Range, 1-5)
4. Trail Type (Select: Loop, Out-and-back, Point-to-point)
5. Trailhead GPS (Text, placeholder "47.6062, -122.3321")
6. Permits Required (True/False)
7. Permit Details (Textarea, conditional on Permits Required = Yes)
8. Best Seasons (Checkbox: Spring, Summer, Fall, Winter)
9. Region (Select: same as Trip)
10. Related Trips (Relationship: Post Type = trip)
11. Recommended Gear (Relationship: Post Type = product)
```

- [ ] **Step 6: Export Destination field group**

Save to: `wp-content/plugins/alpine-acf-config/acf-json/group_destination.json`

- [ ] **Step 7: Create Team custom post type**

```bash
wp eval 'register_post_type("team", ["public" => true, "label" => "Team", "supports" => ["title", "editor", "thumbnail"]]);' --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

- [ ] **Step 8: Create ACF field group for Team**

WP Admin → Custom Fields → Add New:

```
Field Group Name: Team Member Details
Location: Post Type is equal to team

Fields:
1. Years Experience (Number)
2. Certifications (Repeater)
   - Certification Name (Text)
3. Specialties (Repeater)
   - Specialty (Text)
4. Email (Email)
5. Favorite Destinations (Relationship: Post Type = destination)
6. Guided Trips (Relationship: Post Type = trip)
```

- [ ] **Step 9: Export Team field group**

Save to: `wp-content/plugins/alpine-acf-config/acf-json/group_team.json`

- [ ] **Step 10: Commit ACF configurations to repo**

```bash
cd /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo
git add wp-content/plugins/alpine-acf-config/
git commit -m "feat: add ACF field groups for trips, destinations, team"
```

---

### Task 22: Execute Content Import

**Files:**
- None (executes import scripts from Task 16)

**Interfaces:**
- Consumes: Generated JSON from Task 15, WP-CLI importer from Task 16, WordPress with ACF from Task 21
- Produces: 500+ content items imported into WordPress

- [ ] **Step 1: Verify site is running**

```bash
wp cli info --path=~/Local\ Sites/alpineoutfitters.local/app/public
```

Expected: Shows WordPress 7.0+, PHP 8.2+

- [ ] **Step 2: Generate all content**

```bash
cd /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo/scripts
npm run generate:all
```

Expected: Creates 6 JSON files in `data/` directory
This will take 30-60 minutes depending on API rate limits

- [ ] **Step 3: Import blog posts**

```bash
npm run import:posts --site alpineoutfitters.local
```

Expected: 300 posts imported

- [ ] **Step 4: Import products**

```bash
npm run import:products --site alpineoutfitters.local
```

Expected: 200 products imported

- [ ] **Step 5: Import trips**

```bash
npm run import:trips --site alpineoutfitters.local
```

Expected: 30 trips imported

- [ ] **Step 6: Import destinations**

```bash
npm run import:destinations --site alpineoutfitters.local
```

Expected: 40 destinations imported

- [ ] **Step 7: Import pages**

```bash
npm run import:pages --site alpineoutfitters.local
```

Expected: 30 pages imported

- [ ] **Step 8: Import team members**

```bash
npm run import:team --site alpineoutfitters.local
```

Expected: 12 team members imported

- [ ] **Step 9: Verify all imports**

```bash
npm run verify --site alpineoutfitters.local
```

Expected: All counts meet or exceed targets

- [ ] **Step 10: Spot-check content in browser**

Visit `http://alpineoutfitters.local` and verify:
- Blog posts appear with categories/tags
- Products show with prices and attributes
- Trips display with ACF fields (duration, difficulty, itinerary)
- Destinations show with ACF fields (distance, elevation, GPS)

---

### Task 23: Index Site with Nexus AI

**Files:**
- None (uses Nexus CLI)

**Interfaces:**
- Consumes: WordPress site with 500+ content items from Task 22
- Produces: LanceDB vector index with semantic search enabled

- [ ] **Step 1: Verify Nexus AI addon is active**

```bash
nexus doctor
```

Expected: All checks pass (Local running, addon active, MCP server running)

- [ ] **Step 2: Trigger full site reindex**

```bash
nexus scan reindex --site alpineoutfitters.local
```

Expected: Indexing starts, shows progress
This will take 5-10 minutes for 500+ items

- [ ] **Step 3: Wait for indexing to complete**

Monitor progress in terminal output
Expected: "Indexing complete. Indexed X documents in Y chunks."

- [ ] **Step 4: Check index status**

```bash
nexus scan status --site alpineoutfitters.local
```

Expected: Shows "Searchable" status with document counts matching imported content

- [ ] **Step 5: Test semantic search - Cross-content query**

```bash
nexus search "winter camping gear for Colorado" --site alpineoutfitters.local
```

Expected: Results include blog posts, products, trips, and destinations related to winter camping

- [ ] **Step 6: Test semantic search - Attribute matching**

```bash
nexus search "lightweight 3-season tent under $300" --site alpineoutfitters.local
```

Expected: Product results matching price/season/weight constraints

- [ ] **Step 7: Test semantic search - Geographic precision**

```bash
nexus search "trails near Seattle" --site alpineoutfitters.local
```

Expected: Destinations in Pacific Northwest region

- [ ] **Step 8: Verify index in Nexus dashboard**

Open Local → Alpine Outfitters → Nexus AI tab
Expected: Shows document count, index size, last indexed timestamp

---

### Task 24: Create WPE Site and Environments

**Files:**
- None (WPE portal operations)

**Interfaces:**
- Consumes: WPE account access
- Produces: 3 WPE environments (Production, Staging, Development)

- [ ] **Step 1: Log into WPE portal**

Visit: `https://my.wpengine.com`
Authenticate with WPE credentials

- [ ] **Step 2: Create new site**

Portal → Sites → Create New Site

```
Site Name: Alpine Outfitters
```

- [ ] **Step 3: Create Production environment**

```
Environment Name: Production
Install Name: alpineoutfitters
```

Wait for provisioning (5-10 minutes)

- [ ] **Step 4: Note Production URLs**

```
WordPress Admin: https://alpineoutfitters.wpengine.com/wp-admin
SFTP Host: alpineoutfitters.sftp.wpengine.com
```

- [ ] **Step 5: Create Staging environment**

Portal → Alpine Outfitters → Add Environment

```
Environment Type: Staging
Install Name: alpineoutfitters-staging
```

- [ ] **Step 6: Create Development environment**

Portal → Alpine Outfitters → Add Environment

```
Environment Type: Development  
Install Name: alpineoutfitters-dev
```

- [ ] **Step 7: Verify all 3 environments active**

Portal → Alpine Outfitters → Environments
Expected: Production, Staging, Development all show "Active"

- [ ] **Step 8: Configure SSH access**

Ensure your SSH key is added to WPE account:
Portal → User Profile → SSH Keys → Add Key

---

### Task 25: Push Local Site to WPE Production

**Files:**
- None (Nexus CLI operations)

**Interfaces:**
- Consumes: Local site (Task 22), WPE Production environment (Task 24), Nexus CLI
- Produces: Local site deployed to WPE Production with database

- [ ] **Step 1: Verify Nexus can reach WPE**

```bash
nexus wpe status
```

Expected: Shows authenticated WPE account info

- [ ] **Step 2: Link Local site to WPE install**

```bash
nexus wpe link --local alpineoutfitters.local --remote alpineoutfitters
```

Expected: Link created successfully

- [ ] **Step 3: Export Local site as backup**

```bash
nexus export --site alpineoutfitters.local --output ~/backups/alpine-pre-push-$(date +%Y%m%d).zip
```

Expected: Backup created (safety measure before push)

- [ ] **Step 4: Push Local to WPE Production (files + database)**

```bash
nexus wpe push --site alpineoutfitters.local --environment production --include-database
```

**IMPORTANT:** This is Tier 3 destructive. Confirm when prompted.

Expected: Push starts, shows file transfer progress
This will take 10-20 minutes for full site + database

- [ ] **Step 5: Monitor push progress**

```bash
nexus local operation-status --site alpineoutfitters.local
```

Poll every 30 seconds until status shows "completed"

- [ ] **Step 6: Verify Production site is live**

Visit: `https://alpineoutfitters.wpengine.com`
Expected: Site loads with all content visible

- [ ] **Step 7: Verify Production WP Admin**

Visit: `https://alpineoutfitters.wpengine.com/wp-admin`
Login with WordPress credentials from Local
Expected: Dashboard shows 300 posts, 200 products, etc.

- [ ] **Step 8: Clone Production to Staging and Dev**

WPE Portal → Alpine Outfitters → Production → Actions → Copy to Staging
WPE Portal → Alpine Outfitters → Production → Actions → Copy to Development

Wait for clones to complete (10-15 minutes each)

- [ ] **Step 9: Verify all 3 environments have content**

```bash
# Check each environment
wp post list --post_type=post --format=count --ssh=alpineoutfitters@alpineoutfitters.ssh.wpengine.net
wp post list --post_type=post --format=count --ssh=alpineoutfitters@alpineoutfitters-staging.ssh.wpengine.net
```

Expected: All show ~300 posts

---

### Task 26: Connect Sites to WPE Intelligent Web (Power)

**Files:**
- None (Hub Plugin OAuth flow)

**Interfaces:**
- Consumes: WPE environments from Task 25, WPE Hub Plugin
- Produces: All 3 environments connected to same Power project

- [ ] **Step 1: Ensure Hub Plugin installed on Production**

```bash
# SSH into Production
ssh alpineoutfitters@alpineoutfitters.ssh.wpengine.net
cd ~/wp-content/plugins
ls | grep wpe-hub
```

If not present, upload via WP Admin or SFTP

- [ ] **Step 2: Activate Hub Plugin on Production**

WP Admin → Plugins → WP Engine Hub → Activate

- [ ] **Step 3: Start OAuth flow on Production**

```bash
# Via Nexus MCP tool (if available)
iw_connect_site --site alpineoutfitters
```

OR manually: WP Admin → Settings → WP Engine → Connect to Power

- [ ] **Step 4: Complete OAuth in browser**

Browser opens → Log into WP Engine Power account → Authorize

Expected: "Connected to Power project" confirmation

- [ ] **Step 5: Verify connection**

```bash
iw_get_connection_status --site alpineoutfitters
```

Expected: Shows project_id, client_id, account_id

- [ ] **Step 6: Repeat OAuth flow for Staging**

WP Admin on Staging → Settings → WP Engine → Connect to Power
Complete OAuth (use SAME Power project as Production)

- [ ] **Step 7: Repeat OAuth flow for Development**

WP Admin on Dev → Settings → WP Engine → Connect to Power  
Complete OAuth (use SAME Power project)

- [ ] **Step 8: Verify all 3 environments connected to same project**

Check each environment's WP Admin → Settings → WP Engine
Expected: All show same project_id

---

### Task 27: Sync Content to Power Knowledge Bases

**Files:**
- None (Hub Plugin sync operations)

**Interfaces:**
- Consumes: Power-connected environments from Task 26
- Produces: 5 KB collections per environment (blog, products, trips, destinations, pages)

- [ ] **Step 1: Access Hub Plugin KB settings on Production**

WP Admin → WP Engine → Knowledge Bases

- [ ] **Step 2: Create KB collection for blog posts**

```
Collection Name: alpine-prod-blog
Content Source: Posts (post_type = post)
Sync Frequency: Hourly
```

Click "Create Collection"

- [ ] **Step 3: Create KB collection for products**

```
Collection Name: alpine-prod-products
Content Source: Products (post_type = product)
Sync Frequency: Hourly
```

- [ ] **Step 4: Create KB collection for trips**

```
Collection Name: alpine-prod-trips
Content Source: Trips (post_type = trip)
Sync Frequency: Hourly
```

- [ ] **Step 5: Create KB collection for destinations**

```
Collection Name: alpine-prod-destinations  
Content Source: Destinations (post_type = destination)
Sync Frequency: Hourly
```

- [ ] **Step 6: Trigger initial sync on all collections**

Hub Plugin → Knowledge Bases → Click "Sync Now" for each collection

Expected: Sync starts, shows progress

- [ ] **Step 7: Monitor sync completion**

```bash
iw_list_kb_collections --site alpineoutfitters
```

Expected: Shows all 5 collections with document counts matching WordPress content

- [ ] **Step 8: Test KB search via Power API**

```bash
iw_search_kb --site alpineoutfitters --collection-id alpine-prod-blog --query "winter camping tips"
```

Expected: Returns relevant blog post excerpts

- [ ] **Step 9: Repeat KB setup for Staging environment**

Create collections: `alpine-staging-blog`, `alpine-staging-products`, etc.
Trigger initial sync

- [ ] **Step 10: Repeat KB setup for Development environment**

Create collections: `alpine-dev-blog`, `alpine-dev-products`, etc.
Trigger initial sync

---

### Task 28: Test All Demo Scenarios

**Files:**
- Create: `docs/TESTING-CHECKLIST.md`

**Interfaces:**
- Consumes: Fully deployed site (Tasks 22-27)
- Produces: Validated demo scenarios

- [ ] **Step 1: Create testing checklist document**

```bash
cd /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo
cat > docs/TESTING-CHECKLIST.md << 'EOF'
# Alpine Outfitters Demo Testing Checklist

## Semantic Search Scenarios (Nexus AI)

### Scenario 1: Cross-Content-Type Query
- [ ] Query: "winter camping gear for Colorado"
- [ ] Returns blog posts about winter camping
- [ ] Returns winter-rated sleeping bags and tents (products)
- [ ] Returns winter trips in Rocky Mountains
- [ ] Returns Colorado destinations with winter season

### Scenario 2: Intent Understanding
- [ ] Query: "beginner backpacking trip"
- [ ] Returns trips with difficulty 1-2
- [ ] Returns beginner-focused blog posts
- [ ] Returns entry-level gear (packs, tents under $200)

### Scenario 3: Attribute Matching
- [ ] Query: "lightweight 3-season tent under $300"
- [ ] Returns products with price < $300
- [ ] Returns products with 3-season rating
- [ ] Returns products with weight < 4 lbs

### Scenario 4: Seasonal Intelligence
- [ ] Query: "summer hiking Washington"
- [ ] Returns Pacific Northwest destinations
- [ ] Returns trips with Summer season
- [ ] Returns summer-appropriate gear

### Scenario 5: Geographic Precision
- [ ] Query: "trails near Seattle"
- [ ] Returns Pacific Northwest destinations
- [ ] Returns blog posts mentioning Seattle/Cascades
- [ ] Returns local day trips

## Fleet Management Scenarios

### Scenario 1: Drift Detection
- [ ] Run: `nexus drift detect --baseline alpineoutfitters-production --compare alpineoutfitters-staging`
- [ ] Shows version differences (if any)

### Scenario 2: Fleet Search
- [ ] Run: `nexus search "avalanche safety" --all`
- [ ] Returns results from all environments (Prod, Staging, Dev, Local)

## Database Health Scenarios

### Scenario 1: Health Scan
- [ ] Run: `nexus wp db scan --site alpineoutfitters.local`
- [ ] Returns health score 0-100
- [ ] Identifies bloat (post revisions, orphaned meta)

### Scenario 2: Cleanup Preview
- [ ] Run: `nexus wp db clean --site alpineoutfitters.local --dry-run`
- [ ] Shows what would be deleted without deleting

## WP AI Features (Production Site)

### Scenario 1: Title Generation
- [ ] Create new blog post in WP Admin
- [ ] Write content about backpacking
- [ ] Click "Generate Title"
- [ ] Verify AI generates relevant title

### Scenario 2: Content Summary
- [ ] Open existing long blog post
- [ ] Click "Generate Summary"
- [ ] Verify 2-3 sentence summary appears

### Scenario 3: Alt Text Generation
- [ ] Upload product image
- [ ] Click "Generate Alt Text"
- [ ] Verify descriptive alt text generated

## Knowledge Base Search (Power)

### Scenario 1: KB Search via MCP
- [ ] Run: `iw_search_kb --site alpineoutfitters --collection-id alpine-prod-blog --query "hiking tips"`
- [ ] Returns relevant blog excerpts with citations

### Scenario 2: Cross-Collection Search
- [ ] Search blog, products, trips KB collections
- [ ] Verify results match WordPress content

## Performance Benchmarks

### Page Load Times (Production)
- [ ] Homepage: < 2 seconds
- [ ] Product page: < 1.5 seconds
- [ ] Blog archive: < 2 seconds

### Nexus Operations
- [ ] Semantic search: < 3 seconds
- [ ] Full reindex: < 10 minutes
- [ ] DB health scan: < 30 seconds
EOF
```

- [ ] **Step 2: Execute all semantic search scenarios**

Run each query from checklist, verify results match expectations

- [ ] **Step 3: Execute fleet management scenarios**

Test drift detection, fleet search, bulk operations

- [ ] **Step 4: Execute database health scenarios**

Test scan and cleanup preview commands

- [ ] **Step 5: Execute WP AI features scenarios**

Test in Production WP Admin (requires AI provider configured)

- [ ] **Step 6: Execute Knowledge Base scenarios**

Test Power API searches via Nexus MCP tools

- [ ] **Step 7: Measure performance benchmarks**

Use browser dev tools, time Nexus commands

- [ ] **Step 8: Document any failures**

Note which scenarios failed, investigate root causes

- [ ] **Step 9: Fix critical failures**

Address any blocking issues found during testing

- [ ] **Step 10: Commit testing checklist**

```bash
git add docs/TESTING-CHECKLIST.md
git commit -m "docs: add comprehensive testing checklist"
```

---

### Task 29: Final Documentation

**Files:**
- Update: `README.md`
- Create: `docs/GENERATION.md`
- Copy: Design spec to repo

**Interfaces:**
- Produces: Complete documentation for the demo site

- [ ] **Step 1: Create generation guide**

```bash
cd /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo
cat > docs/GENERATION.md << 'EOF'
# Content Generation Guide

## Overview

The Alpine Outfitters content is AI-generated using TypeScript scripts that call the Anthropic Claude API.

## Prerequisites

- Node.js 18+
- Anthropic API key (sign up at anthropic.com)

## Setup

```bash
cd scripts
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

## Generating Content

### Generate All Content Types

```bash
npm run generate:all
```

This generates:
- 300 blog posts (30-60 minutes)
- 200 products (20-40 minutes)
- 30 trips (5-10 minutes)
- 40 destinations (5-10 minutes)
- 30 pages (5-10 minutes)
- 12 team members (2-5 minutes)

**Total time: 1-2 hours** depending on API rate limits

### Generate Individual Content Types

```bash
npm run generate:posts      # Blog posts only
npm run generate:products   # Products only
npm run generate:trips      # Trips only
npm run generate:destinations
npm run generate:pages
npm run generate:team
```

## Output

Generated content is saved to `data/` directory as JSON files:
- `data/posts.json`
- `data/products.json`
- `data/trips.json`
- `data/destinations.json`
- `data/pages.json`
- `data/team.json`

These files are git-ignored (too large). The scripts are version-controlled and can regenerate content.

## Customization

### Adjusting Counts

Edit `.env` file:

```bash
POSTS_COUNT=500        # Default: 300
PRODUCTS_COUNT=300     # Default: 200
TRIPS_COUNT=50         # Default: 30
```

### Changing AI Model

Edit `.env` file:

```bash
AI_MODEL=claude-3-5-sonnet-20241022  # Default
# OR
AI_MODEL=gpt-4-turbo   # Requires OPENAI_API_KEY
```

### Customizing Prompts

Edit files in `scripts/prompts/`:
- `post-templates.ts` - Blog post topics and prompts
- `product-templates.ts` - Product categories and attributes
- `trip-templates.ts` - Trip types and itineraries
- `destination-templates.ts` - Trail types and regions

## Cost Estimation

Approximate API costs (Anthropic Claude 3.5 Sonnet):
- 300 blog posts: ~$8-12
- 200 products: ~$5-8
- 30 trips: ~$2-3
- 40 destinations: ~$2-3
- 30 pages: ~$2-3
- 12 team: ~$1

**Total: ~$20-30** for complete content generation

## Troubleshooting

### API Rate Limits

If you hit rate limits, increase the delay:

```bash
# In .env
GENERATION_DELAY_MS=2000  # Default: 1000
```

### Generation Failures

Scripts include retry logic (3 attempts by default). If a request fails after retries, it will be logged but generation continues.

Check logs for failed items and regenerate individually if needed.
EOF
```

- [ ] **Step 2: Update main README**

```bash
cat > README.md << 'EOF'
# Alpine Outfitters Demo Site

Production-scale WordPress demo showcasing Nexus AI fleet management and WP Engine Intelligent Web (Power/Extend) capabilities.

## Overview

- **500+ AI-generated content pieces** (blog posts, products, trips, destinations)
- **Nexus AI integration** - Semantic search, fleet management, database health
- **WP Engine Intelligent Web** - Power KB sync, AI features, multi-environment
- **Custom post types** - Trips, Destinations, Team with ACF Pro
- **WooCommerce** - 200 products with variations and attributes

## Quick Start

See [SETUP.md](docs/SETUP.md) for detailed instructions.

```bash
# 1. Generate content
cd scripts
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm run generate:all

# 2. Import to Local site (requires site "alpineoutfitters.local")
npm run import:all --site alpineoutfitters.local

# 3. Index with Nexus AI
nexus scan reindex --site alpineoutfitters.local

# 4. Test semantic search
nexus search "winter camping" --site alpineoutfitters.local
```

## Documentation

- [Design Specification](docs/design.md) - Complete design doc
- [Setup Guide](docs/SETUP.md) - WordPress site setup
- [Generation Guide](docs/GENERATION.md) - How to generate content
- [Testing Checklist](docs/TESTING-CHECKLIST.md) - Demo scenarios

## Architecture

**Content Generation:** TypeScript + Anthropic Claude API → JSON  
**Import:** WP-CLI batch import  
**Indexing:** Nexus AI (LanceDB + ONNX embeddings)  
**Deployment:** Local → WPE (Production, Staging, Development)  
**KB Sync:** WPE Hub Plugin → Power Knowledge Bases

## Content

| Type | Count | Details |
|------|-------|---------|
| Blog Posts | 300 | 6 categories, 100 tags, varied lengths |
| Products | 200 | 10 categories, attributes, variations |
| Trips | 30 | ACF fields, itineraries, relationships |
| Destinations | 40 | ACF fields, GPS, trail info |
| Pages | 30 | About, FAQs, resources, policies |
| Team | 12 | Guides and staff with bios |

## Tech Stack

- **WordPress:** 7.0+
- **WooCommerce:** 9.x
- **ACF Pro:** Custom fields and relationships
- **WP AI Experiments:** Title/summary/alt text generation
- **WPE Hub Plugin:** Intelligent Web integration
- **Nexus AI:** Fleet management and semantic search
- **Node.js:** 18+ (content generation)
- **TypeScript:** Content generation scripts

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Local | `alpineoutfitters.local` | Development and testing |
| Production | `alpineoutfitters.wpengine.com` | Stable demo site |
| Staging | `alpineoutfitters-staging.wpengine.com` | Testing updates |
| Development | `alpineoutfitters-dev.wpengine.com` | Experimental |

## License

Demo site for internal use. Content is AI-generated for demonstration purposes.
EOF
```

- [ ] **Step 3: Copy design spec to repo docs**

```bash
cp /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/docs/superpowers/specs/2026-07-27-alpine-outfitters-design.md \
   /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo/docs/design.md
```

- [ ] **Step 4: Commit all documentation**

```bash
git add README.md docs/
git commit -m "docs: add comprehensive documentation (README, GENERATION, design spec)"
```

---

### Task 30: Final Validation Checklist

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: Completed demo site from all prior tasks
- Produces: Validated, demo-ready site

- [ ] **Step 1: Verify content completeness**

```bash
# Local site
wp post list --post_type=post --format=count --path=~/Local\ Sites/alpineoutfitters.local/app/public
# Expected: 300

wp wc product list --format=count --path=~/Local\ Sites/alpineoutfitters.local/app/public
# Expected: 200

# Repeat for trips (30), destinations (40), pages (30), team (12)
```

All counts meet targets: ✅

- [ ] **Step 2: Verify Nexus AI indexing**

```bash
nexus scan status --site alpineoutfitters.local
```

Expected: "Searchable" status, ~500 documents indexed ✅

- [ ] **Step 3: Verify WPE environments accessible**

Visit each URL and verify site loads:
- [ ] `https://alpineoutfitters.wpengine.com` ✅
- [ ] `https://alpineoutfitters-staging.wpengine.com` ✅
- [ ] `https://alpineoutfitters-dev.wpengine.com` ✅

- [ ] **Step 4: Verify Power KB connections**

```bash
iw_get_connection_status --site alpineoutfitters
iw_list_kb_collections --site alpineoutfitters
```

Expected: Connected to Power, 5 collections with content ✅

- [ ] **Step 5: Verify ACF fields display**

Visit Production site:
- [ ] Open a Trip post → ACF fields show (duration, difficulty, itinerary)
- [ ] Open a Destination post → ACF fields show (distance, elevation, GPS)
- [ ] Open a Team member → ACF fields show (certifications, specialties)

- [ ] **Step 6: Verify WooCommerce products**

- [ ] Product pages load with images, prices, add to cart
- [ ] Product variations work (size/color selection)
- [ ] Cart functionality works

- [ ] **Step 7: Test 3 semantic search scenarios**

Run from testing checklist (Section 6.1 scenarios 1, 3, 5)
All return relevant results: ✅

- [ ] **Step 8: Verify performance benchmarks**

- [ ] Homepage load time < 2s
- [ ] Semantic search < 3s
- [ ] Full reindex < 10 minutes

- [ ] **Step 9: Verify documentation complete**

- [ ] README.md with quickstart
- [ ] SETUP.md with detailed instructions
- [ ] GENERATION.md with content generation guide
- [ ] TESTING-CHECKLIST.md with all scenarios
- [ ] design.md (design spec)

- [ ] **Step 10: Create final checkpoint**

```bash
# Local backup
nexus export --site alpineoutfitters.local --output ~/backups/alpine-final-$(date +%Y%m%d).zip

# WPE backup (via portal)
# My WP Engine → Alpine Outfitters → Production → Create Backup
# Add label: "Final validated demo site"
```

**All validation checks passed → Site is demo-ready ✅**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-alpine-outfitters-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**