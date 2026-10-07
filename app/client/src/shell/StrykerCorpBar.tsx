/**
 * Stryker corporate top bar — mirrors the thin utility strip that runs across
 * the top of stryker.com. White background, the Stryker wordmark on the left,
 * and the corporate/utility links pinned right (Careers, Investor Relations,
 * Patients, Contact, Language).
 *
 * This sits ABOVE the yellow Command Center nav (AppNavBar). It's pure
 * corporate chrome for the demo — the links point at the real stryker.com
 * sections and open in a new tab; they are NOT app routes.
 */
import { Globe } from 'lucide-react';

// Under the preview proxy the app is served at `/preview/<project-id>/`, so an
// absolute `/stryker-logo.png` would resolve to the proxy ROOT and 404. Prefix
// public assets with the same basename the router uses (empty when deployed
// normally, where `/` is correct).
const ASSET_BASE =
  (typeof window !== 'undefined' && window.__PREVIEW_BASENAME__) || '';
const asset = (p: string) => `${ASSET_BASE}${p}`;

const corpLinks = [
  { label: 'Careers', href: 'https://careers.stryker.com/' },
  { label: 'Investor Relations', href: 'https://investors.stryker.com/' },
  { label: 'Patients', href: 'https://patients.stryker.com/' },
  { label: 'Contact', href: 'https://www.stryker.com/us/en/contact-us.html' },
];

export function StrykerCorpBar() {
  return (
    <div className="shrink-0 w-full bg-white border-b border-black/10">
      <div className="flex h-11 items-center gap-4 px-3 sm:px-4">
        {/* Stryker corporate logo (official wordmark PNG from stryker.com). */}
        <a
          href="https://www.stryker.com/us/en/index.html"
          target="_blank"
          rel="noreferrer"
          className="flex items-center shrink-0"
          aria-label="Stryker"
        >
          <img
            src={asset('/stryker-logo.png')}
            alt="Stryker"
            className="h-6 w-auto"
          />
        </a>

        <div className="flex-1" />

        {/* Corporate / utility links, pinned right like stryker.com. */}
        <nav className="flex items-center gap-1 sm:gap-2 overflow-x-auto min-w-0">
          {corpLinks.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded px-2 py-1 text-xs sm:text-sm font-medium whitespace-nowrap text-[var(--brand-2)] hover:text-[var(--brand-1)] hover:bg-black/5 transition-colors"
            >
              {l.label}
            </a>
          ))}
          {/* Language selector — matches stryker.com's globe + region control. */}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs sm:text-sm font-medium whitespace-nowrap text-[var(--brand-2)] hover:text-[var(--brand-1)] hover:bg-black/5 transition-colors"
            title="Select language / region"
          >
            <Globe className="size-4 shrink-0" />
            <span>EN</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
