/**
 * Advanced Spending Forecast Engine
 * Calculates next month's predicted expenses based on historical trends, 
 * recurring fixed costs (subscriptions & installments), and anomaly detection.
 */

export interface Transaction {
    amount: number;
    transaction_date: string;
    type: 'income' | 'expense' | 'transfer';
    description?: string;
}

export interface ForecastInput {
    historicalTransactions: Transaction[];
    upcomingSubscriptions: { amount: number }[];
    upcomingInstallments: { amount: number }[];
}

export interface ForecastResult {
    predictedAmount: number;
    confidence: number; // 0-100
    components: {
        fixedCosts: number;
        variableProjected: number;
        trendAdjustment: number;
    };
    insights: string[];
}

export function calculateSpendingForecast(input: ForecastInput): ForecastResult {
    const { historicalTransactions, upcomingSubscriptions, upcomingInstallments } = input;

    // 1. Calculate Baseline (Fixed Costs)
    const fixedCosts =
        upcomingSubscriptions.reduce((acc, sub) => acc + Number(sub.amount), 0) +
        upcomingInstallments.reduce((acc, inst) => acc + Number(inst.amount), 0);

    // 2. Process Historical Expenses
    const expenses = historicalTransactions.filter(t => t.type === 'expense');

    // Group expenses by month
    const monthlyTotals: Record<string, number> = {};
    expenses.forEach(tx => {
        const monthKey = tx.transaction_date.substring(0, 7); // "YYYY-MM"
        monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + Number(tx.amount);
    });

    const monthEntries = Object.entries(monthlyTotals)
        .sort((a, b) => b[0].localeCompare(a[0])) // Most recent first
        .slice(0, 6); // Take up to 6 months

    if (monthEntries.length === 0) {
        return {
            predictedAmount: fixedCosts,
            confidence: 30,
            components: { fixedCosts, variableProjected: 0, trendAdjustment: 0 },
            insights: ["Yeterli veri yok, sadece sabit giderler baz alındı."]
        };
    }

    // 3. Anomaly Detection & Cleaning
    // For each month, we subtract the fixed costs (if we knew them for past months, 
    // but here we just use average to find the variable part)
    const totalAmounts = monthEntries.map(e => e[1]);
    const avgTotal = totalAmounts.reduce((a, b) => a + b, 0) / totalAmounts.length;

    // Simple anomaly removal: exclude months > 2x average (one-offs)
    const cleanedAmounts = totalAmounts.filter(amt => amt < avgTotal * 2.5);
    const variableAmounts = cleanedAmounts.map(amt => Math.max(0, amt - fixedCosts));

    // 4. Weighted Average Calculation
    // Recent months have higher weights: [1.0, 0.8, 0.6, 0.4, 0.2, 0.1]
    const weights = [1.0, 0.8, 0.6, 0.4, 0.2, 0.1];
    let weightedSum = 0;
    let totalWeight = 0;

    variableAmounts.forEach((amt, i) => {
        const w = weights[i] || 0.1;
        weightedSum += amt * w;
        totalWeight += w;
    });

    const variableProjected = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // 5. Trend Analysis
    // Compare last 2 months variable spending
    let trendAdjustment = 0;
    const insights: string[] = [];

    if (variableAmounts.length >= 2) {
        const lastMonth = variableAmounts[0];
        const prevMonth = variableAmounts[1];
        const diffPercent = prevMonth > 0 ? (lastMonth - prevMonth) / prevMonth : 0;

        // If trend is significant (>10%), apply a small adjustment (max 5% of total)
        if (Math.abs(diffPercent) > 0.1) {
            trendAdjustment = variableProjected * (diffPercent * 0.2); // Dampen the trend to 20% impact
            insights.push(diffPercent > 0
                ? "Harcama alışkanlıkların yükseliş eğiliminde."
                : "Harika! Harcamalarını azaltma eğilimindesin.");
        }
    }

    const predictedAmount = fixedCosts + variableProjected + trendAdjustment;

    // Calculate Confidence
    let confidence = 50; // Base
    if (monthEntries.length >= 3) confidence += 20;
    if (monthEntries.length >= 6) confidence += 10;
    if (cleanedAmounts.length === totalAmounts.length) confidence += 20; // No anomalies detected

    return {
        predictedAmount: Math.round(predictedAmount),
        confidence: Math.min(confidence, 95),
        components: {
            fixedCosts: Math.round(fixedCosts),
            variableProjected: Math.round(variableProjected),
            trendAdjustment: Math.round(trendAdjustment)
        },
        insights
    };
}
