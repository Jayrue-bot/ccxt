'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, ArgumentsRequired, ExchangeNotAvailable, InsufficientFunds, OrderNotFound, InvalidOrder, DDoSProtection, InvalidNonce, AuthenticationError } = require ('./base/errors');
const { ROUND } = require ('./base/functions/number');

//  ---------------------------------------------------------------------------

module.exports = class currencycom extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'currencycom',
            'name': 'Currency.com',
            'countries': [ 'BY' ], // Belarus
            'rateLimit': 500,
            'certified': false,
            'version': 'v1',
            // new metainfo interface
            'has': {
                'CORS': false,
                'cancelOrder': true,
                'createOrder': true,
                'fetchAccounts': true,
                'fetchMarkets': true,
                'fetchOrderBook': true,
                'fetchTicker': true,
                'fetchTickers': true,
                'fetchTradingFees': true,
                'fetchOHLCV': true,
                'fetchTrades': true,
                'fetchMyTrades': true,
                'fetchBalance': true,
                'fetchOpenOrders': true,
            },
            'timeframes': {
                '1m': '1m',
                '3m': '3m',
                '5m': '5m',
                '15m': '15m',
                '30m': '30m',
                '1h': '1h',
                '4h': '4h',
                '1d': '1d',
                '1w': '1w',
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/83718672-36745c00-a63e-11ea-81a9-677b1f789a4d.jpg',
                'api': {
                    'public': 'https://api-adapter.backend.currency.com/api',
                    'private': 'https://api-adapter.backend.currency.com/api',
                },
                'www': 'https://www.currency.com',
                'referral': 'https://currency.com/trading/signup?c=362jaimv&pid=referral',
                'doc': [
                    'https://currency.com/api',
                ],
                'fees': 'https://currency.com/fees-charges',
            },
            'api': {
                'public': {
                    'get': [
                        'time',
                        'exchangeInfo',
                        'depth',
                        'aggTrades',
                        'klines',
                        'ticker/24hr',
                    ],
                },
                'private': {
                    'get': [
                        'leverageSettings',
                        'openOrders',
                        'tradingPositions',
                        'account',
                        'myTrades',
                    ],
                    'post': [
                        'order',
                        'updateTradingPosition',
                        'updateTradingOrder',
                        'closeTradingPosition',
                    ],
                    'delete': [
                        'order',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'taker': 0.002,
                    'maker': 0.002,
                },
            },
            // exchange-specific options
            'options': {
                'defaultTimeInForce': 'GTC', // 'GTC' = Good To Cancel (default), 'IOC' = Immediate Or Cancel, 'FOK' = Fill Or Kill
                'warnOnFetchOpenOrdersWithoutSymbol': true,
                'recvWindow': 5 * 1000, // 5 sec, default
                'timeDifference': 0, // the difference between system clock and Binance clock
                'adjustForTimeDifference': false, // controls the adjustment logic upon instantiation
                'parseOrderToPrecision': false, // force amounts and costs in parseOrder to precision
                'newOrderRespType': {
                    'market': 'FULL', // 'ACK' for order id, 'RESULT' for full order or 'FULL' for order with fills
                    'limit': 'RESULT', // we change it from 'ACK' by default to 'RESULT'
                },
            },
            'exceptions': {
                'FIELD_VALIDATION_ERROR Cancel is available only for LIMIT order': InvalidOrder,
                'API key does not exist': AuthenticationError,
                'Order would trigger immediately.': InvalidOrder,
                'Account has insufficient balance for requested action.': InsufficientFunds,
                'Rest API trading is not enabled.': ExchangeNotAvailable,
                '-1000': ExchangeNotAvailable, // {"code":-1000,"msg":"An unknown error occured while processing the request."}
                '-1013': InvalidOrder, // createOrder -> 'invalid quantity'/'invalid price'/MIN_NOTIONAL
                '-1021': InvalidNonce, // 'your time is ahead of server'
                '-1022': AuthenticationError, // {"code":-1022,"msg":"Signature for this request is not valid."}
                '-1100': InvalidOrder, // createOrder(symbol, 1, asdf) -> 'Illegal characters found in parameter 'price'
                '-1104': ExchangeError, // Not all sent parameters were read, read 8 parameters but was sent 9
                '-1128': ExchangeError, // {"code":-1128,"msg":"Combination of optional parameters invalid."}
                '-2010': ExchangeError, // generic error code for createOrder -> 'Account has insufficient balance for requested action.', {"code":-2010,"msg":"Rest API trading is not enabled."}, etc...
                '-2011': OrderNotFound, // cancelOrder(1, 'BTC/USDT') -> 'UNKNOWN_ORDER'
                '-2013': OrderNotFound, // fetchOrder (1, 'BTC/USDT') -> 'Order does not exist'
                '-2014': AuthenticationError, // { "code":-2014, "msg": "API-key format invalid." }
                '-2015': AuthenticationError, // "Invalid API-key, IP, or permissions for action."
            },
        });
    }

    nonce () {
        return this.milliseconds () - this.options['timeDifference'];
    }

    async fetchTime (params = {}) {
        const response = await this.publicGetTime (params);
        //
        //     {
        //         "serverTime": 1590998366609
        //     }
        //
        return this.safeInteger (response, 'serverTime');
    }

    async loadTimeDifference (params = {}) {
        const response = await this.publicGetTime (params);
        const after = this.milliseconds ();
        this.options['timeDifference'] = parseInt (after - response['serverTime']);
        return this.options['timeDifference'];
    }

    async fetchMarkets (params = {}) {
        const response = await this.publicGetExchangeInfo (params);
        //
        // spot
        //
        //     {
        //         "timezone":"UTC",
        //         "serverTime":1590998061253,
        //         "rateLimits":[
        //             {"rateLimitType":"REQUEST_WEIGHT","interval":"MINUTE","intervalNum":1,"limit":1200},
        //             {"rateLimitType":"ORDERS","interval":"SECOND","intervalNum":1,"limit":10},
        //             {"rateLimitType":"ORDERS","interval":"DAY","intervalNum":1,"limit":864000}
        //         ],
        //         "exchangeFilters":[],
        //         "symbols":[
        //             {
        //                 "symbol":"EVK",
        //                 "name":"Evonik",
        //                 "status":"HALT",
        //                 "baseAsset":"EVK",
        //                 "baseAssetPrecision":3,
        //                 "quoteAsset":"EUR",
        //                 "quoteAssetId":"EUR",
        //                 "quotePrecision":3,
        //                 "orderTypes":["LIMIT","MARKET"],
        //                 "filters":[
        //                     {"filterType":"LOT_SIZE","minQty":"1","maxQty":"27000","stepSize":"1"},
        //                     {"filterType":"MIN_NOTIONAL","minNotional":"23"}
        //                 ],
        //                 "marketType":"SPOT"
        //             },
        //             {
        //                 "symbol":"BTC/USD_LEVERAGE",
        //                 "name":"Bitcoin / USD",
        //                 "status":"TRADING",
        //                 "baseAsset":"BTC",
        //                 "baseAssetPrecision":3,
        //                 "quoteAsset":"USD",
        //                 "quoteAssetId":"USD_LEVERAGE",
        //                 "quotePrecision":3,
        //                 "orderTypes":["LIMIT","MARKET","STOP"],
        //                 "filters":[
        //                     {"filterType":"LOT_SIZE","minQty":"0.001","maxQty":"100","stepSize":"0.001"},
        //                     {"filterType":"MIN_NOTIONAL","minNotional":"11"}
        //                 ],
        //                 "marketType":"LEVERAGE"
        //             }
        //         ]
        //     }
        //
        if (this.options['adjustForTimeDifference']) {
            await this.loadTimeDifference ();
        }
        const markets = this.safeValue (response, 'symbols');
        const result = [];
        for (let i = 0; i < markets.length; i++) {
            const market = markets[i];
            const id = this.safeString (market, 'symbol');
            const baseId = this.safeString (market, 'baseAsset');
            const quoteId = this.safeString (market, 'quoteAsset');
            const base = this.safeCurrencyCode (baseId);
            const quote = this.safeCurrencyCode (quoteId);
            let symbol = base + '/' + quote;
            if (id.indexOf ('/') >= 0) {
                symbol = id;
            }
            const filters = this.safeValue (market, 'filters', []);
            const filtersByType = this.indexBy (filters, 'filterType');
            const precision = {
                'amount': this.safeInteger (market, 'baseAssetPrecision'),
                'price': this.safeInteger (market, 'quotePrecision'),
            };
            const status = this.safeString (market, 'status');
            const active = (status === 'TRADING');
            let type = this.safeStringLower (market, 'marketType');
            if (type === 'leverage') {
                type = 'margin';
            }
            const spot = (type === 'spot');
            const margin = (type === 'margin');
            const entry = {
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'type': type,
                'spot': spot,
                'margin': margin,
                'info': market,
                'active': active,
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': Math.pow (10, -precision['amount']),
                        'max': undefined,
                    },
                    'price': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'cost': {
                        'min': -1 * Math.log10 (precision['amount']),
                        'max': undefined,
                    },
                },
            };
            if ('PRICE_FILTER' in filtersByType) {
                const filter = this.safeValue (filtersByType, 'PRICE_FILTER', {});
                // PRICE_FILTER reports zero values for maxPrice
                // since they updated filter types in November 2018
                // https://github.com/ccxt/ccxt/issues/4286
                // therefore limits['price']['max'] doesn't have any meaningful value except undefined
                entry['limits']['price'] = {
                    'min': this.safeFloat (filter, 'minPrice'),
                    'max': undefined,
                };
                const maxPrice = this.safeFloat (filter, 'maxPrice');
                if ((maxPrice !== undefined) && (maxPrice > 0)) {
                    entry['limits']['price']['max'] = maxPrice;
                }
                entry['precision']['price'] = this.precisionFromString (filter['tickSize']);
            }
            if ('LOT_SIZE' in filtersByType) {
                const filter = this.safeValue (filtersByType, 'LOT_SIZE', {});
                const stepSize = this.safeString (filter, 'stepSize');
                entry['precision']['amount'] = this.precisionFromString (stepSize);
                entry['limits']['amount'] = {
                    'min': this.safeFloat (filter, 'minQty'),
                    'max': this.safeFloat (filter, 'maxQty'),
                };
            }
            if ('MARKET_LOT_SIZE' in filtersByType) {
                const filter = this.safeValue (filtersByType, 'MARKET_LOT_SIZE', {});
                entry['limits']['market'] = {
                    'min': this.safeFloat (filter, 'minQty'),
                    'max': this.safeFloat (filter, 'maxQty'),
                };
            }
            if ('MIN_NOTIONAL' in filtersByType) {
                const filter = this.safeValue (filtersByType, 'MIN_NOTIONAL', {});
                entry['limits']['cost']['min'] = this.safeFloat (filter, 'minNotional');
            }
            result.push (entry);
        }
        return result;
    }

    calculateFee (symbol, type, side, amount, price, takerOrMaker = 'taker', params = {}) {
        const market = this.markets[symbol];
        let key = 'quote';
        const rate = market[takerOrMaker];
        let cost = amount * rate;
        let precision = market['precision']['price'];
        if (side === 'sell') {
            cost *= price;
        } else {
            key = 'base';
            precision = market['precision']['amount'];
        }
        cost = this.decimalToPrecision (cost, ROUND, precision, this.precisionMode);
        return {
            'type': takerOrMaker,
            'currency': market[key],
            'rate': rate,
            'cost': parseFloat (cost),
        };
    }

    async fetchAccounts (params = {}) {
        const response = await this.privateGetAccount (params);
        //
        //     {
        //         "makerCommission":0.20,
        //         "takerCommission":0.20,
        //         "buyerCommission":0.20,
        //         "sellerCommission":0.20,
        //         "canTrade":true,
        //         "canWithdraw":true,
        //         "canDeposit":true,
        //         "updateTime":1591056268,
        //         "balances":[
        //             {
        //                 "accountId":5470306579272968,
        //                 "collateralCurrency":true,
        //                 "asset":"ETH",
        //                 "free":0.0,
        //                 "locked":0.0,
        //                 "default":false,
        //             },
        //         ]
        //     }
        //
        const accounts = this.safeValue (response, 'balances', []);
        const result = [];
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            const accountId = this.safeInteger (account, 'accountId');
            const currencyId = this.safeString (account, 'asset');
            const currencyCode = this.safeCurrencyCode (currencyId);
            result.push ({
                'id': accountId,
                'type': undefined,
                'currency': currencyCode,
                'info': response,
            });
        }
        return result;
    }

    async fetchTradingFees (params = {}) {
        await this.loadMarkets ();
        const response = await this.privateGetAccount (params);
        return {
            'info': response,
            'maker': this.safeFloat (response, 'makerCommission'),
            'taker': this.safeFloat (response, 'takerCommission'),
        };
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        const response = await this.privateGetAccount (params);
        //
        //     {
        //         "makerCommission":0.20,
        //         "takerCommission":0.20,
        //         "buyerCommission":0.20,
        //         "sellerCommission":0.20,
        //         "canTrade":true,
        //         "canWithdraw":true,
        //         "canDeposit":true,
        //         "updateTime":1591056268,
        //         "balances":[
        //             {
        //                 "accountId":5470306579272968,
        //                 "collateralCurrency":true,
        //                 "asset":"ETH",
        //                 "free":0.0,
        //                 "locked":0.0,
        //                 "default":false,
        //             },
        //         ]
        //     }
        //
        const result = { 'info': response };
        const balances = this.safeValue (response, 'balances', []);
        for (let i = 0; i < balances.length; i++) {
            const balance = balances[i];
            const currencyId = this.safeString (balance, 'asset');
            const code = this.safeCurrencyCode (currencyId);
            const account = this.account ();
            account['free'] = this.safeFloat (balance, 'free');
            account['used'] = this.safeFloat (balance, 'locked');
            result[code] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
        };
        if (limit !== undefined) {
            request['limit'] = limit; // default 100, max 1000, valid limits 5, 10, 20, 50, 100, 500, 1000, 5000
        }
        const response = await this.publicGetDepth (this.extend (request, params));
        //
        //     {
        //         "lastUpdateId":1590999849037,
        //         "asks":[
        //             [0.02495,60.0000],
        //             [0.02496,120.0000],
        //             [0.02497,240.0000],
        //         ],
        //         "bids":[
        //             [0.02487,60.0000],
        //             [0.02486,120.0000],
        //             [0.02485,240.0000],
        //         ]
        //     }
        //
        const orderbook = this.parseOrderBook (response);
        orderbook['nonce'] = this.safeInteger (response, 'lastUpdateId');
        return orderbook;
    }

    parseTicker (ticker, market = undefined) {
        //
        // fetchTicker
        //
        //     {
        //         "symbol":"ETH/BTC",
        //         "priceChange":"0.00030",
        //         "priceChangePercent":"1.21",
        //         "weightedAvgPrice":"0.02481",
        //         "prevClosePrice":"0.02447",
        //         "lastPrice":"0.02477",
        //         "lastQty":"60.0",
        //         "bidPrice":"0.02477",
        //         "askPrice":"0.02484",
        //         "openPrice":"0.02447",
        //         "highPrice":"0.02524",
        //         "lowPrice":"0.02438",
        //         "volume":"11.97",
        //         "quoteVolume":"0.298053",
        //         "openTime":1590969600000,
        //         "closeTime":1591000072693
        //     }
        //
        // fetchTickers
        //
        //     {
        //         "symbol":"EVK",
        //         "highPrice":"22.57",
        //         "lowPrice":"22.16",
        //         "volume":"1",
        //         "quoteVolume":"22.2",
        //         "openTime":1590699364000,
        //         "closeTime":1590785764000
        //     }
        //
        const timestamp = this.safeInteger (ticker, 'closeTime');
        const marketId = this.safeString (ticker, 'symbol');
        let symbol = marketId;
        if (marketId !== undefined) {
            if (marketId in this.markets_by_id) {
                market = this.markets_by_id[marketId];
            } else if (marketId.indexOf ('/') >= 0) {
                const [ baseId, quoteId ] = marketId.split ('/');
                const base = this.safeCurrencyCode (baseId);
                const quote = this.safeCurrencyCode (quoteId);
                symbol = base + '/' + quote;
            }
        }
        if ((symbol === undefined) && (market !== undefined)) {
            symbol = market['symbol'];
        }
        const last = this.safeFloat (ticker, 'lastPrice');
        const open = this.safeFloat (ticker, 'openPrice');
        let average = undefined;
        if ((open !== undefined) && (last !== undefined)) {
            average = this.sum (open, last) / 2;
        }
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'highPrice'),
            'low': this.safeFloat (ticker, 'lowPrice'),
            'bid': this.safeFloat (ticker, 'bidPrice'),
            'bidVolume': this.safeFloat (ticker, 'bidQty'),
            'ask': this.safeFloat (ticker, 'askPrice'),
            'askVolume': this.safeFloat (ticker, 'askQty'),
            'vwap': this.safeFloat (ticker, 'weightedAvgPrice'),
            'open': open,
            'close': last,
            'last': last,
            'previousClose': this.safeFloat (ticker, 'prevClosePrice'), // previous day close
            'change': this.safeFloat (ticker, 'priceChange'),
            'percentage': this.safeFloat (ticker, 'priceChangePercent'),
            'average': average,
            'baseVolume': this.safeFloat (ticker, 'volume'),
            'quoteVolume': this.safeFloat (ticker, 'quoteVolume'),
            'info': ticker,
        };
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
        };
        const response = await this.publicGetTicker24hr (this.extend (request, params));
        //
        //     {
        //         "symbol":"ETH/BTC",
        //         "priceChange":"0.00030",
        //         "priceChangePercent":"1.21",
        //         "weightedAvgPrice":"0.02481",
        //         "prevClosePrice":"0.02447",
        //         "lastPrice":"0.02477",
        //         "lastQty":"60.0",
        //         "bidPrice":"0.02477",
        //         "askPrice":"0.02484",
        //         "openPrice":"0.02447",
        //         "highPrice":"0.02524",
        //         "lowPrice":"0.02438",
        //         "volume":"11.97",
        //         "quoteVolume":"0.298053",
        //         "openTime":1590969600000,
        //         "closeTime":1591000072693
        //     }
        //
        return this.parseTicker (response, market);
    }

    parseTickers (rawTickers, symbols = undefined) {
        const tickers = [];
        for (let i = 0; i < rawTickers.length; i++) {
            tickers.push (this.parseTicker (rawTickers[i]));
        }
        return this.filterByArray (tickers, 'symbol', symbols);
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        const response = await this.publicGetTicker24hr (params);
        //
        //     [
        //         {
        //             "symbol":"EVK",
        //             "highPrice":"22.57",
        //             "lowPrice":"22.16",
        //             "volume":"1",
        //             "quoteVolume":"22.2",
        //             "openTime":1590699364000,
        //             "closeTime":1590785764000
        //         }
        //     ]
        //
        return this.parseTickers (response, symbols);
    }

    parseOHLCV (ohlcv, market = undefined, timeframe = '1m', since = undefined, limit = undefined) {
        //
        //     [
        //         1590971040000,
        //         "0.02454",
        //         "0.02456",
        //         "0.02452",
        //         "0.02456",
        //         249
        //     ]
        //
        return [
            this.safeInteger (ohlcv, 0),
            this.safeFloat (ohlcv, 1),
            this.safeFloat (ohlcv, 2),
            this.safeFloat (ohlcv, 3),
            this.safeFloat (ohlcv, 4),
            this.safeFloat (ohlcv, 5),
        ];
    }

    async fetchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
            'interval': this.timeframes[timeframe],
        };
        if (since !== undefined) {
            request['startTime'] = since;
        }
        if (limit !== undefined) {
            request['limit'] = limit; // default 500, max 1000
        }
        const response = await this.publicGetKlines (this.extend (request, params));
        //
        //     [
        //         [1590971040000,"0.02454","0.02456","0.02452","0.02456",249],
        //         [1590971100000,"0.02455","0.02457","0.02452","0.02456",300],
        //         [1590971160000,"0.02455","0.02456","0.02453","0.02454",286],
        //     ]
        //
        return this.parseOHLCVs (response, market);
    }

    parseTrade (trade, market = undefined) {
        //
        // fetchTrades (public aggregate trades)
        //
        //     {
        //         "a":1658318071,
        //         "p":"0.02476",
        //         "q":"0.0",
        //         "T":1591001423382,
        //         "m":false
        //     }
        //
        // createOrder fills (private)
        //
        //     {
        //         "price": "9807.05",
        //         "qty": "0.01",
        //         "commission": "0",
        //         "commissionAsset": "dUSD"
        //     }
        //
        // fetchMyTrades
        //
        //     {
        //         "symbol": "BNBBTC",
        //         "id": 28457,
        //         "orderId": 100234,
        //         "price": "4.00000100",
        //         "qty": "12.00000000",
        //         "commission": "10.10000000",
        //         "commissionAsset": "BNB",
        //         "time": 1499865549590,
        //         "isBuyer": true,
        //         "isMaker": false,
        //         "isBestMatch": true
        //     }
        //
        const timestamp = this.safeInteger2 (trade, 'T', 'time');
        const price = this.safeFloat2 (trade, 'p', 'price');
        const amount = this.safeFloat2 (trade, 'q', 'qty');
        const id = this.safeString2 (trade, 'a', 'id');
        let side = undefined;
        const orderId = this.safeString (trade, 'orderId');
        if ('m' in trade) {
            side = trade['m'] ? 'sell' : 'buy'; // this is reversed intentionally
        } else if ('isBuyerMaker' in trade) {
            side = trade['isBuyerMaker'] ? 'sell' : 'buy';
        } else {
            if ('isBuyer' in trade) {
                side = (trade['isBuyer']) ? 'buy' : 'sell'; // this is a true side
            }
        }
        let fee = undefined;
        if ('commission' in trade) {
            fee = {
                'cost': this.safeFloat (trade, 'commission'),
                'currency': this.safeCurrencyCode (this.safeString (trade, 'commissionAsset')),
            };
        }
        let takerOrMaker = undefined;
        if ('isMaker' in trade) {
            takerOrMaker = trade['isMaker'] ? 'maker' : 'taker';
        }
        let symbol = undefined;
        if (market === undefined) {
            const marketId = this.safeString (trade, 'symbol');
            market = this.safeValue (this.markets_by_id, marketId);
        }
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        return {
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'id': id,
            'order': orderId,
            'type': undefined,
            'takerOrMaker': takerOrMaker,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': price * amount,
            'fee': fee,
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
            // 'limit': 500, // default 500, max 1000
        };
        if (limit !== undefined) {
            request['limit'] = limit; // default 500, max 1000
        }
        const response = await this.publicGetAggTrades (this.extend (request, params));
        //
        //     [
        //         {
        //             "a":1658318071,
        //             "p":"0.02476",
        //             "q":"0.0",
        //             "T":1591001423382,
        //             "m":false
        //         }
        //     ]
        //
        return this.parseTrades (response, market, since, limit);
    }

    parseOrderStatus (status) {
        const statuses = {
            'NEW': 'open',
            'PARTIALLY_FILLED': 'open',
            'FILLED': 'closed',
            'CANCELED': 'canceled',
            'PENDING_CANCEL': 'canceling', // currently unused
            'REJECTED': 'rejected',
            'EXPIRED': 'expired',
        };
        return this.safeString (statuses, status, status);
    }

    parseOrder (order, market = undefined) {
        //
        //     {
        //         "symbol": "BTC/USD",
        //         "orderId": "00000000-0000-0000-0000-0000000c0263",
        //         "clientOrderId": "00000000-0000-0000-0000-0000000c0263",
        //         "transactTime": 1589878206426,
        //         "price": "9825.66210000",
        //         "origQty": "0.01",
        //         "executedQty": "0.01",
        //         "status": "FILLED",
        //         "timeInForce": "FOK",
        //         "type": "MARKET",
        //         "side": "BUY",
        //         "fills": [
        //             {
        //                 "price": "9807.05",
        //                 "qty": "0.01",
        //                 "commission": "0",
        //                 "commissionAsset": "dUSD"
        //             }
        //         ]
        //     }
        //
        const status = this.parseOrderStatus (this.safeString (order, 'status'));
        let symbol = undefined;
        const marketId = this.safeString (order, 'symbol');
        if (marketId in this.markets_by_id) {
            market = this.markets_by_id[marketId];
        }
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        let timestamp = undefined;
        if ('time' in order) {
            timestamp = this.safeInteger (order, 'time');
        } else if ('transactTime' in order) {
            timestamp = this.safeInteger (order, 'transactTime');
        }
        let price = this.safeFloat (order, 'price');
        const amount = this.safeFloat (order, 'origQty');
        const filled = this.safeFloat (order, 'executedQty');
        let remaining = undefined;
        let cost = this.safeFloat (order, 'cummulativeQuoteQty');
        if (filled !== undefined) {
            if (amount !== undefined) {
                remaining = amount - filled;
                if (this.options['parseOrderToPrecision']) {
                    remaining = parseFloat (this.amountToPrecision (symbol, remaining));
                }
                remaining = Math.max (remaining, 0.0);
            }
            if (price !== undefined) {
                if (cost === undefined) {
                    cost = price * filled;
                }
            }
        }
        const id = this.safeString (order, 'orderId');
        const type = this.safeStringLower (order, 'type');
        if (type === 'market') {
            if (price === 0.0) {
                if ((cost !== undefined) && (filled !== undefined)) {
                    if ((cost > 0) && (filled > 0)) {
                        price = cost / filled;
                    }
                }
            }
        }
        const side = this.safeStringLower (order, 'side');
        let fee = undefined;
        let trades = undefined;
        const fills = this.safeValue (order, 'fills');
        if (fills !== undefined) {
            trades = this.parseTrades (fills, market);
            const numTrades = trades.length;
            if (numTrades > 0) {
                cost = trades[0]['cost'];
                fee = {
                    'cost': trades[0]['fee']['cost'],
                    'currency': trades[0]['fee']['currency'],
                };
                for (let i = 1; i < trades.length; i++) {
                    cost = this.sum (cost, trades[i]['cost']);
                    fee['cost'] = this.sum (fee['cost'], trades[i]['fee']['cost']);
                }
            }
        }
        let average = undefined;
        if (cost !== undefined) {
            if (filled) {
                average = cost / filled;
            }
            if (this.options['parseOrderToPrecision']) {
                cost = parseFloat (this.costToPrecision (symbol, cost));
            }
        }
        return {
            'info': order,
            'id': id,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': undefined,
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': cost,
            'average': average,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': fee,
            'trades': trades,
        };
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        let accountId = undefined;
        if (market['margin']) {
            accountId = this.safeInteger (params, 'accountId');
            if (accountId === undefined) {
                throw new ArgumentsRequired (this.id + ' createOrder requires an accountId parameter for ' + market['type'] + ' market ' + symbol);
            }
        }
        const uppercaseType = type.toUpperCase ();
        const newOrderRespType = this.safeValue (this.options['newOrderRespType'], type, 'RESULT');
        const request = {
            'symbol': market['id'],
            'quantity': this.amountToPrecision (symbol, amount),
            'type': uppercaseType,
            'side': side.toUpperCase (),
            'newOrderRespType': newOrderRespType, // 'RESULT' for full order or 'FULL' for order with fills
            // 'leverage': 1,
            // 'accountId': 5470306579272968, // required for leverage markets
            // 'takeProfit': '123.45',
            // 'stopLoss': '54.321'
            // 'guaranteedStopLoss': '54.321',
        };
        if (uppercaseType === 'LIMIT') {
            if (price === undefined) {
                throw new InvalidOrder (this.id + ' createOrder method requires a price argument for a ' + type + ' order');
            }
            request['price'] = this.priceToPrecision (symbol, price);
            request['timeInForce'] = this.options['defaultTimeInForce']; // 'GTC' = Good To Cancel (default), 'IOC' = Immediate Or Cancel, 'FOK' = Fill Or Kill
        }
        const response = await this.privatePostOrder (this.extend (request, params));
        //
        //     {
        //         "symbol": "BTC/USD",
        //         "orderId": "00000000-0000-0000-0000-0000000c0263",
        //         "clientOrderId": "00000000-0000-0000-0000-0000000c0263",
        //         "transactTime": 1589878206426,
        //         "price": "9825.66210000",
        //         "origQty": "0.01",
        //         "executedQty": "0.01",
        //         "status": "FILLED",
        //         "timeInForce": "FOK",
        //         "type": "MARKET",
        //         "side": "BUY",
        //         "fills": [
        //             {
        //                 "price": "9807.05",
        //                 "qty": "0.01",
        //                 "commission": "0",
        //                 "commissionAsset": "dUSD"
        //             }
        //         ]
        //     }
        //
        return this.parseOrder (response, market);
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = undefined;
        const request = {};
        if (symbol !== undefined) {
            market = this.market (symbol);
            request['symbol'] = market['id'];
        } else if (this.options['warnOnFetchOpenOrdersWithoutSymbol']) {
            const symbols = this.symbols;
            const numSymbols = symbols.length;
            const fetchOpenOrdersRateLimit = parseInt (numSymbols / 2);
            throw new ExchangeError (this.id + ' fetchOpenOrders WARNING: fetching open orders without specifying a symbol is rate-limited to one call per ' + fetchOpenOrdersRateLimit.toString () + ' seconds. Do not call this method frequently to avoid ban. Set ' + this.id + '.options["warnOnFetchOpenOrdersWithoutSymbol"] = false to suppress this warning message.');
        }
        const response = await this.privateGetOpenOrders (this.extend (request, params));
        return this.parseOrders (response, market, since, limit);
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' cancelOrder requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const origClientOrderId = this.safeValue (params, 'origClientOrderId');
        const request = {
            'symbol': market['id'],
            // 'orderId': parseInt (id),
            // 'origClientOrderId': id,
        };
        if (origClientOrderId === undefined) {
            request['orderId'] = id;
        } else {
            request['origClientOrderId'] = origClientOrderId;
        }
        const response = await this.privateDeleteOrder (this.extend (request, params));
        //
        //     {
        //         "symbol":"ETH/USD",
        //         "orderId":"00000000-0000-0000-0000-00000024383b",
        //         "clientOrderId":"00000000-0000-0000-0000-00000024383b",
        //         "price":"150",
        //         "origQty":"0.1",
        //         "executedQty":"0.0",
        //         "status":"CANCELED",
        //         "timeInForce":"GTC",
        //         "type":"LIMIT",
        //         "side":"BUY"
        //     }
        //
        return this.parseOrder (response, market);
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchMyTrades requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
        };
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const response = await this.privateGetMyTrades (this.extend (request, params));
        //
        //     [
        //         {
        //             "symbol": "BNBBTC",
        //             "id": 28457,
        //             "orderId": 100234,
        //             "price": "4.00000100",
        //             "qty": "12.00000000",
        //             "commission": "10.10000000",
        //             "commissionAsset": "BNB",
        //             "time": 1499865549590,
        //             "isBuyer": true,
        //             "isMaker": false,
        //             "isBestMatch": true
        //         }
        //     ]
        //
        return this.parseTrades (response, market, since, limit);
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'][api] + '/' + this.version + '/' + path;
        if (path === 'historicalTrades') {
            headers = {
                'X-MBX-APIKEY': this.apiKey,
            };
        }
        if (api === 'private') {
            this.checkRequiredCredentials ();
            let query = this.urlencode (this.extend ({
                'timestamp': this.nonce (),
                'recvWindow': this.options['recvWindow'],
            }, params));
            const signature = this.hmac (this.encode (query), this.encode (this.secret));
            query += '&' + 'signature=' + signature;
            headers = {
                'X-MBX-APIKEY': this.apiKey,
            };
            if ((method === 'GET') || (method === 'DELETE')) {
                url += '?' + query;
            } else {
                body = query;
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }
        } else {
            if (Object.keys (params).length) {
                url += '?' + this.urlencode (params);
            }
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (code, reason, url, method, headers, body, response, requestHeaders, requestBody) {
        if ((code === 418) || (code === 429)) {
            throw new DDoSProtection (this.id + ' ' + code.toString () + ' ' + reason + ' ' + body);
        }
        // error response in a form: { "code": -1013, "msg": "Invalid quantity." }
        // following block cointains legacy checks against message patterns in "msg" property
        // will switch "code" checks eventually, when we know all of them
        if (code >= 400) {
            if (body.indexOf ('Price * QTY is zero or less') >= 0) {
                throw new InvalidOrder (this.id + ' order cost = amount * price is zero or less ' + body);
            }
            if (body.indexOf ('LOT_SIZE') >= 0) {
                throw new InvalidOrder (this.id + ' order amount should be evenly divisible by lot size ' + body);
            }
            if (body.indexOf ('PRICE_FILTER') >= 0) {
                throw new InvalidOrder (this.id + ' order price is invalid, i.e. exceeds allowed price precision, exceeds min price or max price limits or is invalid float value in general, use this.priceToPrecision (symbol, amount) ' + body);
            }
        }
        if (response === undefined) {
            return; // fallback to default error handler
        }
        // check success value for wapi endpoints
        // response in format {'msg': 'The coin does not exist.', 'success': true/false}
        const success = this.safeValue (response, 'success', true);
        if (!success) {
            const message = this.safeString (response, 'msg');
            let parsedMessage = undefined;
            if (message !== undefined) {
                try {
                    parsedMessage = JSON.parse (message);
                } catch (e) {
                    // do nothing
                    parsedMessage = undefined;
                }
                if (parsedMessage !== undefined) {
                    response = parsedMessage;
                }
            }
        }
        const exceptions = this.exceptions;
        const message = this.safeString (response, 'msg');
        if (message in exceptions) {
            const ExceptionClass = exceptions[message];
            throw new ExceptionClass (this.id + ' ' + message);
        }
        if (!success) {
            throw new ExchangeError (this.id + ' ' + body);
        }
    }
};
