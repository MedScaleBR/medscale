import { TZDate } from '@date-fns/tz'

// Interpretação determinística da resposta da clínica parceira (template
// "CONSULTA AGENDADA" da IAD). Pura — nenhuma chamada ao Claude.
const TZ = 'America/Sao_Paulo'

export interface ClinicConfirmation {
  /** Instante exato da consulta (montado em America/Sao_Paulo). */
  scheduledAt: Date
  /** Nome do paciente se veio numa linha solta entre o cabeçalho e os campos. */
  patientName: string | null
  /** Só informativo — cada account tem um único médico, nunca entra na correlação. */
  doctorName: string | null
}

// Tolera emojis, espaços e pontuação antes do rótulo.
const LEAD = String.raw`^[^\p{L}\p{N}]*`
const HEADER_RE = new RegExp(String.raw`${LEAD}consulta\s+agendada(?!\p{L})`, 'iu')
const DATE_RE = new RegExp(String.raw`${LEAD}data\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)`, 'iu')
const TIME_RE = new RegExp(String.raw`${LEAD}hor[aá]rio\s*:\s*(\d{1,2})\s*[:hH]\s*(\d{2})(?!\d)`, 'iu')
const DOCTOR_RE = new RegExp(String.raw`${LEAD}m[eé]dic[oa]\s*:\s*(.+)$`, 'iu')
const LABEL_RE = /^[^\p{L}\p{N}]*[\p{L} ]{2,30}:/u
const NAME_RE = /^\p{L}[\p{L}'’. -]*[\p{L}.]$/u
const HEADER_VETO_RE = /(?<!\p{L})(n[aã]o|cancelad[ao]|desmarcad[ao])(?!\p{L})/iu
const NEGATION_RE = /(?<!\p{L})(n[aã]o|sem\s+vaga|indispon[ií]ve(l|is))(?!\p{L})/iu

function buildInstant(d: number, m: number, y: number, hh: number, mm: number): Date | null {
  if (hh > 23 || mm > 59) return null
  const zoned = new TZDate(y, m - 1, d, hh, mm, 0, TZ)
  // Data inexistente (31/02) rola para o mês seguinte — rejeita.
  if (zoned.getFullYear() !== y || zoned.getMonth() !== m - 1 || zoned.getDate() !== d) return null
  return new Date(zoned.getTime())
}

export function parseClinicConfirmation(text: string): ClinicConfirmation | null {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim())
  const headerIdx = lines.findIndex((l) => HEADER_RE.test(l))
  if (headerIdx === -1) return null
  // Cabeçalho negado/cancelado, ou dois blocos na mesma mensagem: ambíguo, equipe resolve.
  if (HEADER_VETO_RE.test(lines[headerIdx])) return null
  if (lines.slice(headerIdx + 1).some((l) => HEADER_RE.test(l))) return null

  let date: RegExpMatchArray | null = null
  let time: RegExpMatchArray | null = null
  let doctorName: string | null = null
  let doctorSeen = false
  const fieldIdx: number[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    const d: RegExpMatchArray | null = !date ? line.match(DATE_RE) : null
    if (d) { date = d; fieldIdx.push(i); continue }
    const t: RegExpMatchArray | null = !time ? line.match(TIME_RE) : null
    if (t) { time = t; fieldIdx.push(i); continue }
    const doc = !doctorSeen ? line.match(DOCTOR_RE) : null
    if (doc) { doctorSeen = true; doctorName = doc[1].trim() || null; fieldIdx.push(i) }
  }
  if (!date || !time) return null

  const scheduledAt = buildInstant(Number(date[1]), Number(date[2]), Number(date[3]), Number(time[1]), Number(time[2]))
  if (!scheduledAt) return null

  // O nome do paciente é uma linha solta entre o cabeçalho e o primeiro campo.
  const stop = Math.min(...fieldIdx)
  const patientName =
    lines.slice(headerIdx + 1, stop).find((l) => l && !LABEL_RE.test(l) && NAME_RE.test(l)) ?? null

  return { scheduledAt, patientName, doctorName }
}

export function classifyUnparsedReply(text: string): 'negacao' | 'ambiguo' {
  return NEGATION_RE.test(text ?? '') ? 'negacao' : 'ambiguo'
}

export function normalizePersonName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Mesmo paciente: nomes iguais ou todos os tokens de um contidos no outro
// ("Marilene Ribeiro" × "Marilene Ribeiro Santos").
function samePerson(a: string, b: string): boolean {
  const ta = normalizePersonName(a).split(' ').filter(Boolean)
  const tb = normalizePersonName(b).split(' ').filter(Boolean)
  if (ta.length === 0 || tb.length === 0) return false
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)]
  return short.every((t) => long.has(t))
}

// Sem nome no template, só confirma com exatamente 1 candidato. Com nome, ele
// precisa casar com exatamente 1 candidato — inclusive quando só há um (nunca
// confirma o paciente errado). Qualquer outro caso → null (equipe resolve).
export function pickPendingMatch(
  candidates: { id: string; patient_name: string }[],
  parsedName: string | null
): string | null {
  if (candidates.length === 0) return null
  if (!parsedName) return candidates.length === 1 ? candidates[0].id : null
  const named = candidates.filter((c) => samePerson(c.patient_name, parsedName))
  return named.length === 1 ? named[0].id : null
}
