import { getStockPrice, getFundNav, getExchangeRate, getCryptoPrice, cryptoSymbolMap } from './stock';

export interface UnifiedPrice {
    price: number;
    currency: string;
    date?: string;
    type?: string;
    originalPrice?: number;
    originalCurrency?: string;
}

type PriceType = 'stock' | 'fund' | 'crypto';

export async function getUnifiedPrice(
    code: string,
    date?: string,
    targetCurrency?: string
): Promise<UnifiedPrice | null> {
    try {
        // 判断代码类型
        let priceType: PriceType = 'stock';
        if (/^\d{6}$/.test(code)) {
            priceType = 'fund';
        } else if (cryptoSymbolMap[code.toLowerCase()]) {
            priceType = 'crypto';
        }

        // 获取原始价格
        let result: UnifiedPrice | null = null;
        switch (priceType) {
            case 'stock':
                const stockPrice = await getStockPrice(code, date);
                if (stockPrice) {
                    result = {
                        price: stockPrice.price,
                        currency: stockPrice.currency,
                        date: stockPrice.date
                    };
                }
                break;
            case 'fund':
                const fundNav = await getFundNav(code, date);
                if (fundNav) {
                    result = {
                        price: parseFloat(fundNav.nav),
                        currency: 'CNY',
                        date: fundNav.date,
                        type: fundNav.type
                    };
                }
                break;
            case 'crypto':
                const cryptoPrice = await getCryptoPrice(code);
                if (cryptoPrice) {
                    result = {
                        price: cryptoPrice.price,
                        currency: cryptoPrice.currency,
                        date: new Date().toISOString().split('T')[0]
                    };
                }
                break;
        }

        if (!result) {
            return null;
        }

        // 如果需要汇率转换
        if (targetCurrency && result.currency !== targetCurrency) {
            const exchangeRate = await getExchangeRate(result.currency, targetCurrency);
            if (exchangeRate) {
                result.originalPrice = result.price;
                result.originalCurrency = result.currency;
                result.price = result.price * exchangeRate;
                result.currency = targetCurrency;
            }
        }

        return result;
    } catch (e) {
        console.error(`Error getting unified price for ${code}:`, e);
        return null;
    }
} 