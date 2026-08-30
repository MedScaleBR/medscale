import { cn } from '@/lib/utils'

const PALETTE = [
  'bg-[var(--navy)] text-white',
  'bg-[var(--cyan-dark)] text-white',
  'bg-[var(--navy-light)] text-white',
  'bg-[var(--cyan)] text-[var(--navy-dark)]',
  'bg-[var(--navy-mid)] text-white',
]

function hash(input: string) {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h << 5) - h + input.charCodeAt(i)
  return Math.abs(h)
}

export function initialsOf(label: string) {
  const s = (label ?? '').trim()
  if (!s) return '?'
  if (s.includes('-')) {
    const tail = s.split('-').filter(Boolean).pop() ?? s
    return tail.slice(0, 2).toUpperCase()
  }
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

interface InitialsAvatarProps {
  label: string
  seed?: string
  className?: string
}

export function InitialsAvatar({ label, seed, className }: InitialsAvatarProps) {
  const color = PALETTE[hash(seed ?? label) % PALETTE.length]
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold',
        color,
        className
      )}
    >
      {initialsOf(label)}
    </span>
  )
}
