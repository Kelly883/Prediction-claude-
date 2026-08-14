import bcrypt from 'bcryptjs';

// Split out from lib/auth.ts deliberately: middleware.ts runs on the Edge
// runtime and imports lib/auth.ts for verifyAccessToken. bcryptjs isn't
// Edge-compatible, and Next.js's build flagged it getting pulled into the
// Edge bundle transitively even though middleware never calls these
// functions — importing a module imports all of it. Keeping password
// hashing in its own file (imported only by the Node-runtime auth routes)
// stops that leak entirely rather than just suppressing the warning.
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
