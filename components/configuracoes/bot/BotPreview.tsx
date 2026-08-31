'use client'

import { BOT_NAME } from '@/lib/bot/constants'

export interface BotPreviewConfig {
  specialty: string
  procedures: string[]
  insurance_plans: string[]
  handoff_number?: string
  welcome_message: string
}

// Preview visual do bot — atualiza em tempo real conforme o médico edita,
// usando apenas as props do formulário (sem chamadas de API).
export function BotPreview({ config }: { config: BotPreviewConfig }) {
  const preview = [
    { role: 'bot' as const, text: config.welcome_message || 'Olá! Como posso ajudar?' },
    { role: 'patient' as const, text: 'Oi, queria marcar uma consulta' },
    {
      role: 'bot' as const,
      text: config.specialty
        ? `Claro! Atendemos em ${config.specialty}${
            config.procedures.length > 0 ? `, com foco em ${config.procedures.slice(0, 2).join(' e ')}` : ''
          }. Qual seria o motivo da consulta?`
        : 'Claro! Qual seria o motivo da consulta?',
    },
  ]

  return (
    <div className="sticky top-6">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">Preview do bot</p>
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-[#ECE5DD] shadow-sm">
        <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-medium text-white">
            {BOT_NAME.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{BOT_NAME}</p>
            <p className="text-xs text-white/70">online</p>
          </div>
        </div>
        <div className="space-y-2 p-4">
          {preview.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'patient' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                  msg.role === 'patient' ? 'rounded-tr-none bg-[#DCF8C6] text-gray-800' : 'rounded-tl-none bg-white text-gray-800'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>
      </div>
      {config.insurance_plans.length > 0 && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs text-blue-700">
            <strong>Convênios:</strong> {config.insurance_plans.join(', ')}
          </p>
        </div>
      )}
      {config.handoff_number && (
        <div className="mt-2 rounded-lg border border-green-100 bg-green-50 p-3">
          <p className="text-xs text-green-700">
            <strong>Handoff:</strong> {config.handoff_number}
          </p>
        </div>
      )}
    </div>
  )
}
