'use client'

import { useMemo, useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Plus, RefreshCw, Wallet, Users, Receipt } from 'lucide-react'
import { KpiCard } from '@/components/trafego/KpiCard'
import { LeadsChart } from '@/components/trafego/LeadsChart'
import { byCampaign, leadsByBucket, summarize, withinPeriod } from '@/lib/trafego/aggregate'
import type { Database, AdChannel } from '@/types/database'

type Campaign = Database['public']['Tables']['ad_campaigns']['Row']

const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  google: 'Google Ads',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  outro: 'Outro',
}

const PERIODS = [
  { days: 7, label: 'Últimos 7 dias', subtitle: 'Por dia' },
  { days: 30, label: 'Últimos 30 dias', subtitle: 'Por semana' },
  { days: 90, label: 'Últimos 90 dias', subtitle: 'Por mês' },
] as const

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

const ALL = 'todos'

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function CampaignsClient({
  initialCampaigns,
  today,
}: {
  initialCampaigns: Campaign[]
  /** ISO vindo do servidor: se o cliente calculasse `new Date()` na hidratação,
   *  os rótulos do gráfico poderiam divergir do HTML renderizado. */
  today: string
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [days, setDays] = useState<number>(30)
  const [channel, setChannel] = useState<string>(ALL)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const period = PERIODS.find((p) => p.days === days) ?? PERIODS[1]

  const view = useMemo(() => {
    const now = new Date(today)
    const inPeriod = withinPeriod(campaigns, days, now)
    const filtered = channel === ALL ? inPeriod : inPeriod.filter((c) => c.channel === channel)
    return {
      // Os canais do filtro saem dos dados: oferecer "Google Ads" numa conta que
      // só roda Meta é prometer um filtro que sempre volta vazio.
      channels: [...new Set(inPeriod.map((c) => c.channel))].sort(),
      summary: summarize(filtered),
      buckets: leadsByBucket(filtered, days, now),
      rows: byCampaign(filtered),
    }
  }, [campaigns, days, channel, today])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch(`/api/meta/ads/sync?days=${days}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setSyncError(json.error ?? 'Não foi possível sincronizar.')
        return
      }
      const listRes = await fetch('/api/campaigns')
      if (listRes.ok) {
        setCampaigns(await listRes.json())
      }
    } catch {
      setSyncError('Não foi possível sincronizar.')
    } finally {
      setSyncing(false)
    }
  }

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-strong)]">Tráfego pago</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Investimento, leads e custo por lead por campanha
          </p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.days} value={String(p.days)}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[ALL, ...view.channels].map((value) => {
            const active = channel === value
            return (
              <button
                key={value}
                onClick={() => setChannel(value)}
                className={`h-8 rounded-[10px] border px-3.5 text-[13px] font-medium transition-colors ${
                  active
                    ? 'border-[var(--cyan)] bg-[var(--cyan-10)] text-[var(--cyan-dark)]'
                    : 'border-[var(--navy-06)] bg-white text-[var(--text-muted)]'
                }`}
              >
                {value === ALL ? 'Todos' : (CHANNEL_LABEL[value] ?? value)}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3">
          {syncError && <p className="text-xs text-red-500">{syncError}</p>}
          <Button variant="outline" onClick={handleSync} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Atualizando...' : 'Atualizar agora'}
          </Button>
          <Button
            onClick={() => setOpen(true)}
            className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            <Plus className="h-4 w-4" />
            Nova campanha
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Investimento total" value={formatBRL(view.summary.spend)} icon={Wallet} />
        <KpiCard label="Leads gerados" value={String(view.summary.leads)} icon={Users} />
        <KpiCard
          label="CPL médio"
          value={view.summary.cpl === null ? '—' : formatBRL(view.summary.cpl)}
          icon={Receipt}
        />
      </div>

      <LeadsChart buckets={view.buckets} subtitle={period.subtitle} />

      <div className="overflow-hidden rounded-[14px] border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {view.rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-muted)]">
            Nenhuma campanha registrada neste período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-3 font-normal">Campanha</th>
                  <th className="px-5 py-3 font-normal">Canal</th>
                  <th className="px-5 py-3 text-right font-normal">Investimento</th>
                  <th className="px-5 py-3 text-right font-normal">Cliques</th>
                  <th className="px-5 py-3 text-right font-normal">Leads</th>
                  <th className="px-5 py-3 text-right font-normal">CPL</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr
                    key={`${row.channel}-${row.campaign_name}`}
                    className="border-b border-[var(--navy-06)] last:border-0"
                  >
                    <td className="px-5 py-3 font-medium text-[var(--text-strong)]">
                      {row.campaign_name ?? 'Sem nome'}
                      {row.synced && (
                        <Badge className="ml-2 border-none bg-[var(--cyan-10)] align-middle text-[var(--cyan-dark)]">
                          sincronizado
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-body)]">
                      {CHANNEL_LABEL[row.channel] ?? row.channel}
                    </td>
                    <td className="px-5 py-3 text-right text-[var(--text-body)]">
                      {formatBRL(row.spend)}
                    </td>
                    <td className="px-5 py-3 text-right text-[var(--text-body)]">{row.clicks}</td>
                    <td className="px-5 py-3 text-right text-[var(--text-body)]">{row.leads}</td>
                    <td className="px-5 py-3 text-right text-[var(--text-body)]">
                      {row.cpl === null ? '—' : formatBRL(row.cpl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
