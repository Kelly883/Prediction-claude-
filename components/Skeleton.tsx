'use client';

interface Props {
  /** Tailwind‑compatible class names for size (e.g. "h-48 w-full") */
  className?: string;
}

/**
 * Simple skeleton loader – a gray pulsing box.
 * Color matches the muted text palette for subtlety.
 */
export function Skeleton({ className = '' }: Props) {
  return (
    <div
      aria-hidden="true"
      className={`bg-gray-700/30 rounded ${className} animate-pulse`}
    />
  );
}
