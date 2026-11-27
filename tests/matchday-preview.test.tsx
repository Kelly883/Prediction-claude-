// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error -- react-dom/client ships no bundled type declarations and
// @types/react-dom is not a project dependency.
import { createRoot, type Root } from 'react-dom/client';
import MatchdayPreview, { FixtureCard } from '@/components/MatchdayPreview';

// next/link and next/image pull in the Next.js runtime; replace them with plain
// elements so the component can render in isolation.
vi.mock('next/link', async () => {
  const R = await import('react');
  return { default: ({ children, ...rest }: any) => R.createElement('a', rest, children) };
});

vi.mock('next/image', async () => {
  const R = await import('react');
  return { default: ({ src, alt, ...rest }: any) => R.createElement('img', { src, alt, ...rest }) };
});

// The exact shape returned by GET /api/public/fixtures.
const actualFixture = {
  id: 'post-1',
  title: 'Arsenal vs Chelsea',
  scheduledAt: '2026-11-27T15:00:00.000Z',
  status: 'published',
  matchCount: 1,
  items: [{ id: 'item-1', match: 'Arsenal vs Chelsea', matchDateTime: '2026-11-27T15:00:00.000Z' }],
};

type Mounted = { container: HTMLDivElement; unmount: () => void };

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Render + flush the effect's async fetch/state updates.
async function mountAsync(element: React.ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function mockFetch(fixtures: unknown[], opts: { meAuthenticated?: boolean } = {}) {
  return vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/api/public/fixtures')) {
      return { ok: true, json: async () => ({ fixtures }) } as any;
    }
    if (url.includes('/api/me')) {
      return opts.meAuthenticated
        ? ({ ok: true, json: async () => ({ authenticated: true }) } as any)
        : ({ ok: false, json: async () => ({}) } as any);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).fetch = mockFetch([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MatchdayPreview (real /api/public/fixtures shape)', () => {
  it('renders the actual API response structure without throwing', async () => {
    (globalThis as any).fetch = mockFetch([actualFixture]);
    const view = await mountAsync(<MatchdayPreview />);
    // New design renders home/away teams separately with VS separator
    expect(view.container.textContent).toContain('Arsenal');
    expect(view.container.textContent).toContain('Chelsea');
    expect(view.container.textContent).toContain('VS');
    expect(view.container.textContent).toContain("Today's Fixtures");
    view.unmount();
  });

  it('renders the existing empty state for an empty fixture array', async () => {
    (globalThis as any).fetch = mockFetch([]);
    const view = await mountAsync(<MatchdayPreview />);
    expect(view.container.textContent).toContain('No fixtures scheduled');
    view.unmount();
  });

  it('does not crash when /api/me returns 401 (logged-out visitor)', async () => {
    (globalThis as any).fetch = mockFetch([actualFixture], { meAuthenticated: false });
    const view = await mountAsync(<MatchdayPreview />);
    expect(view.container.textContent).toContain('Arsenal');
    expect(view.container.textContent).toContain('Chelsea');
    expect(view.container.textContent).toContain('VS');
    view.unmount();
  });
});

describe('FixtureCard defensive rendering', () => {
  it('renders when league information is absent', () => {
    const view = mount(<FixtureCard fixture={actualFixture as any} isEntitled={false} />);
    expect(view.container.textContent).toContain('Arsenal');
    expect(view.container.textContent).toContain('Chelsea');
    expect(view.container.textContent).toContain('VS');
    view.unmount();
  });

  it('renders when home/away team information is absent', () => {
    const fixture = { ...actualFixture } as any;
    delete fixture.homeTeam;
    delete fixture.awayTeam;
    expect(() => {
      const view = mount(<FixtureCard fixture={fixture} isEntitled={false} />);
      view.unmount();
    }).not.toThrow();
  });

  it('uses a safe fallback (no <img>) when logos are missing', () => {
    const view = mount(<FixtureCard fixture={actualFixture as any} isEntitled={false} />);
    expect(view.container.querySelectorAll('img').length).toBe(0);
    view.unmount();
  });

  it('does not error when odds are missing', () => {
    const fixture = { ...actualFixture, prediction: { market: 'Match Result', selection: 'Home' } } as any;
    const view = mount(<FixtureCard fixture={fixture} isEntitled={true} />);
    expect(view.container.textContent).toContain('Match Result');
    expect(view.container.textContent).not.toContain('Odds');
    view.unmount();
  });

  it('renders a valid fixture with items and kickoff correctly', () => {
    const view = mount(<FixtureCard fixture={actualFixture as any} isEntitled={false} />);
    expect(view.container.textContent).toContain('Arsenal');
    expect(view.container.textContent).toContain('Chelsea');
    expect(view.container.textContent).toContain('VS');
    // Time is displayed next to VS separator (15:00 UTC = 16:00 or 15:00 local)
    expect(view.container.textContent).toMatch(/\d{2}:\d{2}/);
    view.unmount();
  });

  it('does not throw when scheduledAt is missing or invalid', () => {
    const fixture = { ...actualFixture, scheduledAt: 'not-a-date' } as any;
    expect(() => {
      const view = mount(<FixtureCard fixture={fixture} isEntitled={false} />);
      view.unmount();
    }).not.toThrow();
  });
});