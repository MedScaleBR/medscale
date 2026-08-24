'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

interface ConsentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ConsentDialog({ open, onOpenChange, onConfirm }: ConsentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Consentimento do paciente</DialogTitle>
          <DialogDescription>
            Confirme que o paciente foi informado de que esta consulta será gravada para fins de
            documentação clínica, e que ele consentiu com a gravação antes de continuar.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            Paciente consentiu, iniciar gravação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
