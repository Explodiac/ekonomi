"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { supabase, ensureHouseholdExists } from "@/lib/supabase"
import { Trash2, Loader2, ChevronRight } from "lucide-react"
import { PrimaryButton } from "@/components/ui/primary-button"
import { Segmented } from "@/components/ui/segmented"
import { CategoryTile } from "@/components/dashboard/category-tile"
import { CategoryNatureClassifier } from "@/components/categories/category-nature-classifier"

type Category = {
    id: string
    name: string
    type: 'income' | 'expense'
    is_recurring: boolean
    parent_id: string | null
    is_interest?: boolean
}

export default function CategoriesPage() {
    const [categories, setCategories] = useState<Category[]>([])
    const [name, setName] = useState('')
    const [type, setType] = useState<'income' | 'expense'>('expense')
    const [parentId, setParentId] = useState<string>('')
    const [isRecurring, setIsRecurring] = useState(false)
    const [isInterest, setIsInterest] = useState(false)
    const [hhId, setHhId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)

    // Silme onayı; parent'sa çocuk davranışı sorulur
    const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

    const fetchAll = async () => {
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const id = await ensureHouseholdExists(user.id)
            setHhId(id)
            const { data, error } = await supabase.from('categories').select('id, name, type, is_recurring, parent_id, is_interest').eq('household_id', id).order('name')
            if (error) throw error
            setCategories(data || [])
        } catch (e: any) {
            console.error('Kategoriler yüklenemedi:', e)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => { fetchAll() }, [])

    // Seçili türe göre üst-seviye kategoriler = parent adayları
    const parentOptions = useMemo(
        () => categories.filter(c => c.type === type && !c.parent_id),
        [categories, type]
    )
    // Tür değişince geçersiz parent seçimini temizle
    useEffect(() => { if (parentId && !parentOptions.some(p => p.id === parentId)) setParentId('') }, [parentOptions, parentId])

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim() || !hhId) return
        setIsSaving(true)
        try {
            const markInterest = type === 'expense' && isInterest
            // Tek "Faiz & ücretler" kategorisi: yeni işaretlenirse eskisinin bayrağı kalkar.
            if (markInterest) {
                await supabase.from('categories').update({ is_interest: false }).eq('household_id', hhId).eq('is_interest', true)
            }
            const { error } = await supabase.from('categories').insert({
                household_id: hhId, name: name.trim(), type,
                parent_id: parentId || null, is_recurring: isRecurring, budget_limit: 0,
                is_interest: markInterest,
            })
            if (error) throw error
            setName(''); setParentId(''); setIsRecurring(false); setIsInterest(false)
            fetchAll()
        } catch (e: any) {
            alert('Kategori eklenemedi: ' + e.message)
        } finally {
            setIsSaving(false)
        }
    }

    const reassignParent = async (catId: string, newParent: string) => {
        try {
            await supabase.from('categories').update({ parent_id: newParent || null }).eq('id', catId)
            fetchAll()
        } catch (e: any) {
            alert('Üst kategori değiştirilemedi: ' + e.message)
        }
    }

    // childMode: 'promote' → çocuklar üst seviyeye; 'cascade' → hepsi silinsin
    const doDelete = async (cat: Category, childMode?: 'promote' | 'cascade') => {
        try {
            if (childMode === 'cascade') {
                const kids = categories.filter(c => c.parent_id === cat.id).map(c => c.id)
                if (kids.length) await supabase.from('categories').delete().in('id', kids)
            }
            // 'promote' için FK ON DELETE SET NULL zaten çocukları üst seviyeye çıkarır.
            const { error } = await supabase.from('categories').delete().eq('id', cat.id)
            if (error) throw error
            setDeleteTarget(null)
            fetchAll()
        } catch (e: any) {
            alert('Kategori silinemedi: ' + e.message)
        }
    }

    // Hiyerarşik gruplama: tür → üst-seviye → çocuklar
    const tree = useMemo(() => {
        const build = (t: 'expense' | 'income') => {
            const tops = categories.filter(c => c.type === t && !c.parent_id)
            return tops.map(top => ({
                cat: top,
                children: categories.filter(c => c.parent_id === top.id),
            }))
        }
        return { expense: build('expense'), income: build('income') }
    }, [categories])

    const inputStyle = { background: 'var(--bg)', borderRadius: 'var(--r-button)', color: 'var(--ink)', fontSize: 14.5 } as const

    return (
        <div className="flex flex-col gap-[var(--s3)] pb-10">
            {/* Yeni kategori formu */}
            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="space-y-[var(--s4)] p-[22px]">
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Yeni kategori</div>
                <form onSubmit={handleAdd} className="space-y-[var(--s3)]">
                    <div className="flex items-center gap-[var(--s3)]">
                        <CategoryTile name={name || 'Diğer'} size={38} />
                        <input
                            placeholder="Örn: Market, Kira, Freelance…"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            className="w-full px-[var(--s4)] py-[var(--s3)] outline-none"
                            style={inputStyle}
                        />
                    </div>
                    <Segmented
                        options={[{ value: 'expense', label: 'Gider' }, { value: 'income', label: 'Gelir' }]}
                        value={type}
                        onChange={setType}
                    />
                    <div>
                        <label className="mb-[6px] block" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Üst kategori (opsiyonel)</label>
                        <select
                            value={parentId}
                            onChange={e => setParentId(e.target.value)}
                            className="w-full px-[var(--s4)] py-[var(--s3)] outline-none"
                            style={inputStyle}
                        >
                            <option value="">Üst seviye (bağımsız)</option>
                            {parentOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <label className="flex cursor-pointer items-center gap-[var(--s3)]">
                        <Toggle on={isRecurring} onToggle={() => setIsRecurring(v => !v)} />
                        <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Tekrarlayan işlem (her ay otomatik takip)</span>
                    </label>
                    {type === 'expense' && (
                        <label className="flex cursor-pointer items-start gap-[var(--s3)]">
                            <Toggle on={isInterest} onToggle={() => setIsInterest(v => !v)} />
                            <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                                Faiz &amp; ücretler kategorisi
                                <span className="block" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                                    Kart/KMH faizi, gecikme, aidat. Nefes payında alışkanlık değil zorunlu çıkış sayılır; bütçe konulamaz.
                                </span>
                            </span>
                        </label>
                    )}
                    <PrimaryButton type="submit" disabled={isSaving} className="w-full">
                        {isSaving ? '…' : 'Kategoriyi kaydet'}
                    </PrimaryButton>
                </form>
            </section>

            {/* Harcama doğası — geriye dönük toplu sınıflandırma */}
            <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="space-y-[var(--s3)] p-[22px]">
                <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Harcama doğası</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Sınıflanmamış kategorileri alışkanlık / tek seferlik olarak işaretle — nefes payı tahmini doğrulaşır.</div>
                </div>
                <CategoryNatureClassifier onChanged={fetchAll} />
            </section>

            {/* Kategori listesi — hiyerarşik */}
            {isLoading ? (
                <div className="flex items-center justify-center py-[var(--s6)]"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--ink-3)' }} /></div>
            ) : (
                <>
                    <CategoryGroup
                        title="Gider kategorileri" groups={tree.expense} allCats={categories}
                        inputStyle={inputStyle} onReassign={reassignParent} onDelete={setDeleteTarget}
                    />
                    <CategoryGroup
                        title="Gelir kategorileri" groups={tree.income} allCats={categories}
                        inputStyle={inputStyle} onReassign={reassignParent} onDelete={setDeleteTarget}
                    />
                </>
            )}

            {/* Silme onayı */}
            {deleteTarget && (
                <DeleteDialog
                    cat={deleteTarget}
                    childCount={categories.filter(c => c.parent_id === deleteTarget.id).length}
                    onCancel={() => setDeleteTarget(null)}
                    onConfirm={(mode) => doDelete(deleteTarget, mode)}
                />
            )}
        </div>
    )
}

