// Font configuration with standard system and Google Web font fallbacks.
// Avoids build-time network fetching errors in CI/offline/restricted environments (e.g. GitHub Actions).

export const display = {
  variable: '--font-display',
  className: 'font-display',
};

export const body = {
  variable: '--font-body',
  className: 'font-body',
};

export const mono = {
  variable: '--font-mono',
  className: 'font-mono',
};
