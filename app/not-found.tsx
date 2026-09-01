import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Página não encontrada — MedScale",
  description: "A página que você procura não existe ou foi movida.",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#0F1E45] px-6 py-16 text-center">
      <h1 className="sr-only">Página não encontrada</h1>

      <Image
        src="/medscale-404.svg"
        alt="Erro 404 — a página que você acessou não existe ou foi movida"
        width={800}
        height={520}
        priority
        className="h-auto w-full max-w-lg"
      />

      <Link
        href="/"
        className="inline-flex items-center rounded-lg bg-[#00B9D8] px-5 py-2.5 text-sm font-medium text-[#0F1E45] transition-colors hover:bg-[#00B9D8]/90"
      >
        Voltar para o início
      </Link>
    </main>
  );
}
