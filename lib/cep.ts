// CEP: máscara e consulta ao ViaCEP (usado no cadastro e na página da unidade).
export function maskCep(raw: string): { digits: string; masked: string } {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return { digits, masked: digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits }
}

// null quando o CEP não existe ou a consulta falha.
export async function lookupCep(digits: string): Promise<{ address: string; city: string; state: string } | null> {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    const data = await res.json()
    if (data.erro) return null
    return {
      address: [data.logradouro, data.bairro].filter(Boolean).join(', '),
      city: data.localidade ?? '',
      state: data.uf ?? '',
    }
  } catch {
    return null
  }
}
