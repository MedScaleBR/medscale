'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, X } from 'lucide-react'

export interface FaqItem {
  question: string
  answer: string
}

interface FaqInputProps {
  value: FaqItem[]
  onChange: (items: FaqItem[]) => void
}

export function FaqInput({ value, onChange }: FaqInputProps) {
  const updateItem = (index: number, patch: Partial<FaqItem>) => {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const removeItem = (index: number) => onChange(value.filter((_, i) => i !== index))

  const addItem = () => onChange([...value, { question: '', answer: '' }])

  return (
    <div className="space-y-3">
      {value.map((item, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-[var(--navy-06)] p-3">
          <div className="flex items-center gap-2">
            <Input
              value={item.question}
              onChange={(e) => updateItem(i, { question: e.target.value })}
              placeholder="Pergunta (ex: Vocês atendem crianças?)"
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="shrink-0 text-gray-400 hover:text-red-600"
              aria-label="Remover pergunta"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Textarea
            value={item.answer}
            onChange={(e) => updateItem(i, { answer: e.target.value })}
            placeholder="Resposta"
            rows={2}
          />
        </div>
      ))}
      <Button type="button" variant="outline" onClick={addItem} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Adicionar pergunta
      </Button>
    </div>
  )
}
