import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { CostPeriodPicker } from '@/components/admin/costs/CostPeriodPicker'
import { parseCostWindow, windowFromDays } from '@/lib/admin/cost-range'

const now = new Date('2026-11-12T15:00:00Z')
const html = (window: ReturnType<typeof windowFromDays>) =>
  renderToStaticMarkup(
    <CostPeriodPicker window={window} basePath="/admin/costs" extraQuery={{ tab: 'cliente' }} today="2026-11-12" />,
  )

describe('CostPeriodPicker', () => {
  it('marca o atalho ativo e mantém a aba nos links', () => {
    const out = html(windowFromDays(30, now))
    expect(out).toMatch(/aria-current="page"[^>]*>30 dias|>30 dias</)
    expect(out).toContain('href="/admin/costs?tab=cliente&amp;days=7"')
    expect(out).toContain('Escolher dia')
  })

  it('intervalo aparece no botão do calendário', () => {
    expect(html(parseCostWindow({ from: '2026-11-03', to: '2026-11-11' }, now))).toContain('03/11 – 11/11')
  })

  it('um dia só mostra só a data', () => {
    const out = html(parseCostWindow({ from: '2026-11-11', to: '2026-11-11' }, now))
    expect(out).toContain('11/11')
    expect(out).not.toContain('11/11 –')
  })
})
