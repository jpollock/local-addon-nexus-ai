#!/usr/bin/env node
/**
 * Check what's in Local's userData for index registry
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Local's userData path
const localData = path.join(os.homedir(), 'Library', 'Application Support', 'Local');

// Try to find storage files
console.log('Checking Local userData...\n');
console.log('Path:', localData);

// userData files are typically JSON
const files = fs.readdirSync(localData).filter(f => f.includes('nexus') || f.endsWith('.json'));
console.log('\nFiles containing "nexus" or .json:');
files.forEach(f => console.log('  -', f));

// Try to find the specific key
const storageFile = path.join(localData, 'userData.json');
if (fs.existsSync(storageFile)) {
  console.log('\nFound userData.json, checking for nexus-ai_index_registry...');
  const data = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
  const registryKey = 'nexus-ai_index_registry';
  
  if (data[registryKey]) {
    const registry = data[registryKey];
    const entries = Object.values(registry);
    console.log(`\n✅ Found ${entries.length} registry entries`);
    
    const stateBreakdown = {};
    entries.forEach(e => {
      stateBreakdown[e.state] = (stateBreakdown[e.state] || 0) + 1;
    });
    console.log('State breakdown:', stateBreakdown);
    
    console.log('\nFirst 5 entries:');
    entries.slice(0, 5).forEach(e => {
      console.log(`  - ${e.siteName || e.siteId}: state=${e.state}, docs=${e.documentCount}, chunks=${e.chunkCount}`);
    });
  } else {
    console.log('❌ nexus-ai_index_registry key not found in userData.json');
    console.log('Available keys:', Object.keys(data).filter(k => k.includes('nexus')));
  }
} else {
  console.log('\n❌ userData.json not found at:', storageFile);
  console.log('\nTry searching for it:');
  console.log(`  find "${localData}" -name "*.json" -type f`);
}
