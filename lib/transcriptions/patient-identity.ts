import { normalizeBrazilianPhone } from '@/lib/phone'

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

export function matchesAppointmentPatient(
  patient: { full_name: string; phone: string },
  appointment: { patient_name: string; patient_phone: string },
) {
  const phone = normalizeBrazilianPhone(patient.phone)
  return phone !== null && phone === normalizeBrazilianPhone(appointment.patient_phone)
    && normalizeName(patient.full_name) === normalizeName(appointment.patient_name)
}

export const PATIENT_MISMATCH_MESSAGE = 'O paciente cadastrado não corresponde ao nome e telefone da consulta. Corrija o vínculo do paciente antes de gravar.'
