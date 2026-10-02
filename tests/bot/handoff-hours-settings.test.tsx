import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HandoffHoursSettings } from '@/components/configuracoes/bot/HandoffHoursSettings'

it('explains that an unconfigured unit inherits its global hours rather than 24/7', () => {
  const html = renderToStaticMarkup(
    <HandoffHoursSettings initialHours={[]} workspaceId="unit-1" emptyMessage="Esta unidade usa o horário Global." />
  )
  expect(html).toContain('Esta unidade usa o horário Global.')
  expect(html).not.toContain('handoff disponível 24/7')
})
