'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus } from 'lucide-react'
import type { Database, AdChannel } from '@/types/database'

type Campaign = Database['public']['Tables']['ad_campaigns']['Row']

const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  google: 'Google Ads',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  outro: 'Outro',
}

const EMPTY_FORM = {
  channel: 'instagram' as AdChannel,
  campaign_name: '',
  period_start: '',
  period_end: '',
  spend: '',
  impressions: '',
  clicks: '',
  leads: '',
}

export function CampaignsClient({ initialCampaigns }: { initialCampaigns: Campaign[] }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const handleCreate = async () => {
    if (!form.channel || !form.period_start || !form.period_end) return
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          spend: Number(form.spend || 0),
          impressions: Number(form.impressions || 0),
          clicks: Number(form.clicks || 0),
          leads: Number(form.leads || 0),
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setCampaigns((prev) => [created, ...prev])
        setForm(EMPTY_FORM)
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setOpen(true)}
          className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          <Plus className="h-4 w-4" />
          Nova campanha
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {campaigns.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma campanha registrada.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Canal</th>
                <th className="px-5 py-3 font-normal">Período</th>
                <th className="px-5 py-3 font-normal">Investimento</th>
                <th className="px-5 py-3 font-normal">Cliques</th>
                <th className="px-5 py-3 font-normal">Leads</th>
                <th className="px-5 py-3 font-normal">CPL</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-[var(--navy-06)] last:border-0">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {CHANNEL_LABEL[c.channel]}
                    {c.campaign_name ? <span className="ml-1 text-gray-400">· {c.campaign_name}</span> : null}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {new Date(c.period_start).toLocaleDateString('pt-BR')} – {new Date(c.period_end).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{formatBRL(Number(c.spend))}</td>
                  <td className="px-5 py-3 text-gray-600">{c.clicks}</td>
                  <td className="px-5 py-3 text-gray-600">{c.leads}</td>
                  <td className="px-5 py-3 text-gray-600">{c.leads > 0 ? formatBRL(Number(c.spend) / c.leads) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova campanha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Canal</Label>
              <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v as AdChannel }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="google">Google Ads</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="campaign_name">Nome da campanha (opcional)</Label>
              <Input
                id="campaign_name"
                value={form.campaign_name}
                onChange={(e) => setForm((f) => ({ ...f, campaign_name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="period_start">Início</Label>
                <Input
                  id="period_start"
                  type="date"
                  value={form.period_start}
                  onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="period_end">Fim</Label>
                <Input
                  id="period_end"
                  type="date"
                  value={form.period_end}
                  onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="spend">Investimento (R$)</Label>
                <Input
                  id="spend"
                  type="number"
                  value={form.spend}
                  onChange={(e) => setForm((f) => ({ ...f, spend: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="clicks">Cliques</Label>
                <Input
                  id="clicks"
                  type="number"
                  value={form.clicks}
                  onChange={(e) => setForm((f) => ({ ...f, clicks: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="impressions">Impressões</Label>
                <Input
                  id="impressions"
                  type="number"
                  value={form.impressions}
                  onChange={(e) => setForm((f) => ({ ...f, impressions: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="leads">Leads</Label>
                <Input
                  id="leads"
                  type="number"
                  value={form.leads}
                  onChange={(e) => setForm((f) => ({ ...f, leads: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={saving}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