function CategoryGroup({ title, groups, allCats, inputStyle, onReassign, onDelete }: {
    title: string
    groups: { cat: Category; children: Category[] }[]
    allCats: Category[]
    inputStyle: any
    onReassign: (id: string, parent: string) => void
    onDelete: (c: Category) => void
}) {
    if (groups.length === 0) return null
    return (
        <section style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)' }} className="py-[var(--s2)]">
            <div className="px-[22px] pb-[var(--s2)] pt-[var(--s3)]" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</div>
            <ul>
                {groups.map(({ cat, children }, gi) => (
                    <li key={cat.id} style={{ borderTop: gi === 0 ? 'none' : '1px solid var(--border)' }}>
                        <CategoryRow cat={cat} allCats={allCats} inputStyle={inputStyle} onReassign={onReassign} onDelete={onDelete} />
                        {children.map(ch => (
                            <div key={ch.id} className="pl-[var(--s6)]" style={{ borderTop: '1px solid var(--border)' }}>
                                <CategoryRow cat={ch} child allCats={allCats} inputStyle={inputStyle} onReassign={onReassign} onDelete={onDelete} />
                            </div>
                        ))}
                    </li>
                ))}
            </ul>
        </section>
    )
}

function CategoryRow({ cat, child, allCats, inputStyle, onReassign, onDelete }: {
    cat: Category
    child?: boolean
    allCats: Category[]
    inputStyle: any
    onReassign: (id: string, parent: string) => void
    onDelete: (c: Category) => void
}) {
    // Bir kategori yalnızca kendi türündeki başka üst-seviye kategorinin altına taşınabilir
    // (kendisi hariç, kendisi bir parent değilse — tek seviye kural).
    const isParent = allCats.some(c => c.parent_id === cat.id)
    const parentChoices = allCats.filter(c => c.type === cat.type && !c.parent_id && c.id !== cat.id)
    return (
        <div className="flex items-center gap-[var(--s3)] px-[22px] py-[12px]">
            {child && <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ink-4)' }} />}
            <CategoryTile name={cat.name} size={30} />
            <Link href={`/kategoriler?kategori=${cat.id}`} className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 14.5, color: 'var(--ink)' }}>{cat.name}</div>
                {cat.is_recurring && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>tekrarlayan</div>}
            </Link>
            {!isParent && (
                <select
                    value={cat.parent_id || ''}
                    onChange={e => onReassign(cat.id, e.target.value)}
                    className="h-8 max-w-[150px] px-[var(--s3)] outline-none"
                    style={{ ...inputStyle, fontSize: 12.5 }}
                    title="Üst kategori"
                >
                    <option value="">Üst seviye</option>
                    {parentChoices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            )}
            <button onClick={() => onDelete(cat)} className="icon-btn p-2" title="Sil"><Trash2 className="h-4 w-4" /></button>
        </div>
    )
}

