'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export function TagInput({ value, onChange, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState('')

  const addTag = () => {
    const tag = draft.trim()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag))

  return (
    <div className="rounded-lg border border-input px-2 py-1.5">
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <Badge key={tag} className="gap-1 border-none bg-[var(--navy-06)] text-[var(--navy)]">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-600">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              removeTag(value[value.length - 1])
            }
          }}
          onBlur={addTag}
          placeholder={value.length === 0 ? placeholder : ''}
          className="h-6 flex-1 border-none p-0 shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  )
}
