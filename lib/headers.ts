export function noStoreHeaders() {
  return { 'Cache-Control': 'private, no-store' };
}

export function publicCacheHeaders(ttlSeconds: number) {
  return {
    'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds * 2}`,
  };
}
