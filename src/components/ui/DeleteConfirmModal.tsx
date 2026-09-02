"use client"

import { Button } from "@/components/ui/button"
import { AlertCircle, X } from "lucide-react"

type DeleteConfirmModalProps = {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
    title?: string
    description?: string
    isLoading?: boolean
}

export function DeleteConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title = "İşlemi Sil",
    description = "Bu işlemi silmek istediğinize emin misiniz? Bu işlem geri alınamaz.",
    isLoading = false
}: DeleteConfirmModalProps) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-card w-full max-w-md rounded-[2rem] border border-border/50 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <div className="w-12 h-12 bg-destructive/10 rounded-2xl flex items-center justify-center text-destructive">
                            <AlertCircle className="w-6 h-6" />
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl transition-colors">
                            <X className="w-5 h-5 text-muted-foreground" />
                        </button>
                    </div>

                    <h3 className="text-xl font-black tracking-tight mb-2">{title}</h3>
                    <p className="text-sm text-muted-foreground font-medium mb-8">
                        {description}
                    </p>

                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            onClick={onClose}
                            className="flex-1 rounded-xl h-12 font-bold"
                            disabled={isLoading}
                        >
                            Vazgeç
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={onConfirm}
                            className="flex-1 rounded-xl h-12 font-bold shadow-lg shadow-destructive/20"
                            disabled={isLoading}
                        >
                            {isLoading ? "Siliniyor..." : "Evet, Sil"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
