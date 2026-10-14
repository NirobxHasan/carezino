import { cn, initials } from '@/lib/utils';

const palette = [
  'bg-teal-50 text-teal-700',
  'bg-sky-50 text-sky-700',
  'bg-violet-50 text-violet-700',
  'bg-amber-50 text-amber-800',
  'bg-rose-50 text-rose-700',
  'bg-emerald-50 text-emerald-700',
];

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Initials avatar. Colour is derived from the name so a person keeps the same colour everywhere. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold',
        palette[hash(name) % palette.length],
        size === 'sm' && 'size-7 text-[11px]',
        size === 'md' && 'size-9 text-xs',
        size === 'lg' && 'size-14 text-base',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
