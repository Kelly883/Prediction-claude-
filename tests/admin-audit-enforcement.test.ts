import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, sep } from 'path';

const ADMIN_DIR = join(process.cwd(), 'app', 'api', 'admin');

function findAdminRouteFiles(dir: string = ADMIN_DIR): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAdminRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

function hasMutationExports(content: string): boolean {
  const mutationPattern = /export\s+async\s+function\s+(POST|PATCH|DELETE|PUT)\s*\(/g;
  return mutationPattern.test(content);
}

function hasPrismaMutation(content: string): boolean {
  // Matches prisma mutation calls: .create(, .update(, .delete(, .upsert(, .updateMany(
  const mutationPattern = /\.(create|update|delete|upsert|updateMany)\s*\(/g;
  return mutationPattern.test(content);
}

describe('admin route audit enforcement', () => {
  const files = findAdminRouteFiles();

  it('finds at least one admin route file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.replace(process.cwd() + sep, '')} — mutation routes must call writeAudit`, () => {
      const content = readFileSync(file, 'utf8');

      if (!hasMutationExports(content) || !hasPrismaMutation(content)) {
        return;
      }

      expect(content, `${file} should import writeAudit`).toMatch(/import\s+.*writeAudit.*from\s+['"]@\/lib\/audit['"]/);
      expect(content, `${file} should call writeAudit in mutation handlers`).toMatch(/writeAudit\s*\(/);
    });
  }
});
