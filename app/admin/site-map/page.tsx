import fs from 'fs';
import path from 'path';

type RouteStatus =
  | 'Public'
  | 'Customer Dashboard'
  | 'Admin Only'
  | 'Support / Customer Tools'
  | 'Internal / Test';

type RouteInfo = {
  route: string;
  file: string;
  status: RouteStatus;
  label: string;
  description?: string;
};

type Metadata = Partial<Pick<RouteInfo, 'label' | 'description' | 'status'>>;

const APP_DIR = path.join(process.cwd(), 'app');

const STATUS_ORDER: RouteStatus[] = [
  'Public',
  'Customer Dashboard',
  'Support / Customer Tools',
  'Admin Only',
  'Internal / Test',
];

const ROUTE_METADATA: Record<string, Metadata> = {
  '/': {
    label: 'Home',
    description: 'Primary marketing landing page.',
  },
  '/about': {
    label: 'About IntelliWatt',
    description: 'Company mission, values, and team summary.',
  },
  '/admin': {
    label: 'Admin Dashboard',
    status: 'Admin Only',
    description: 'Operations dashboard with metrics and admin tooling.',
  },
  '/admin-login': {
    label: 'Admin Login',
    status: 'Internal / Test',
    description: 'Legacy admin login shell (use for QA only).',
  },
  '/admin/database': {
    label: 'Database Explorer',
    status: 'Admin Only',
    description: 'Read-only SQL explorer for whitelisted tables.',
  },
  '/admin/efl/links': {
    label: 'EFL Link Runner',
    status: 'Admin Only',
    description: 'Fetch and fingerprint Electricity Facts Label PDFs.',
  },
  '/admin/efl/manual-upload': {
    label: 'Manual Fact Card Loader',
    status: 'Admin Only',
    description: 'Upload an EFL PDF and inspect deterministic parsing output.',
  },
  '/admin/efl/tests': {
    label: 'EFL Fact Card Engine Tests',
    status: 'Internal / Test',
    description: 'Internal harness for plan rules extraction verification.',
  },
  '/admin/ercot/inspector': {
    label: 'ERCOT Inspector',
    status: 'Internal / Test',
    description: 'Legacy ERCOT ingest and health inspector.',
  },
  '/admin/modules': {
    label: 'Module Registry',
    status: 'Admin Only',
    description: 'System module registry and health overview.',
  },
  '/admin/offers': {
    label: 'Offers Console',
    status: 'Admin Only',
    description: 'Admin console for WattBuy offer ingestion and review.',
  },
  '/admin/plan-analyzer/tests': {
    label: 'Plan Analyzer Harness',
    status: 'Internal / Test',
    description: 'Prototype analyzer for plan comparisons and diagnostics.',
  },
  '/admin/probe': {
    label: 'Instrumentation Probe',
    status: 'Internal / Test',
    description: 'Diagnostic surface for observing instrumentation payloads.',
  },
  '/admin/puct/reps': {
    label: 'PUCT REP Directory',
    status: 'Admin Only',
    description: 'Upload and review the curated PUCT Retail Electric Provider list.',
  },
  '/admin/retail-rates': {
    label: 'Retail Rates Admin',
    status: 'Admin Only',
    description: 'Retail rate management, search, and sync tools.',
  },
  '/admin/retail-rates/seed': {
    label: 'Retail Rates Seeder',
    status: 'Internal / Test',
    description: 'Developer seeding harness for retail rate fixtures.',
  },
  '/admin/retail-rates/sync': {
    label: 'Retail Rates Sync',
    status: 'Internal / Test',
    description: 'Manual trigger for syncing rates from WattBuy.',
  },
  '/admin/roadmap': {
    label: 'Roadmap Prototype',
    status: 'Internal / Test',
    description: 'Internal roadmap viewer (experimental).',
  },
  '/admin/seed': {
    label: 'Seed Utilities',
    status: 'Internal / Test',
    description: 'Developer seeding utilities and scripts.',
  },
  '/admin/site-map': {
    label: 'Site Map & Route Inventory',
    status: 'Admin Only',
    description: 'This page. Lists every app route with status and context.',
  },
  '/admin/smt': {
    label: 'SMT Admin Landing',
    status: 'Admin Only',
    description: 'Landing page for Smart Meter Texas admin tooling.',
  },
  '/admin/smt/agreements': {
    label: 'SMT Agreements Console',
    status: 'Admin Only',
    description: 'Lookup agreement status, ESIIDs, and manage SMT agreements.',
  },
  '/admin/smt/inspector': {
    label: 'SMT Inspector',
    status: 'Admin Only',
    description: 'Inline SMT ingest tester and file upload harness.',
  },
  '/admin/smt/normalize': {
    label: 'Usage Normalization Trigger',
    status: 'Admin Only',
    description: 'Manual trigger for usage normalization into the master DB.',
  },
  '/admin/smt/raw': {
    label: 'SMT Manual Upload',
    status: 'Admin Only',
    description: 'Stream raw SMT CSVs through the admin proxy for ingest.',
  },
  '/admin/smt/subscriptions': {
    label: 'SMT Subscriptions Console',
    status: 'Admin Only',
    description: 'List, filter, and manage SMT subscriptions.',
  },
  '/admin/smt/trigger': {
    label: 'SMT Legacy Triggers',
    status: 'Internal / Test',
    description: 'Legacy SMT trigger panel (kept for regression testing).',
  },
  '/admin/tools/smt': {
    label: 'SMT Tools (Legacy)',
    status: 'Internal / Test',
    description: 'Archived SMT tooling surface (legacy).',
  },
  '/admin/wattbuy/inspector': {
    label: 'WattBuy Inspector',
    status: 'Admin Only',
    description: 'Inspect WattBuy API payloads and quotes.',
  },
  '/benefits': {
    description: 'Marketing page highlighting IntelliWatt membership benefits.',
  },
  '/customer/smt-upload': {
    label: 'Customer SMT Upload',
    status: 'Support / Customer Tools',
    description: 'Support form for manual SMT document uploads.',
  },
  '/dashboard': {
    label: 'Dashboard Overview',
    status: 'Customer Dashboard',
    description: 'Customer dashboard landing page.',
  },
  '/dashboard/api': {
    label: 'API & Tools',
    status: 'Customer Dashboard',
    description: 'Customer-facing tools (usage, SMT, API tokens).',
  },
  '/dashboard/appliances': {
    label: 'Appliance Tracking',
    status: 'Customer Dashboard',
    description: 'Customer appliance inventory and usage impact.',
  },
  '/dashboard/current-rate': {
    label: 'Current Plan Entry',
    status: 'Customer Dashboard',
    description: 'Capture or edit the customer’s current electricity plan.',
  },
  '/dashboard/current-rate-details': {
    label: 'Current Plan Details',
    status: 'Customer Dashboard',
    description: 'Normalized view of the customer’s current plan details.',
  },
  '/dashboard/entries': {
    label: 'Jackpot Entries',
    status: 'Customer Dashboard',
    description: 'Track raffle entries and incentives earned.',
  },
  '/dashboard/home': {
    label: 'Home Overview',
    status: 'Customer Dashboard',
    description: 'Active home summary and SMT connection status.',
  },
  '/dashboard/manual-entry': {
    label: 'Manual Usage Entry',
    status: 'Customer Dashboard',
    description: 'Enter usage data manually when SMT is unavailable.',
  },
  '/dashboard/optimal': {
    label: 'Optimal Plan Results',
    status: 'Customer Dashboard',
    description: 'Plan comparison results tailored to the customer.',
  },
  '/dashboard/plans': {
    label: 'Plan Explorer',
    status: 'Customer Dashboard',
    description: 'Explore recommended plans and partner offers.',
  },
  '/dashboard/profile': {
    label: 'Profile & SMT Status',
    status: 'Customer Dashboard',
    description: 'Customer profile, SMT controls, and contact preferences.',
  },
  '/dashboard/referrals': {
    label: 'Referrals',
    status: 'Customer Dashboard',
    description: 'Invite friends and track referral rewards.',
  },
  '/dashboard/smt-confirmation': {
    label: 'SMT Confirmation Gate',
    status: 'Customer Dashboard',
    description: 'Dedicated SMT approval/decline confirmation workflow.',
  },
  '/dashboard/upgrades': {
    label: 'Upgrade Tracker',
    status: 'Customer Dashboard',
    description: 'Track home upgrades and incentives.',
  },
  '/dashboard/usage': {
    label: 'Usage History',
    status: 'Customer Dashboard',
    description: 'Normalized usage history and interval data.',
  },
  '/debug-migration': {
    label: 'Migration Debug',
    status: 'Internal / Test',
    description: 'Utility page for checking Prisma migration state.',
  },
  '/dev/instructions': {
    label: 'Developer Instructions',
    status: 'Internal / Test',
    description: 'Internal developer setup instructions and notes.',
  },
  '/faq': {
    label: 'FAQ',
    description: 'Frequently asked questions for prospective members.',
  },
  '/how-it-works': {
    label: 'How It Works',
    description: 'Explains the IntelliWatt customer journey.',
  },
  '/join': {
    label: 'Join IntelliWatt',
    description: 'Primary lead capture and onboarding entry point.',
  },
  '/login': {
    label: 'Customer Login',
    description: 'Auth entry for customers (magic link flow).',
  },
  '/logout': {
    label: 'Logout',
    description: 'Explicit logout page.',
  },
  '/plans': {
    label: 'Electricity Plans',
    description: 'Marketing overview of plan discovery.',
  },
  '/privacy': {
    label: 'Privacy',
    description: 'Privacy overview for IntelliWatt services.',
  },
  '/privacy-policy': {
    label: 'Privacy Policy',
    description: 'Legal privacy policy document.',
  },
  '/quote': {
    label: 'Get a Quote',
    description: 'Lead form for personalized rate quotes.',
  },
  '/readme': {
    label: 'Project Readme',
    status: 'Internal / Test',
    description: 'Internal documentation surface rendered in app.',
  },
  '/results': {
    label: 'Plan Results (Public Flow)',
    description: 'Public-facing plan results page used after onboarding flow.',
  },
  '/rules': {
    label: 'Official Rules',
    description: 'Sweepstakes and promotion rules.',
  },
  '/security': {
    label: 'Security Practices',
    description: 'Overview of IntelliWatt security posture.',
  },
  '/terms': {
    label: 'Terms of Service',
    description: 'IntelliWatt terms of service and agreement.',
  },
  '/wattbuy/debug': {
    label: 'WattBuy Debugger',
    status: 'Internal / Test',
    description: 'Internal WattBuy plan debugging harness.',
  },
};

