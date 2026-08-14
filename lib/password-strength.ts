// Simple heuristic scorer — not trying to be NIST-grade, just enough signal
// to nudge people away from "password123" toward something meaningfully
// harder to guess. Server-side validation (RegisterSchema: min 8 chars)
// remains the actual enforced rule; this is UI guidance only.
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) return { score: 0, label: '' };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score: clamped, label: labels[clamped] };
}
