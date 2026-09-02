'use client'

import * as React from "react"
import { cn } from "@/lib/utils"

interface PopoverProps {
    children: React.ReactNode
}

export function Popover({ children }: PopoverProps) {
    const [isOpen, setIsOpen] = React.useState(false)
    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    return (
        <div className="relative inline-block" ref={containerRef}>
            {React.Children.map(children, (child) => {
                if (React.isValidElement(child)) {
                    // Pass isOpen and setIsOpen to children via context or cloning
                    // For simplicity in this shell, we'll use a local state and clone
                    if ((child.type as any).displayName === 'PopoverTrigger') {
                        return React.cloneElement(child as any, { onClick: () => setIsOpen(!isOpen) })
                    }
                    if ((child.type as any).displayName === 'PopoverContent') {
                        return isOpen ? child : null
                    }
                }
                return child
            })}
        </div>
    )
}

export function PopoverTrigger({ children, onClick, asChild, ...props }: any) {
    if (asChild) {
        return React.cloneElement(children, { onClick, ...props })
    }
    return <button onClick={onClick} {...props}>{children}</button>
}
PopoverTrigger.displayName = 'PopoverTrigger'

export function PopoverContent({ children, className, align = "center", ...props }: any) {
    const alignmentClasses = {
        start: "left-0",
        center: "left-1/2 -translate-x-1/2",
        end: "right-0"
    }

    return (
        <div
            className={cn(
                "absolute z-50 mt-2 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in zoom-in-95 duration-200",
                alignmentClasses[align as keyof typeof alignmentClasses],
                className
            )}
            {...props}
        >
            {children}
        </div>
    )
}
PopoverContent.displayName = 'PopoverContent'
