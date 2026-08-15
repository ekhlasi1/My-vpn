#!/usr/bin/env node

/**
 * UUID Generator Script
 * 
 * This script generates secure UUIDs for use with FoxCloud.
 * 
 * Usage:
 *   node scripts/generate-uuid.js [count]
 * 
 * Examples:
 *   node scripts/generate-uuid.js        # Generate 1 UUID
 *   node scripts/generate-uuid.js 5      # Generate 5 UUIDs
 */

import { randomUUID } from 'crypto';

// Get the number of UUIDs to generate from command line arguments
const count = process.argv[2] ? parseInt(process.argv[2], 10) : 1;

// Validate the count
if (isNaN(count) || count <= 0) {
  console.error('Please provide a valid positive number');
  process.exit(1);
}

// Generate and display UUIDs
console.log(`Generating ${count} UUID(s):\n`);

const uuids = [];
for (let i = 0; i < count; i++) {
  const uuid = randomUUID();
  uuids.push(uuid);
  console.log(`${i + 1}. ${uuid}`);
}

// If generating multiple UUIDs, also show comma-separated format
if (count > 1) {
  console.log('\nComma-separated format for wrangler.toml:');
  console.log(`UUID = "${uuids.join(',')}"`);
}

console.log('\nThese UUIDs can be used in your FoxCloud configuration.');