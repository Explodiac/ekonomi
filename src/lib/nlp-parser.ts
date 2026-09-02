export type ParsedTransaction = {
    amount: number | null;
    description: string | null;
    date: Date | null;
    type: 'income' | 'expense';
    accountHint: string | null;
}

export function parseQuickEntry(input: string): ParsedTransaction {
    const text = input.toLowerCase();
    const result: ParsedTransaction = {
        amount: null,
        description: null,
        date: new Date(),
        type: 'expense',
        accountHint: null
    };

    // 1. Account Detection (Heuristic)
    // Look for common account names or keywords
    const accountKeywords = ['kart', 'kredi kartı', 'hesap', 'nakit', 'peşin', 'ziraat', 'akbank', 'garanti', 'iş bankası', 'yapı kredi', 'papara', 'tosla', 'enpara', 'kuveyt türk', 'halkbank', 'vakıfbank', 'teb', 'ing', 'qnb', 'finansbank', 'world', 'maximum', 'bonus', 'axess', 'cardsplus'];
    for (const kw of accountKeywords) {
        if (text.includes(kw)) {
            result.accountHint = kw;
            break;
        }
    }
    // Pattern: "X ile", "X'ten", "X üzerinden"
    const accountPattern = /(\w+)['"]?(?:den|dan|ten|tan|ile|üzerinden|kartıyla|hesabıyla|nakit|peşin)/i;
    const match = text.match(accountPattern);
    if (match && !result.accountHint) {
        result.accountHint = match[1];
    }

    // 1. Amount Detection (Numbers followed by TL or just numbers)
    const amountMatch = text.match(/(\d+[,.]?\d*)\s*(tl|lira|₺)?/i);
    if (amountMatch) {
        result.amount = parseFloat(amountMatch[1].replace(',', '.'));
    }

    // 2. Type Detection
    if (text.includes('gelir') || text.includes('aldım') || text.includes('yattı') || text.includes('kazandım')) {
        result.type = 'income';
    }

    // 3. Date Detection
    if (text.includes('dün')) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        result.date = yesterday;
    } else if (text.includes('evvelsi gün')) {
        const dayBefore = new Date();
        dayBefore.setDate(dayBefore.getDate() - 2);
        result.date = dayBefore;
    }

    // 4. Description Extraction (Heuristic)
    // Remove amount and date words to find description
    let desc = text
        .replace(/(\d+[,.]?\d*)\s*(tl|lira|₺)?/gi, '')
        .replace(/dün|bugün|evvelsi gün/gi, '')
        .replace(/harcadım|aldım|yattı|kazandım|ödeme yaptım|gelir/gi, '');

    // Also remove account hint if detected
    if (result.accountHint) {
        desc = desc.replace(new RegExp(result.accountHint, 'gi'), '');
    }

    desc = desc
        .replace(/\w+['"]?(?:den|dan|ten|tan|ile|üzerinden|kartıyla|hesabıyla|nakit|peşin)/gi, '') // Remove account + suffix
        .replace(/\b(den|dan|ten|tan|ile|üzerinden|kartıyla|hesabıyla|kartımla|hesabımla|nakit|peşin)\b/gi, '') // Remove stray suffixes
        .trim();

    // Capitalize first letter
    if (desc) {
        result.description = desc.charAt(0).toUpperCase() + desc.slice(1);
    }

    return result;
}
