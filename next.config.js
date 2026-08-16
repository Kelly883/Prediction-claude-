/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // sharp is a native module — mark it external so Next.js's server bundler
  // doesn't try to bundle it and instead lets Node's normal require() find
  // the platform-specific binary that `npm install` placed in node_modules.
  serverExternalPackages: ['sharp'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

