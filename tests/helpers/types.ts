import type { Mock } from 'vitest'

// `ReturnType<typeof vi.fn>` resolve para `Mock<Procedure | Constructable>`,
// que o TypeScript não considera chamável (poderia ser um construtor). Este
// alias fixa a assinatura como função comum — é o tipo das dependências
// trocadas por mock dentro dos objetos de `vi.hoisted`.
export type MockFn = Mock<(...args: unknown[]) => unknown>
