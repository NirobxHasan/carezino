import { SectionHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const swatchGroups: {
  title: string;
  swatches: { token: string; hex: string; className: string }[];
}[] = [
  {
    title: 'Brand',
    swatches: [
      { token: 'primary', hex: '#0D9488', className: 'bg-primary' },
      { token: 'primary-hover', hex: '#0F766E', className: 'bg-primary-hover' },
      { token: 'primary-subtle', hex: '#F0FDFA', className: 'bg-primary-subtle' },
    ],
  },
  {
    title: 'Neutral',
    swatches: [
      { token: 'foreground', hex: '#1E293B', className: 'bg-foreground' },
      { token: 'muted-foreground', hex: '#64748B', className: 'bg-muted-foreground' },
      { token: 'border', hex: '#E2E8F0', className: 'bg-border' },
      { token: 'background', hex: '#F8FAFC', className: 'bg-background' },
      { token: 'surface', hex: '#FFFFFF', className: 'bg-surface' },
    ],
  },
  {
    title: 'Semantic',
    swatches: [
      { token: 'success', hex: '#16A34A', className: 'bg-success' },
      { token: 'warning', hex: '#D97706', className: 'bg-warning' },
      { token: 'danger', hex: '#DC2626', className: 'bg-danger' },
      { token: 'info', hex: '#2563EB', className: 'bg-info' },
    ],
  },
  {
    title: 'Discipline accents',
    swatches: [
      { token: 'discipline-ot', hex: '#0D9488', className: 'bg-discipline-ot' },
      { token: 'discipline-aba', hex: '#7C3AED', className: 'bg-discipline-aba' },
      { token: 'discipline-slt', hex: '#DB2777', className: 'bg-discipline-slt' },
      { token: 'discipline-other', hex: '#64748B', className: 'bg-discipline-other' },
    ],
  },
];

const typeScale = [
  { name: 'Page title', className: 'text-page-title', spec: '24px · 600', sample: 'Patients' },
  {
    name: 'Section title',
    className: 'text-section-title',
    spec: '18px · 600',
    sample: 'Today’s sessions',
  },
  {
    name: 'Card title',
    className: 'text-card-title',
    spec: '16px · 600',
    sample: 'Therapist availability',
  },
  {
    name: 'Body',
    className: 'text-sm',
    spec: '14px · 400',
    sample: 'Ayaan attended 11 of 12 sessions this month.',
  },
  {
    name: 'Label',
    className: 'text-label font-medium',
    spec: '13px · 500',
    sample: 'Guardian phone',
  },
  {
    name: 'Helper',
    className: 'text-xs text-muted-foreground',
    spec: '12px · 400',
    sample: 'We’ll send appointment reminders here.',
  },
  { name: 'KPI', className: 'text-kpi tabular', spec: '28px · 600', sample: '৳2,62,900' },
];

const spacing = [4, 8, 12, 16, 24, 32];

export function Foundations() {
  return (
    <div className="space-y-10">
      <section>
        <SectionHeader
          title="Colour"
          description="Mostly white and neutral surfaces. Teal marks primary actions and the current location; never decoration."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          {swatchGroups.map((group) => (
            <Card key={group.title}>
              <CardContent className="pt-4">
                <p className="mb-3 text-label font-medium">{group.title}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {group.swatches.map((s) => (
                    <div key={s.token} className="space-y-1.5">
                      <div className={cn('h-12 rounded-lg border border-border', s.className)} />
                      <p className="font-mono text-xs">{s.token}</p>
                      <p className="text-xs text-muted-foreground uppercase">{s.hex}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Typography"
          description="Inter for English and Hind Siliguri for Bangla. Sentence case everywhere."
        />
        <Card>
          <ul className="divide-y divide-border">
            {typeScale.map((t) => (
              <li
                key={t.name}
                className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <span className="w-32 shrink-0 text-xs text-muted-foreground">
                  {t.name}
                  <span className="block font-mono">{t.spec}</span>
                </span>
                <span className={t.className}>{t.sample}</span>
              </li>
            ))}
            <li className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                Bangla
                <span className="block font-mono">Hind Siliguri</span>
              </span>
              <span lang="bn" className="text-base">
                শিশু বিকাশ থেরাপি সেন্টার — আজকের সেশন ১১টি
              </span>
            </li>
          </ul>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <p className="mb-1 text-label font-medium">Spacing scale</p>
            <p className="mb-4 text-xs text-muted-foreground">
              Use only these steps between elements.
            </p>
            <div className="space-y-2.5">
              {spacing.map((px) => (
                <div key={px} className="flex items-center gap-3">
                  <span className="w-10 text-right font-mono text-xs text-muted-foreground">
                    {px}px
                  </span>
                  <span className="h-3 rounded-sm bg-primary/70" style={{ width: px * 4 }} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="mb-1 text-label font-medium">Radius & elevation</p>
            <p className="mb-4 text-xs text-muted-foreground">
              8px for controls, 12px for cards and overlays. Shadows stay barely visible.
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="grid h-16 w-28 place-items-center rounded-lg border border-border-strong bg-surface text-xs shadow-xs">
                8px · xs
              </div>
              <div className="grid h-16 w-28 place-items-center rounded-xl border border-border bg-surface text-xs shadow-sm">
                12px · sm
              </div>
              <div className="grid h-16 w-28 place-items-center rounded-xl border border-border bg-surface text-xs shadow-md">
                12px · md
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