function DeleteDialog({ cat, childCount, onCancel, onConfirm }: {
    cat: Category
    childCount: number
    onCancel: () => void
    onConfirm: (mode?: 'promote' | 'cascade') => void
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
            <div className="w-full max-w-sm rounded-[var(--r-card)] p-[var(--s5)]" style={{ background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
                <div className="mb-[var(--s2)]" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>“{cat.name}” silinsin mi?</div>
                {childCount > 0 ? (
                    <>
                        <p style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Bu kategorinin {childCount} alt kategorisi var. Ne yapılsın?</p>
                        <div className="mt-[var(--s4)] flex flex-col gap-[var(--s2)]">
                            <PrimaryButton onClick={() => onConfirm('promote')} className="w-full">Alt kategorileri üst seviyeye çıkar, sadece bunu sil</PrimaryButton>
                            <button onClick={() => onConfirm('cascade')} className="w-full rounded-[var(--r-button)] py-[var(--s3)]" style={{ background: 'transparent', color: 'var(--flow-out)', fontSize: 13.5, border: '1px solid var(--border)' }}>
                                Alt kategorilerle birlikte hepsini sil
                            </button>
                            <button onClick={onCancel} className="w-full py-[var(--s2)]" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Vazgeç</button>
                        </div>
                    </>
                ) : (
                    <>
                        <p style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Bu kategoriye bağlı işlemler kategorisiz kalır. Bu işlem geri alınamaz.</p>
                        <div className="mt-[var(--s4)] flex gap-[var(--s2)]">
                            <button onClick={onCancel} className="flex-1 rounded-[var(--r-button)] py-[var(--s3)]" style={{ background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13.5 }}>Vazgeç</button>
                            <button onClick={() => onConfirm()} className="flex-1 rounded-[var(--r-button)] py-[var(--s3)]" style={{ background: 'color-mix(in srgb, var(--flow-out) 15%, transparent)', color: 'var(--flow-out)', fontSize: 13.5, fontWeight: 600 }}>Sil</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className="relative h-5 w-10 shrink-0 rounded-full transition-colors"
            style={{ background: on ? 'var(--accent)' : 'var(--ink-4)' }}
            aria-pressed={on}
        >
            <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
        </button>
    )
}
