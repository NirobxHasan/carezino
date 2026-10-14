import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn('size-8 shrink-0', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      {/* An open "C" that cradles a dot: care around a person */}
      <path
        d="M21.5 10.6a8 8 0 1 0 0 10.8"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="16.5" cy="16" r="2.6" fill="#fff" />
    </svg>
  );
}

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className={cn('grid leading-tight', collapsed && 'sr-only')}>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">Carezino</span>
      </span>
    </span>
  );
}
