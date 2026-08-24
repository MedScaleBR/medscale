'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Plus, X } from 'lucide-react'
import type { SOAPRecord } from '@/lib/transcriptions/types'

type SOAPEditorProps = {
  initialValue: SOAPRecord
  readOnly?: boolean
  onChange?: (value: SOAPRecord) => void
}

function EditableList({
  items,
  onChange,
  readOnly,
  placeholder,
}: {
  items: string[]
  onChange: (items: string[]) => void
  readOnly?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const addItem = () => {
    if (!draft.trim()) return
    onChange([...items, draft.trim()])
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      {items.length === 0 && readOnly && <p className="text-sm text-gray-400">—</p>}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="flex-1 rounded-lg border border-[var(--navy-06)] bg-[var(--navy-06)]/30 px-2.5 py-1.5 text-sm text-gray-700">
            {item}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-gray-400 hover:text-red-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addItem()
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </Button>
        </div>
      )}
    </div>
  )
}

export function SOAPEditor({ initialValue, readOnly = false, onChange }: SOAPEditorProps) {
  const [value, setValue] = useState<SOAPRecord>(initialValue)

  const update = (next: SOAPRecord) => {
    setValue(next)
    onChange?.(next)
  }

  const setS = (patch: Partial<SOAPRecord['soap']['S']>) =>
    update({ ...value, soap: { ...value.soap, S: { ...value.soap.S, ...patch } } })
  const setO = (patch: Partial<SOAPRecord['soap']['O']>) =>
    update({ ...value, soap: { ...value.soap, O: { ...value.soap.O, ...patch } } })
  const setA = (patch: Partial<SOAPRecord['soap']['A']>) =>
    update({ ...value, soap: { ...value.soap, A: { ...value.soap.A, ...patch } } })
  const setP = (patch: Partial<SOAPRecord['soap']['P']>) =>
    update({ ...value, soap: { ...value.soap, P: { ...value.soap.P, ...patch } } })

  return (
    <div className="space-y-4">
      {value.resumo && (
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4">
          <p className="mb-1 text-xs font-medium text-gray-400">Resumo</p>
          <p className="text-sm text-gray-700">{value.resumo}</p>
        </div>
      )}

      <Tabs defaultValue="s">
        <TabsList>
          <TabsTrigger value="s">S — Subjetivo</TabsTrigger>
          <TabsTrigger value="o">O — Objetivo</TabsTrigger>
          <TabsTrigger value="a">A — Avaliação</TabsTrigger>
          <TabsTrigger value="p">P — Plano</TabsTrigger>
        </TabsList>

        <TabsContent value="s" className="space-y-3 pt-3">
          <div>
            <Label>Queixa principal</Label>
            <Textarea
              readOnly={readOnly}
              value={value.soap.S.queixa_principal}
              onChange={(e) => setS({ queixa_principal: e.target.value })}
            />
          </div>
          <div>
            <Label>História da doença atual</Label>
            <Textarea
              readOnly={readOnly}
              value={value.soap.S.historia_atual}
              onChange={(e) => setS({ historia_atual: e.target.value })}
            />
          </div>
          <div>
            <Label>Antecedentes</Label>
            <Textarea
              readOnly={readOnly}
              value={value.soap.S.antecedentes ?? ''}
              onChange={(e) => setS({ antecedentes: e.target.value || null })}
            />
          </div>
          <div>
            <Label>Medicamentos em uso</Label>
            <EditableList
              items={value.soap.S.medicamentos_em_uso}
              onChange={(items) => setS({ medicamentos_em_uso: items })}
              readOnly={readOnly}
              placeholder="Nome do medicamento"
            />
          </div>
        </TabsContent>

        <TabsContent value="o" className="space-y-3 pt-3">
          <div>
            <Label>Exame físico</Label>
            <Textarea
              readOnly={readOnly}
              value={value.soap.O.exame_fisico ?? ''}
              onChange={(e) => setO({ exame_fisico: e.target.value || null })}
            />
          </div>
          <div>
            <Label>Exames solicitados</Label>
            <EditableList
              items={value.soap.O.exames_solicitados}
              onChange={(items) => setO({ exames_solicitados: items })}
              readOnly={readOnly}
              placeholder="Nome do exame"
            />
          </div>
          <div>
            <Label>Resultados de exames</Label>
            <Textarea
              readOnly={readOnly}
              value={value.soap.O.exames_resultados ?? ''}
              onChange={(e) => setO({ exames_resultados: e.target.value || null })}
            />
          </div>
        </TabsContent>

        <TabsContent value="a" className="space-y-3 pt-3">
          <div>
            <Label>Hipótese diagnóstica</Label>
            <Input
              readOnly={readOnly}
              value={value.soap.A.hipotese_diagnostica}
              onChange={(e) => setA({ hipotese_diagnostica: e.target.value })}
            />
          </div>
          <div>
            <Label>Diagnósticos secundários</Label>
            <EditableList
              items={value.soap.A.diagnosticos_secundarios}
              onChange={(items) => setA({ diagnosticos_secundarios: items })}
              readOnly={readOnly}
              placeholder="Diagnóstico secundário"
            />
          </div>
          <div>
            <Label>CID-10</Label>
            <Input
              readOnly={readOnly}
              value={value.soap.A.cid10 ?? ''}
              onChange={(e) => setA({ cid10: e.target.value || null })}
            />
          </div>
        </TabsContent>

        <TabsContent value="p" className="space-y-3 pt-3">
          <div>
            <Label>Prescrição</Label>
            <EditableList
              items={value.soap.P.prescricao}
              onChange={(items) => setP({ prescricao: items })}
              readOnly={readOnly}
              placeholder="Medicamento e posologia"
            />
          </div>
          <div>
            <Label>Orientações</Label>
            <EditableList
              items={value.soap.P.orientacoes}
              onChange={(items) => setP({ orientacoes: items })}
              readOnly={readOnly}
              placeholder="Orientação ao paciente"
            />
          </div>
          <div>
            <Label>Retorno</Label>
            <Input
              readOnly={readOnly}
              value={value.soap.P.retorno ?? ''}
              onChange={(e) => setP({ retorno: e.target.value || null })}
            />
          </div>
          <div>
            <Label>Encaminhamentos</Label>
            <EditableList
              items={value.soap.P.encaminhamentos}
              onChange={(items) => setP({ encaminhamentos: items })}
              readOnly={readOnly}
              placeholder="Especialidade ou serviço"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
