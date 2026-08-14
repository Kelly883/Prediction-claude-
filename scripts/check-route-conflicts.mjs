// `next build` does NOT catch conflicting dynamic segment names at the same
// route level (e.g. app/api/x/[id]/ and app/api/x/[postId]/ as siblings) —
// confirmed by testing directly: a build with exactly this conflict present
// succeeded silently, and it only surfaced as a runtime 500 in production,
// on a COMPLETELY UNRELATED route (Next.js's route manifest is global, so
// one conflict can break routing app-wide, not just for the conflicting
// paths). This script is the safeguard `next build` doesn't provide.
//
// Run: node scripts/check-route-conflicts.mjs
// Wired into CI (ci.yml) as a required step before the build.

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function findDynamicDirs(dir, results = new Map()) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  const dynamicChildren = [];
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;

    if (entry.startsWith('[') && entry.endsWith(']')) {
      dynamicChildren.push(entry);
    }
    findDynamicDirs(full, results);
  }

  if (dynamicChildren.length > 0) {
    const distinct = new Set(dynamicChildren);
    if (distinct.size > 1) {
      results.set(dir, [...distinct]);
    }
  }

  return results;
}

const conflicts = findDynamicDirs('app');

if (conflicts.size > 0) {
  console.error('❌ Conflicting dynamic route segment names found:\n');
  for (const [dir, names] of conflicts) {
    console.error(`  ${dir}: ${names.join(' vs ')}`);
  }
  console.error(
    '\nAll dynamic segments at the same directory level must use the same parameter name across the ENTIRE app — Next.js builds one global route manifest, so this breaks routing everywhere, not just for these paths.',
  );
  process.exit(1);
} else {
  console.log('✓ No conflicting dynamic route segment names.');
}