function normalizeSegment(segment: string): string {
  if (segment.startsWith('[') && segment.endsWith(']')) {
    const name = segment.slice(1, -1);
    if (name.startsWith('...')) {
      return `:${name.slice(3)}*`;
    }
    return `:${name}`;
  }

  if (segment.startsWith('(') && segment.endsWith(')')) {
    return '';
  }

  return segment;
}

function collectRoutes(dir: string, currentRoute: string): RouteInfo[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let routes: RouteInfo[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'page.tsx') {
      const route = currentRoute || '/';
      const file = path.relative(process.cwd(), path.join(dir, entry.name));
      routes.push({
        route,
        file,
        status: 'Public', // placeholder; real status computed later
        label: '',
      });
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name === 'api' || entry.name === 'components' || entry.name === 'lib') {
        continue;
      }

      const segment = normalizeSegment(entry.name);
      const nextRoute =
        segment.length === 0
          ? currentRoute
          : currentRoute === ''
          ? `/${segment}`
          : `${currentRoute}/${segment}`;

      routes = routes.concat(collectRoutes(path.join(dir, entry.name), nextRoute));
    }
  }

  return routes;
}

function defaultLabel(route: string): string {
  if (route === '/') return 'Home';
  const segments = route.split('/').filter(Boolean);
  if (segments.length === 0) return 'Home';
  const last = segments[segments.length - 1].replace(/:/g, '').replace(/\*/g, '');
  return last
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveStatus(route: string): RouteStatus {
  const explicit = ROUTE_METADATA[route]?.status;
  if (explicit) return explicit;

  if (route.startsWith('/admin')) return 'Admin Only';
  if (route.startsWith('/dashboard')) return 'Customer Dashboard';
  if (route.startsWith('/customer')) return 'Support / Customer Tools';
  if (
    route.startsWith('/dev') ||
    route.startsWith('/debug') ||
    route.startsWith('/readme') ||
    route.startsWith('/wattbuy') ||
    route.includes('/tests') ||
    route.includes('/seed') ||
    route.includes('/sync')
  ) {
    return 'Internal / Test';
  }

  return 'Public';
}

function enhance(routes: RouteInfo[]): RouteInfo[] {
  const seen = new Map<string, RouteInfo>();

  for (const routeInfo of routes) {
    const existing = seen.get(routeInfo.route);
    if (existing) {
      if (!existing.file.includes(routeInfo.file)) {
        existing.file = `${existing.file}, ${routeInfo.file}`;
      }
      continue;
    }

    const meta = ROUTE_METADATA[routeInfo.route] ?? {};
    const status = resolveStatus(routeInfo.route);
    const label = meta.label ?? defaultLabel(routeInfo.route);
    const description = meta.description;

    seen.set(routeInfo.route, {
      ...routeInfo,
      status,
      label,
      description,
    });
  }

  const normalized = Array.from(seen.values());
  normalized.sort((a, b) => a.route.localeCompare(b.route));
  return normalized;
}

function group(routes: RouteInfo[]): Map<RouteStatus, RouteInfo[]> {
  const grouped = new Map<RouteStatus, RouteInfo[]>();

  for (const route of routes) {
    const list = grouped.get(route.status) ?? [];
    list.push(route);
    grouped.set(route.status, list);
  }

  grouped.forEach((list) => {
    list.sort((a, b) => a.route.localeCompare(b.route));
  });

  return grouped;
}

export default function AdminSiteMapPage() {
  const discovered = collectRoutes(APP_DIR, '');
  const routes = enhance(discovered);
  const grouped = group(routes);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold text-brand-navy">IntelliWatt Site Map &amp; Route Inventory</h1>
        <p className="text-brand-navy/70 max-w-3xl">
          This inventory enumerates every <code>app/</code> route that ships with the IntelliWatt Next.js app—including
          hidden test harnesses and admin tooling. Use it to confirm deployment coverage, triage stale pages, or share
          deep links with the team. Routes are grouped by audience to make it easy to spot admin-only or experimental
          surfaces.
        </p>
      </header>

      {STATUS_ORDER.map((status) => {
        const items = grouped.get(status);
        if (!items || items.length === 0) {
          return null;
        }

        return (
          <section key={status} className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold text-brand-navy">{status}</h2>
              <p className="text-sm text-brand-navy/60">
                {items.length} route{items.length === 1 ? '' : 's'}.
              </p>
            </div>

            <div className="divide-y divide-brand-navy/10 rounded-xl border border-brand-navy/10 bg-white shadow-sm">
              {items.map((route) => (
                <div key={route.route} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-brand-navy font-medium">{route.label}</div>
                    <code className="rounded bg-brand-navy/5 px-2 py-0.5 text-xs text-brand-navy">{route.route}</code>
                    {route.description ? (
                      <p className="text-sm text-brand-navy/70">{route.description}</p>
                    ) : null}
                  </div>
                  <div className="text-xs text-brand-navy/50 sm:text-right">
                    <span className="font-mono">{route.file}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}


