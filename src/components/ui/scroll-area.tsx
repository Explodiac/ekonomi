'use client'

import * as React from "react"
import { cn } from "@/lib/utils"

export function ScrollArea({ children, className, ...props }: any) {
    return (
        <div
            className={cn("relative overflow-hidden", className)}
            {...props}
        >
            <div className="h-full w-full overflow-auto scrollbar-hide">
                {children}
            </div>
            <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
        </div>
    )
}
