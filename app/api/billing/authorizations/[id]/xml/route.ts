import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { generateAuthorizationXml } from '@/lib/billing/authorizations/xml'

// Validação com xmllint-wasm pode levar alguns segundos na primeira chamada.
export const maxDuration = 60

// Gera o XML na hora (D5: nada no storage), valida no XSD e registra o
// evento xml_generated. Erros de validação saem sem valores.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error

  const supabase = await createClient()
  const generated = await generateAuthorizationXml(supabase, result.session.accountId, id, new Date())
  if (!generated.ok) {
    if ('rpcError' in generated) return authorizationRpcError(generated.rpcError)
    return NextResponse.json(
      { error: generated.error, ...(generated.errors ? { errors: generated.errors } : {}) },
      { status: generated.status },
    )
  }
  return new NextResponse(new Uint8Array(generated.xml), {
    headers: {
      'Content-Type': 'application/xml; charset=ISO-8859-1',
      'Content-Disposition': `attachment; filename="${generated.fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
