export function AudioPlayer({ audioUrl }: { audioUrl: string | null }) {
  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <p className="mb-2 text-xs font-medium text-gray-400">Áudio da consulta</p>
      {audioUrl ? (
        <audio controls preload="none" src={audioUrl} className="w-full">
          Seu navegador não suporta reprodução de áudio.
        </audio>
      ) : (
        <p className="text-sm text-gray-400">Áudio removido após o período de retenção.</p>
      )}
    </div>
  )
}
