/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Scoped deliberately narrow: this project has an established custom CSS
  // design system (globals.css: .card, .btn-*, .admin-*, CSS custom
  // properties like var(--pitch)/var(--floodlight)/etc.) that most pages
  // use directly. Tailwind is added specifically because a large amount of
  // admin-page code already assumes Tailwind utility classes exist (they
  // were written that way but never actually worked, since Tailwind was
  // never installed) — this makes that already-written code function
  // correctly rather than requiring every affected page to be hand-rewritten
  // into the custom system. New code should still prefer the existing
  // .admin-*/.card/.btn-* classes for consistency where an equivalent
  // already exists.
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: false, // Do NOT reset default element styles — globals.css
    // already establishes base styles (body background, font, etc.) for the
    // whole app; Tailwind's preflight reset would fight with that and alter
    // every existing page's default element appearance, not just the pages
    // that actually need Tailwind's utility classes.
  },
};
