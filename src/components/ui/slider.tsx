'use client'

import * as React from "react"
import { cn } from "@/lib/utils"

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
    onValueChange?: (value: number[]) => void
    value?: number[]
    min?: number
    max?: number
    step?: number
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
    ({ className, onValueChange, value, min = 0, max = 100, step = 1, ...props }, ref) => {
        const val = value ? value[0] : (props.defaultValue as number || 0)

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = parseInt(e.target.value, 10)
            onValueChange?.([newValue])
        }

        const percentage = ((val - min) / (max - min)) * 100

        return (
            <div className={cn("relative flex w-full touch-none select-none items-center group", className)}>
                <div className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
                    <div
                        className="absolute h-full bg-primary transition-all"
                        style={{ width: `${percentage}%` }}
                    />
                </div>
                <input
                    type="range"
                    ref={ref}
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={handleChange}
                    className="absolute h-1.5 w-full opacity-0 cursor-pointer z-10"
                    {...props}
                />
                <div
                    className="absolute h-4 w-4 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-hover:scale-125 transition-transform"
                    style={{ left: `calc(${percentage}% - 8px)` }}
                />
            </div>
        )
    }
)
Slider.displayName = "Slider"

export { Slider }
