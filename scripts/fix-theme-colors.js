#!/usr/bin/env node
/**
 * Fix hardcoded colors to use CSS variables for dark/light mode support
 */

const fs = require('fs');
const path = require('path');

// Color mappings: hardcoded color → CSS variable
const colorMappings = [
  // Background colors
  { pattern: /background:\s*'#fff'/g, replacement: "background: 'var(--color-background-primary, #fff)'" },
  { pattern: /background:\s*'#ffffff'/gi, replacement: "background: 'var(--color-background-primary, #fff)'" },
  { pattern: /background:\s*'white'/g, replacement: "background: 'var(--color-background-primary, #fff)'" },
  { pattern: /backgroundColor:\s*'#fff'/g, replacement: "backgroundColor: 'var(--color-background-primary, #fff)'" },
  { pattern: /backgroundColor:\s*'#ffffff'/gi, replacement: "backgroundColor: 'var(--color-background-primary, #fff)'" },
  { pattern: /backgroundColor:\s*'white'/g, replacement: "backgroundColor: 'var(--color-background-primary, #fff)'" },

  // Text colors - dark grays (primary text)
  { pattern: /color:\s*'#111'/g, replacement: "color: 'var(--color-text-primary, #111)'" },
  { pattern: /color:\s*'#111827'/g, replacement: "color: 'var(--color-text-primary, #111827)'" },
  { pattern: /color:\s*'#1f2937'/g, replacement: "color: 'var(--color-text-primary, #1f2937)'" },
  { pattern: /color:\s*'#374151'/g, replacement: "color: 'var(--color-text-primary, #374151)'" },
  { pattern: /color:\s*'black'/g, replacement: "color: 'var(--color-text-primary, #000)'" },

  // Text colors - medium grays (secondary text)
  { pattern: /color:\s*'#6b7280'/g, replacement: "color: 'var(--color-text-secondary, #6b7280)'" },
  { pattern: /color:\s*'#9ca3af'/g, replacement: "color: 'var(--color-text-secondary, #9ca3af)'" },
  { pattern: /color:\s*'#666'/g, replacement: "color: 'var(--color-text-secondary, #666)'" },
  { pattern: /color:\s*'#999'/g, replacement: "color: 'var(--color-text-tertiary, #999)'" },

  // Border colors
  { pattern: /border:\s*'1px solid #e5e7eb'/g, replacement: "border: '1px solid var(--color-border, #e5e7eb)'" },
  { pattern: /border:\s*'1px solid #d1d5db'/g, replacement: "border: '1px solid var(--color-border, #d1d5db)'" },
  { pattern: /borderColor:\s*'#e5e7eb'/g, replacement: "borderColor: 'var(--color-border, #e5e7eb)'" },
  { pattern: /borderColor:\s*'#d1d5db'/g, replacement: "borderColor: 'var(--color-border, #d1d5db)'" },
  { pattern: /borderBottom:\s*'1px solid #e5e7eb'/g, replacement: "borderBottom: '1px solid var(--color-border, #e5e7eb)'" },

  // Error/danger colors
  { pattern: /color:\s*'#ef4444'/g, replacement: "color: 'var(--color-error, #ef4444)'" },
  { pattern: /color:\s*'#dc2626'/g, replacement: "color: 'var(--color-error, #dc2626)'" },

  // Success/green colors
  { pattern: /color:\s*'#10b981'/g, replacement: "color: 'var(--color-success, #10b981)'" },
  { pattern: /backgroundColor:\s*'#10b981'/g, replacement: "backgroundColor: 'var(--color-success, #10b981)'" },

  // Brand color (WPE teal)
  { pattern: /color:\s*'#51bb7b'/g, replacement: "color: 'var(--color-brand-primary, #51bb7b)'" },
  { pattern: /backgroundColor:\s*'#51bb7b'/g, replacement: "backgroundColor: 'var(--color-brand-primary, #51bb7b)'" },
  { pattern: /background:\s*'#51bb7b'/g, replacement: "background: 'var(--color-brand-primary, #51bb7b)'" },
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  colorMappings.forEach(({ pattern, replacement }) => {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      modified = true;
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Updated: ${path.basename(filePath)}`);
    return true;
  }

  return false;
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  let totalUpdated = 0;

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      totalUpdated += processDirectory(filePath);
    } else if (file.match(/\.(tsx?|jsx?)$/) && !file.includes('.d.ts')) {
      if (processFile(filePath)) {
        totalUpdated++;
      }
    }
  });

  return totalUpdated;
}

// Process renderer components
const componentsDir = path.join(__dirname, '..', 'src', 'renderer', 'components');
console.log('Updating theme colors in renderer components...\n');
const updated = processDirectory(componentsDir);
console.log(`\n✓ Updated ${updated} files`);
