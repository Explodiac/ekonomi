'use client'

import { useState, useEffect } from "react"
import { Bell, Check, Trash2, Loader2, Info, AlertTriangle, CheckCircle2, XCircle, DollarSign } from "lucide-react"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

type Notification = {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'success' | 'error' | 'transaction';
    is_read: boolean;
    created_at: string;
}

export function NotificationBell() {
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [unreadCount, setUnreadCount] = useState(0)

    const fetchNotifications = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const hhId = await ensureHouseholdExists(user.id)
            if (!hhId) return

            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('household_id', hhId)
                .order('created_at', { ascending: false })
                .limit(20)

            if (data) {
                setNotifications(data)
                setUnreadCount(data.filter(n => !n.is_read).length)
            }
        } catch (error) {
            console.error("Error fetching notifications:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchNotifications()

        // Real-time subscription
        const subscription = supabase
            .channel('notifications_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
                fetchNotifications()
            })
            .subscribe()

        return () => {
            supabase.removeChannel(subscription)
        }
    }, [])

    const markAsRead = async (id: string) => {
        try {
            await supabase.from('notifications').update({ is_read: true }).eq('id', id)
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
            setUnreadCount(prev => Math.max(0, prev - 1))
        } catch (error) {
            console.error("Error marking as read:", error)
        }
    }

    const markAllAsRead = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
            fetchNotifications()
        } catch (error) {
            console.error("Error marking all as read:", error)
        }
    }

    const deleteNotification = async (id: string) => {
        try {
            await supabase.from('notifications').delete().eq('id', id)
            setNotifications(prev => prev.filter(n => n.id !== id))
            if (notifications.find(n => n.id === id && !n.is_read)) {
                setUnreadCount(prev => Math.max(0, prev - 1))
            }
        } catch (error) {
            console.error("Error deleting notification:", error)
        }
    }

    const getIcon = (type: string) => {
        switch (type) {
            case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />
            case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            case 'error': return <XCircle className="h-4 w-4 text-destructive" />
            case 'transaction': return <DollarSign className="h-4 w-4 text-primary" />
            default: return <Info className="h-4 w-4 text-blue-500" />
        }
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className="relative rounded-full p-2 hover:bg-accent hover:text-accent-foreground transition-all active:scale-95 group">
                    <Bell className="h-5 w-5 group-hover:rotate-12 transition-transform" />
                    {unreadCount > 0 && (
                        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-black text-white shadow-lg animate-in fade-in zoom-in">
                            {unreadCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 rounded-[1.5rem] border-border/40 bg-card/50 backdrop-blur-2xl shadow-2xl overflow-hidden" align="end">
                <div className="flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-border/10 bg-muted/20">
                        <h4 className="font-black text-sm tracking-tight">Bildirimler</h4>
                        <div className="flex items-center gap-1">
                            {unreadCount > 0 && (
                                <Button variant="ghost" size="sm" onClick={markAllAsRead} className="h-7 text-[10px] font-black uppercase tracking-widest hover:bg-primary/10 hover:text-primary rounded-lg">
                                    Hepsini Oku
                                </Button>
                            )}
                        </div>
                    </div>

                    <ScrollArea className="h-[350px]">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="h-6 w-6 animate-spin text-primary/20" />
                            </div>
                        ) : notifications.length > 0 ? (
                            <div className="flex flex-col divide-y divide-border/5">
                                {notifications.map((notification) => (
                                    <div
                                        key={notification.id}
                                        className={`p-4 flex gap-3 group transition-colors relative ${!notification.is_read ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                                    >
                                        <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${!notification.is_read ? 'bg-background shadow-sm' : 'bg-muted/50'}`}>
                                            {getIcon(notification.type)}
                                        </div>
                                        <div className="flex-1 space-y-1 overflow-hidden" onClick={() => !notification.is_read && markAsRead(notification.id)}>
                                            <div className="flex justify-between items-start gap-2">
                                                <p className={`text-xs font-black tracking-tight leading-tight truncate ${!notification.is_read ? 'text-foreground' : 'text-muted-foreground'}`}>
                                                    {notification.title}
                                                </p>
                                                <span className="text-[9px] font-bold text-muted-foreground whitespace-nowrap opacity-50">
                                                    {new Date(notification.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                                                {notification.message}
                                            </p>
                                        </div>
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {!notification.is_read && (
                                                <Button size="icon" variant="ghost" className="h-6 w-6 rounded-md hover:bg-emerald-500/10 hover:text-emerald-600" onClick={() => markAsRead(notification.id)}>
                                                    <Check className="h-3 w-3" />
                                                </Button>
                                            )}
                                            <Button size="icon" variant="ghost" className="h-6 w-6 rounded-md hover:bg-destructive/10 hover:text-destructive" onClick={() => deleteNotification(notification.id)}>
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full py-12 px-6 text-center space-y-3 opacity-30">
                                <Bell className="h-10 w-10" />
                                <p className="text-xs font-bold tracking-tight">Yeni bildirim yok</p>
                            </div>
                        )}
                    </ScrollArea>
                </div>
            </PopoverContent>
        </Popover>
    )
}
