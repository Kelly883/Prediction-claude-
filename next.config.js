/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp is a native module — mark it external so Next.js's server bundler
  // doesn't try to bundle it and instead lets Node's normal require() find
  // the platform-specific binary that `npm install` placed in node_modules.
  serverExternalPackages: ['sharp'],
};

module.exports = nextConfig;
