#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const CHECKS = [];

function addCheck(pattern, message, severity) {
  CHECKS.push({ pattern, message, severity });
}

addCheck(/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML usage', 'HIGH');
addCheck(/innerHTML\s*=|\.innerHTML/, 'innerHTML assignment', 'HIGH');
addCheck(/\beval\s*\(/, 'eval() usage', 'HIGH');
addCheck(/new\s+Function\s*\(/, 'new Function() usage', 'HIGH');
addCheck(/hardcoded\s+(password|secret|key|token)/i, 'Potential hardcoded secret', 'HIGH');
addCheck(/process\.env\.(JWT|SECRET|PASSWORD|API_KEY|TOKEN)\b[^=]*=/, 'Hardcoded env var value', 'HIGH');
addCheck(/redirect\(.*req\.|location\.href\s*=.*req\./, 'Unvalidated redirect', 'HIGH');
addCheck(/cookies\.set\([^,]+,\s*[^,]+,\s*{[^}]*secure:\s*false/i, 'Insecure cookie', 'HIGH');
addCheck(/http:\/\//, 'Hardcoded HTTP URL', 'MEDIUM');
addCheck(/console\.log\([^)]*password/i, 'Password logged', 'HIGH');
addCheck(/console\.log\([^)]*token/i, 'Token logged', 'HIGH');
addCheck(/console\.log\([^)]*secret/i, 'Secret logged', 'HIGH');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist' || entry.name === 'storage') continue;
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js') || entry.name.endsWith('.jsx')) {
      await scanFile(full);
    }
  }
}

async function scanFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('xmlns="http://www.w3.org/2000/svg"')) continue;
    for (const check of CHECKS) {
      if (check.pattern.test(line)) {
        console.log(`[${check.severity}] ${filePath}:${i + 1}: ${check.message}`);
        console.log(`  ${line.trim()}`);
      }
    }
  }
}

await walk(join(ROOT, 'app'));
await walk(join(ROOT, 'lib'));
await walk(join(ROOT, 'components'));
await walk(join(ROOT, 'scripts'));
