interface StockPrice {
    price: number;
    currency: string;
    date?: string;
}

interface FundNav {
    nav: string;
    date: string;
    type?: string; // 标记是实时估值还是历史净值
}

async function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...headers
        }
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.text();
}

async function getStockPrice(symbol: string, date?: string): Promise<StockPrice | null> {
    try {
        let url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
        
        if (date) {
            const targetDate = new Date(date);
            const nextDay = new Date(targetDate);
            nextDay.setDate(nextDay.getDate() + 1);
            
            const period1 = Math.floor(targetDate.getTime() / 1000);
            const period2 = Math.floor(nextDay.getTime() / 1000);
            
            url += `?period1=${period1}&period2=${period2}&interval=1d`;
        }
        
        const data = await httpsGet(url);
        const parsed = JSON.parse(data);
        
        if (date) {
            if (parsed.chart?.result?.[0]?.timestamp?.[0] && parsed.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.[0]) {
                return {
                    price: parsed.chart.result[0].indicators.quote[0].close[0],
                    currency: parsed.chart.result[0].meta.currency,
                    date: new Date(parsed.chart.result[0].timestamp[0] * 1000).toISOString().split('T')[0]
                };
            }
        } else if (parsed.chart?.result?.[0]?.meta?.regularMarketPrice) {
            return {
                price: parsed.chart.result[0].meta.regularMarketPrice,
                currency: parsed.chart.result[0].meta.currency
            };
        }
        throw new Error('Invalid data structure');
    } catch (e) {
        console.error(`Error fetching stock price for ${symbol}:`, e);
        return null;
    }
}

async function getFundNav(fundCode: string, date?: string): Promise<FundNav | null> {
    try {
        if (date) {
            // 使用历史净值 API
            const response = await fetch(
                `https://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=${fundCode}&sdate=${date}&edate=${date}&per=1`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Accept': '*/*',
                        'Referer': 'https://fund.eastmoney.com/'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const text = await response.text();
            
            // 直接处理原始HTML内容，不尝试解析JavaScript对象
            // 使用正则表达式从响应内容中提取表格数据
            const tableRegex = /<table[^>]*class=['"]w782 comm lsjz['"][^>]*>([\s\S]*?)<\/table>/i;
            const tableMatch = text.match(tableRegex);
            
            if (!tableMatch || !tableMatch[1]) {
                // 如果找不到表格，检查是否存在预定义的apidata对象（如示例中提供的）
                const dateRegex = /<td>(\d{4}-\d{2}-\d{2})<\/td>/;
                const navRegex = /<td class=['"]tor bold['"]>([0-9.]+)<\/td>/;
                
                const dateMatch = text.match(dateRegex);
                const navMatch = text.match(navRegex);
                
                if (dateMatch && dateMatch[1] && navMatch && navMatch[1]) {
                    return {
                        nav: navMatch[1],
                        date: dateMatch[1],
                        type: 'historical'
                    };
                }
                
                throw new Error('No fund data table found');
            }
            
            // 解析表格中的行
            const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
            const dataRows = [];
            let rowMatch;
            
            // 跳过表头行，只获取数据行
            let isFirstRow = true;
            while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
                if (isFirstRow) {
                    isFirstRow = false;
                    continue; // 跳过表头行
                }
                dataRows.push(rowMatch[1]);
            }
            
            if (dataRows.length === 0) {
                return null; // 没有数据行
            }
            
            // 解析第一个数据行
            const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
            const firstRowData = dataRows[0];
            const cells = [];
            let cellMatch;
            
            while ((cellMatch = cellRegex.exec(firstRowData)) !== null) {
                // 移除HTML标签获取纯文本内容
                const cellContent = cellMatch[1].replace(/<[^>]*>/g, '').trim();
                cells.push(cellContent);
            }
            
            if (cells.length < 2) {
                throw new Error('Invalid table structure');
            }
            
            return {
                nav: cells[1], // 单位净值在第二列
                date: cells[0], // 日期在第一列
                type: 'historical'
            };
        } else {
            // 获取实时估值
            const response = await fetch(
                `https://fundgz.1234567.com.cn/js/${fundCode}.js`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Accept': '*/*',
                        'Referer': 'https://fund.eastmoney.com/'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 获取 ArrayBuffer 以处理 GBK 编码
            const buffer = await response.arrayBuffer();
            // 使用 GBK 解码
            const decoder = new TextDecoder('gbk');
            const data = decoder.decode(buffer);
            
            // 从 JSONP 响应中提取 JSON 字符串
            const jsonStr = data.substring(8, data.length - 2);
            const fundInfo = JSON.parse(jsonStr);
            
            return {
                nav: fundInfo.gsz || fundInfo.dwjz,
                date: fundInfo.jzrq,
                type: 'realtime'
            };
        }
    } catch (e) {
        console.error(`Error fetching fund NAV for ${fundCode}:`, e);
        return null;
    }
}

async function getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number | null> {
    try {
        const url = `https://open.er-api.com/v6/latest/${fromCurrency}`;
        const data = await httpsGet(url);
        const parsed = JSON.parse(data);
        
        if (parsed.rates && parsed.rates[toCurrency]) {
            return parsed.rates[toCurrency];
        }
        
        throw new Error('Invalid currency pair');
    } catch (e) {
        console.error(`Error fetching exchange rate from ${fromCurrency} to ${toCurrency}:`, e);
        return null;
    }
}

interface CryptoPrice {
    price: number;
    currency: string;
}

const cryptoSymbolMap: Record<string, string> = {
    'btc': 'bitcoin',
    'eth': 'ethereum',
    'usdt': 'tether',
    'bnb': 'binancecoin',
    'xrp': 'ripple',
    'ada': 'cardano',
    'doge': 'dogecoin',
    'sol': 'solana'
};

async function getCryptoPrice(symbol: string): Promise<CryptoPrice | null> {
    try {
        const normalizedSymbol = cryptoSymbolMap[symbol.toLowerCase()] || symbol.toLowerCase();
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${normalizedSymbol}&vs_currencies=usd`;
        const data = await httpsGet(url);
        const parsed = JSON.parse(data);
        
        if (parsed[normalizedSymbol]?.usd) {
            return {
                price: parsed[normalizedSymbol].usd,
                currency: 'USD'
            };
        }
        
        throw new Error('Invalid cryptocurrency symbol');
    } catch (e) {
        console.error(`Error fetching crypto price for ${symbol}:`, e);
        return null;
    }
}

interface UnifiedPrice {
    price: number;
    currency: string;
    date?: string;
    type?: string;
    originalPrice?: number;
    originalCurrency?: string;
}

type PriceType = 'stock' | 'fund' | 'crypto';

async function getUnifiedPrice(
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

export { getStockPrice, getFundNav, getExchangeRate, getCryptoPrice, cryptoSymbolMap };