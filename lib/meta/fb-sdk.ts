// Carregamento do SDK do Facebook, fora do componente e idempotente.
//
// O motivo de existir: `FB.login` abre um popup, e popup só abre enquanto a
// ativação do clique está viva. Se o sdk.js for baixado dentro do handler, o
// download consome essa janela e o Chrome bloqueia o popup em silêncio — o
// callback nunca recebe o `code` e o botão parece não fazer nada. Carregando na
// montagem, o clique chama `FB.login` de forma síncrona.

declare global {
  interface Window {
    FB?: {
      init: (opts: Record<string, unknown>) => void
      login: (cb: (r: { authResponse?: { code?: string } }) => void, opts: Record<string, unknown>) => void
    }
  }
}

const SDK_SRC = 'https://connect.facebook.net/pt_BR/sdk.js'

// Versão do SDK JS, independente da META_GRAPH_VERSION do servidor: aquela não
// é NEXT_PUBLIC e não existe no browser.
const SDK_VERSION = 'v22.0'

let pending: Promise<void> | null = null

export function loadFbSdk(appId: string): Promise<void> {
  if (typeof window !== 'undefined' && window.FB) return Promise.resolve()
  if (pending) return pending

  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.onload = () => {
      // fedCM: false é obrigatório aqui. Sem essa opção o SDK consulta
      // connect.facebook.net/app_config/json/<appId>/, que devolve
      // {"fedcm":{"default":true}} para o nosso app, e aí `FB.login` chama
      // `navigator.credentials.get()` ANTES de abrir o popup — a janela do
      // Embedded Signup só aparece quando o FedCM falha, dezenas de segundos
      // depois. E se o FedCM desse certo seria pior: ele devolve um access
      // token comum, sem o `code` e sem o `config_id` do Embedded Signup, então
      // nunca chegariam waba_id/phone_number_id e a conexão falharia.
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, fedCM: false, version: SDK_VERSION })
      resolve()
    }
    script.onerror = () => {
      // Libera o loader: um blip de rede não pode desabilitar o botão até o
      // usuário recarregar a página.
      pending = null
      reject(new Error('Não foi possível carregar o SDK do Facebook.'))
    }
    document.body.appendChild(script)
  })

  return pending
}

export function resetFbSdkForTests(): void {
  pending = null
}
