'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'

// Toaster global do app. Montado uma vez no layout do dashboard; os toasts em
// si são disparados com `toast(...)` de qualquer client component.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        style: {
          background: '#fff',
          border: '1px solid var(--navy-06)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-md)',
          color: 'var(--navy-dark)',
        },
      }}
      {...props}
    />
  )
}
