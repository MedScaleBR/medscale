'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecordingButton } from './RecordingButton'
import { Mic, Search, ChevronLeft } from 'lucide-react'

type Patient = { id: string; full_name: string; phone: string }

export function NewTranscriptionButton({ patients }: { patients: Patient[] }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Patient | null>(null)

  const filtered = patients.filter(
    (p) => p.full_name.toLowerCase().includes(search.toLowerCase()) || p.phone.includes(search)
  )

  const reset = () => {
    setSearch('')
    setSelected(null)
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        <Mic className="h-4 w-4" />
        Nova transcrição
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova transcrição</DialogTitle>
          </DialogHeader>

          {selected ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-[var(--cyan-dark)]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Trocar paciente
              </button>
              <div className="rounded-lg border border-[var(--navy-06)] bg-[var(--navy-06)]/20 p-3">
                <p className="text-sm font-medium text-gray-900">{selected.full_name}</p>
                <p className="text-xs text-gray-400">{selected.phone}</p>
              </div>
              <div className="flex justify-end">
                <RecordingButton patientId={selected.id} onComplete={() => setOpen(false)} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  autoFocus
                  className="pl-9"
                  placeholder="Buscar paciente por nome ou telefone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--navy-06)]">
                {filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">Nenhum paciente encontrado.</p>
                ) : (
                  filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p)}
                      className="flex w-full flex-col items-start gap-0.5 border-b border-[var(--navy-06)] px-3 py-2 text-left last:border-0 hover:bg-[var(--navy-06)]/40"
                    >
                      <span className="text-sm font-medium text-gray-900">{p.full_name}</span>
                      <span className="text-xs text-gray-400">{p.phone}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
