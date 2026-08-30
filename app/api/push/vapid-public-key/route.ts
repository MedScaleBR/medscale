import { NextResponse } from 'next/server'

// A key também está exposta em NEXT_PUBLIC_VAPID_PUBLIC_KEY e pode ser lida
// direto no client. Esta rota existe por consistência com os outros endpoints
// de push e para o client não depender do bundle de env.
export async function GET() {
  return NextResponse.json({ publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null })
}
