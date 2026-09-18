'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientName: string
  patientPhone: string
  patientId: string | null
  onScheduled: (scheduledAt: string) => void
}

interface Slot {
  start: string
  label: string
  available: boolean
}

// Os cinco próximos dias úteis dão a mesma janela do desenho sem transformar
// isso numa agenda completa — para escolher outra data existe /agenda.
function nextDays(count: number) {
  const days: { value: string; label: string }[] = []
  const cursor = new Date()
  while (days.length < count) {
    cursor.setDate(cursor.getDate() + 1)
    const weekday = cursor.getDay()
    if (weekday === 0 || weekday === 6) continue
    days.push({
      value: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      label: cursor.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
    })
  }
  return days
}

export function ScheduleDialog({
  open,
  onOpenChange,
  patientName,
  patientPhone,
  patientId,
  onScheduled,
}: ScheduleDialogProps) {
  const [days] = useState(() => nextDays(5))
  const [date, setDate] = useState(days[0].value)
  const [time, setTime] = useState<string | null>(null)
  // slots === null significa "ainda carregando": um estado só, em vez de um
  // setLoading síncrono dentro do efeito (que dispara render em cascata).
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setSlots(null)
    setTime(null)
    setError(null)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/agenda/slots?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('slots'))))
      .then((data: { slots: Slot[] }) => {
        if (cancelled) return
        const free = (data.slots ?? []).filter((s) => s.available)
        setSlots(free)
        setTime(free[0]?.start ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setSlots([])
        setError('Não deu para carregar os horários deste dia.')
      })
    return () => {
      cancelled = true
    }
  }, [open, date])

  const handleConfirm = async () => {
    if (!time) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_name: patientName,
          patient_phone: patientPhone,
          patient_id: patientId,
          scheduled_at: time,
        }),
      })
      if (!res.ok) throw new Error('create failed')
      onScheduled(time)
      onOpenChange(false)
    } catch {
      setError('Não deu para agendar. Confira a agenda e tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Fechar limpa os horários: reabrir mostra "carregando", não a lista do
        // dia anterior enquanto o fetch novo não volta.
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Agendar consulta</DialogTitle>
          <DialogDescription>{patientName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agendar-data">Data</Label>
            <Select
              items={days}
              value={date}
              onValueChange={(v) => {
                if (!v) return
                reset()
                setDate(v as string)
              }}
            >
              <SelectTrigger id="agendar-data" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agendar-horario">Horário</Label>
            {slots === null ? (
              <p className="text-sm text-gray-400">Carregando horários...</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhum horário livre neste dia.</p>
            ) : (
              <Select
                items={slots.map((s) => ({ value: s.start, label: s.label }))}
                value={time ?? ''}
                onValueChange={(v) => v && setTime(v as string)}
              >
                <SelectTrigger id="agendar-horario" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((s) => (
                    <SelectItem key={s.start} value={s.start}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!time || saving}>
            {saving ? 'Agendando...' : 'Confirmar horário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
