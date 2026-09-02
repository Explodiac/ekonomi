export const KEYWORD_MAP: Record<string, string[]> = {
    "Market": ["migros", "carrefour", "a101", "bim", "şok", "getir", "yemeksepeti", "market", "bakkal", "manav", "kasap", "fırın", "macrocenter", "şarküteri"],
    "Eğlence": ["netflix", "spotify", "youtube", "premium", "disney", "sinema", "tiyatro", "oyun", "steam", "epic", "playstation", "xbox", "eğlence"],
    "Ulaşım": ["shell", "opet", "petrol", "benzin", "akaryakıt", "taksi", "uber", "bitaksi", "martı", "binbin", "otopark", "ispartk", "metro", "otobüs", "thy", "pegasus", "havaş", "marmaray"],
    "Yemek": ["starbucks", "kahve", "espresso", "burger", "mcdonalds", "pizza", "kebap", "restoran", "lokanta", "kafe", "popeyes", "kfc", "dominos", "simit", "pastane"],
    "Alışveriş": ["trendyol", "hepsiburada", "amazon", "n11", "zara", "h&m", "lcw", "koton", "boyner", "watsons", "gratis", "ikea", "decathlon", "mobilya", "giyim"],
    "Sağlık": ["eczane", "hastane", "doktor", "klinik", "tahlil", "ilaç", "optik", "diş"],
    "Eğitim": ["okul", "kurs", "kitap", "kırtasiye", "kayıt", "eğitim", "udemy", "coursera"],
    "Aidat/Fatura": ["elektrik", "su", "doğalgaz", "internet", "türk telekom", "turkcell", "vodafone", "superonline", "site", "apartman"]
}

export function suggestCategory(description: string, categories: any[]): string | null {
    if (!description) return null;
    const descLower = description.toLowerCase();

    // 1. Check against predefined keywords
    for (const [catName, keywords] of Object.entries(KEYWORD_MAP)) {
        if (keywords.some(kw => descLower.includes(kw))) {
            const foundCat = categories.find(c => c.name?.toLowerCase().includes(catName.toLowerCase()) || catName.toLowerCase().includes(c.name?.toLowerCase()));
            if (foundCat) return foundCat.id;
        }
    }

    return null;
}
