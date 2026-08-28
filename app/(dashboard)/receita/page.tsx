import { redirect } from 'next/navigation'

// A tela de receita foi unificada com o ciclo de receita numa página só.
// Mantido como redirect para não quebrar links/marcadores antigos.
export default function ReceitaPage() {
  redirect('/ciclo-receita')
}
