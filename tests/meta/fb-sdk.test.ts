import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadFbSdk, resetFbSdkForTests } from '@/lib/meta/fb-sdk'

// O SDK do Facebook só pode ser carregado ANTES do clique: se o download
// acontecer durante o handler, a ativação do gesto expira e o Chrome bloqueia
// o popup do Embedded Signup sem erro nenhum. Estes testes fixam o contrato
// que o botão depende: carregar uma única vez, resolver na segunda chamada sem
// tocar no DOM, e errar alto quando o script não vem.

type FakeScript = {
  src: string
  async: boolean
  onload: (() => void) | null
  onerror: (() => void) | null
}

function fakeDom() {
  const scripts: FakeScript[] = []
  const win = {} as { FB?: unknown }
  const doc = {
    createElement: () => ({ src: '', async: false, onload: null, onerror: null }) as FakeScript,
    body: { appendChild: (s: FakeScript) => scripts.push(s) },
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  return { scripts, win }
}

/** Simula o sdk.js chegando: ele define window.FB e dispara onload. */
function sdkArrives(script: FakeScript, win: { FB?: unknown }) {
  win.FB = { init: vi.fn(), login: vi.fn() }
  script.onload?.()
}

describe('loadFbSdk', () => {
  beforeEach(() => {
    resetFbSdkForTests()
  })

  it('injeta o script e inicializa o SDK com o appId', async () => {
    const { scripts, win } = fakeDom()

    const promise = loadFbSdk('1391295809860867')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toContain('connect.facebook.net')

    sdkArrives(scripts[0], win)
    await promise

    const fb = win.FB as { init: ReturnType<typeof vi.fn> }
    expect(fb.init).toHaveBeenCalledWith(expect.objectContaining({ appId: '1391295809860867' }))
  })

  it('não injeta o script duas vezes em chamadas concorrentes', async () => {
    const { scripts, win } = fakeDom()

    const a = loadFbSdk('123')
    const b = loadFbSdk('123')
    expect(scripts).toHaveLength(1)

    sdkArrives(scripts[0], win)
    await Promise.all([a, b])
  })

  it('resolve sem tocar no DOM quando o SDK já está carregado', async () => {
    const { scripts, win } = fakeDom()

    const first = loadFbSdk('123')
    sdkArrives(scripts[0], win)
    await first

    await loadFbSdk('123')
    expect(scripts).toHaveLength(1)
  })

  it('rejeita quando o script falha, e permite tentar de novo', async () => {
    const { scripts, win } = fakeDom()

    const promise = loadFbSdk('123')
    scripts[0].onerror?.()
    await expect(promise).rejects.toThrow(/SDK do Facebook/)

    // A falha não pode deixar o loader travado: sem isso, um blip de rede
    // desabilitaria o botão até o usuário recarregar a página.
    const retry = loadFbSdk('123')
    expect(scripts).toHaveLength(2)
    sdkArrives(scripts[1], win)
    await retry
  })
})
