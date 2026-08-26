import type { FinanceEntryType } from '@/types/database'

export type { FinanceEntryType }

export type FinanceEntry = {
  id: string
  account_id: string
  recorded_by_phone: string
  type: FinanceEntryType
  description: string | null
  amount: number
  category: string | null
  raw_message: string
  entry_date: string
  created_at: string
}

export type ParsedCommand =
  | { kind: 'entry'; type: FinanceEntryType; description: string | null; amount: number }
  | { kind: 'summary'; type: FinanceEntryType }
  | { kind: 'help' }
  | { kind: 'unknown'; raw: string }
