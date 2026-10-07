/**
 * Top navigation bar — Stryker yellow.
 *
 * Replaces the old left sidebar. Primary destinations run horizontally here,
 * ABOVE the filter/utility bar (AppHeader). Brand wordmark on the left, the
 * "Ask AI" entry to the floating assistant pinned right.
 *
 * Chat/conversations are NOT routed here — the assistant lives in the
 * always-present floating ChatDock, so nothing was lost by dropping the
 * sidebar's conversation list.
 */
import { NavLink } from 'react-router';
import { BarChart3, Home, LayoutDashboard, Layers, Radar, Sparkles } from 'lucide-react';
import { dockController } from '@/chat/dockController';

const navItems = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/operations', label: 'Command Center', icon: Radar, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: false },
  { to: '/platform', label: 'How it’s built', icon: Layers, end: false },
];

// Link on the yellow bar: active = charcoal pill with yellow text; inactive =
// charcoal text with a soft dark hover wash.
const linkClass = (isActive: boolean) =>
  [
    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors',
    isActive
      ? 'bg-[var(--brand-1)] text-[var(--brand-4)] shadow-sm'
      : 'text-[var(--brand-1)] hover:bg-black/10',
  ].join(' ');

export function AppNavBar() {
  return (
    <header
      className="shrink-0 w-full border-b border-black/10"
      style={{ background: 'var(--brand-4)' }}
    >
      <div className="flex h-14 items-center gap-1 px-3 sm:px-4">
        {/* Brand — charcoal tile + yellow "s", app name in charcoal. */}
        <NavLink to="/" className="flex items-center gap-2.5 mr-2 sm:mr-3 shrink-0">
          <div
            className="flex aspect-square size-8 items-center justify-center rounded-md shrink-0"
            style={{ background: 'var(--brand-1)' }}
          >
            <span
              className="font-display font-extrabold text-lg leading-none lowercase"
              style={{ color: 'var(--brand-4)' }}
            >
              s
            </span>
          </div>
          <span
            className="hidden sm:inline font-display text-base font-extrabold tracking-tight leading-none"
            style={{ color: 'var(--brand-1)' }}
          >
            Global Logistics Command Center
          </span>
        </NavLink>

        {/* Primary navigation — horizontal, scrolls on narrow screens. */}
        <nav className="flex items-center gap-0.5 overflow-x-auto min-w-0">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {({ isActive }) => (
                <span className={linkClass(isActive)}>
                  <item.icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Ask AI — opens the floating assistant dock (the sidebar used to host
            conversations; they now live entirely in the dock). */}
        <button
          type="button"
          onClick={() => dockController.open()}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors text-[var(--brand-4)]"
          style={{ background: 'var(--brand-1)' }}
          title="Open the AI assistant"
        >
          <Sparkles className="size-4 shrink-0" />
          <span className="hidden sm:inline">Ask AI</span>
        </button>
      </div>
    </header>
  );
}
