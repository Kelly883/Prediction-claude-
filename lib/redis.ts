import { Redis } from '@upstash/redis';

// Upstash's REST-based client — no persistent TCP connection to manage,
// which is exactly what a serverless function needs (a standard `ioredis`
// connection would be re-opened, and likely leaked, on every cold start).
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
