// Nomes de canal como a clínica os conhece. Ficam aqui, e não dentro de um
// componente, porque a tabela e a lista de atribuição precisam dos mesmos:
// "Facebook" numa e "facebook" na outra pareceriam canais diferentes.
const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  google: 'Google Ads',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  outro: 'Outro',
}

/** Canal desconhecido volta como veio: inventar rótulo esconderia o dado. */
export function channelLabel(channel: string | null | undefined): string | null {
  if (!channel) return null
  return CHANNEL_LABEL[channel] ?? channel
}
