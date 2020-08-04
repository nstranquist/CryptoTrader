'use strict'

require('dotenv').config()
/*=============================================== USER CONFIGURATION ===============================================*/

const { binanceApiKey, binanceApiKeySecret, emailUsername, emailPassword } = process.env

const userConfig = {
  'binance': {
    'apiKey': binanceApiKey,
    'apiSecret': binanceApiKeySecret,
    // binance pw: 
  },
  'mail': {
    'username': emailUsername,
    'password': emailPassword,
    'host': 'imap.gmail.com',
    'port': 993,
    'mailbox': 'INBOX',
  }
}

/*=============================================== ADMIN CONFIGURATION ==============================================*/
/*============================================ DON'T EDIT BELOW THIS LINE===========================================*/

const adminConfig = {
  'mail': {
    'maxMailAge': 60
  },
  'retry': {
    'retries': 30,
    'minTimeout': 1000,
    'maxTimeout': 6000,
  },
  'tradingview': {
    'mail': 'noreply@tradingview.com'
  }
}
const _ = require('lodash'),
  log = require('fancy-log'),
  logSymbols = require('log-symbols'),
  MailListener = require("mail-listener2-updated"),
  promiseRetry = require("promise-retry"),
  fetch = require("node-fetch"),
  crypto = require("crypto"),
  qs = require("qs")

const binance = require('binance-api-node').default
const chalk   = require('chalk')

// Binance API initialization //
const binance_client = binance({
  apiKey: userConfig.binance.apiKey,
  apiSecret: userConfig.binance.apiSecret,
  useServerTime: true,
})
log(logSymbols.info, 'Connected to ' + chalk.magenta('Binance'))

let runningMailHandler  = false
let trading             = {"BTCUSDT": true}
let stepSize            = {"BTCUSDT": 10.566}
let total               = {}
let quantity            = {}
let balance             = {}
let buyPrice            = {}
let orderId             = {}
let tetherBalance         = 0;

let mailListener = new MailListener({
  username: userConfig.mail.username,
  password: userConfig.mail.password,
  host: userConfig.mail.host,
  mailbox: userConfig.mail.mailbox,
  port: userConfig.mail.port,
  tls: true,
  tlsOptions: {rejectUnauthorized: false},
  markSeen: false
})

// var mailListener = new MailListener({
//   username: "imap-username",
//   password: "imap-password",
//   host: "imap-host",
//   port: 993, // imap port
//   secure: true, // use secure connection
//   mailbox: "INBOX", // mailbox to monitor
//   markSeen: true, // all fetched email willbe marked as seen and not fetched next time
//   fetchUnreadOnStart: true // use it only if you want to get all unread email on lib start. Default is `false`
// });
mailListener.start()

mailListener.on("server:connected", () => {
  log(logSymbols.success, `E-Mail listener connected to ${userConfig.mail.username}`)
  log(logSymbols.info, `Listening for new TradingView notifications...`)
})

mailListener.on("server:disconnected", () => {
  log(logSymbols.error, `E-Mail listener disconnected. Attempting reconnect...`)
  setTimeout(() => {
    mailListener.restart()
  }, 5* 1000)
})

mailListener.on("error", (err) => {
  log(logSymbols.error, "Mail Listener Error:", err)
})

mailListener.on("mail", (mail) => {
  runOneAtATime(mail)
})


/**
 * Handle new incoming emails
 * @param mail
 */
function handleMail(mail) {
  var email_text = ""
  if (mail.text) {
    email_text = mail.text
  }
  else if (mail.html) {
    email_text = mail.html
  }
  // E-Mail not from TradingView
  if (mail.from[0].address.toString() !== adminConfig.tradingview.mail) {
      log(logSymbols.info, `Email received from ${mail.from[0].address.toString()}. Ignoring since sender not TradingView.`);
      return;
  }
  // Old email -  do nothing
  if (new Date(mail.receivedDate) < new Date(Date.now() - adminConfig.mail.maxMailAge * 1000)) {
      log(logSymbols.info, `Email received from ${mail.from[0].address.toString()} but email already older than ${adminConfig.mail.maxMailAge}sec. Ignoring email. `);
      return;
  }
  // R-Mail content not readable - do nothing
  if (email_text === "") {
      log(logSymbols.error, `Email received from ${mail.from[0].address.toString()} but email content not readable. Ignoring email. `);
      return;
  }
  else {
    if ( email_text.includes("#BCE_ACTION_START#") ) {
        log(chalk.magenta("PROCESSING BINANCE ORDER"))
        Binance_trade(email_text)
    }
    else
      log(logSymbols.error, "debug - For some reason, email is not readable and not in any way actionable")
  }
}


/**
 * Run the Binance Trade
 * @param text
 */
function Binance_trade(email_text) {
  var action = email_text.substring(
      email_text.lastIndexOf("#BCE_ACTION_START#") + 18,
      email_text.lastIndexOf("#BCE_ACTION_END#")
  ).toUpperCase()
  log(chalk.grey("BINANCE ACTION: "), action)

  var pair = email_text.substring(
      email_text.lastIndexOf("#BCE_PAIR_START#") + 16,
      email_text.lastIndexOf("#BCE_PAIR_END#")
  ).toUpperCase()
  log(chalk.grey("PAIR: "), pair)

  // TD BUY ALERT TEXT FORMAT:
  // #BCE_ACTION_START#BUY#BCE_ACTION_END#
  // #BCE_PAIR_START#BTCUSDT#BCE_PAIR_END#
  // #BCE_TOT_START#15#BCE_TOT_END#
  if (action === 'BUY' || action === 'STRONG BUY') {

    binance_client.accountInfo()
      .then(results => {
        console.log('dubug - Market Buy')
        // console.log('debug - Market Buy - accountInfo() results:', results)
        if(results && results.balances && results.balances.length > 0) {
          // console.log('my BTC balance - name:', results.balances[0].asset, 'amount free:', results.balances[0].free)

          const bitcoin = results.balances.find(pair => pair.asset === "BTC")
          const tether = results.balances.find(pair => pair.asset === "USDT")

          console.log('tether balance: name:', tether.asset, 'free:', tether.free)
          
          if(bitcoin && bitcoin.free) {
            const btcBalance = Number.parseFloat(bitcoin.free - 0.00001).toFixed(6);
            console.log('btc balance (calculated):', btcBalance)

            if(tether && tether.free) {
              const usdtBalance = Number.parseFloat(tether.free - 0.1).toFixed(1);
              console.log('usdt balance (calculated):', usdtBalance)
              tetherBalance = usdtBalance;
            }
            else
              console.log('usdt balance not found or some error like that')

            balance = {...balance, 'BTCUSDT': btcBalance}
            quantity = {...quantity, 'BTCUSDT': btcBalance}
            total = {...total, 'BTCUSDT': btcBalance}
          }
          else
            console.log('debug - almost there, but first entry result was not BTC')
        }
        else
          console.log('debug - Market Buy - accountInfo() results data came back incomplete or invalid')
      })
      .then(() => {
        // total[pair] = parseFloat(email_text.substring(
        //   email_text.lastIndexOf("#BCE_TOT_START#") + 15,
        //   email_text.lastIndexOf("#BCE_TOT_END#")
        // ))
        // log(chalk.grey("TOTAL VALUE: "), total[pair])
    
        if (trading[pair]) {
          // EXISTING TRADING PAIR //
          buy_at_market_price(pair)
        }
        else {
          console.log('debug - new trading pair')
          // NEW TRADING PAIR
          // FIND OUT IF PAIR EXISTS:
          binance_client.exchangeInfo().then(results => {
            // CHECK IF PAIR IS UNKNOWN:
            if (_.filter(results.symbols, {symbol: pair}).length > 0) {
              // PAIR EXISTS
              stepSize[pair] = _.filter(results.symbols, {symbol: pair})[0].filters[1].stepSize
              buy_at_market_price(pair)
            }
            // PAIR UNKNOWN:
            else {
              log(chalk.yellow(pair + "  => This pair is unknown to Binance." ))
              return
            }
          })
        }
      })
      .catch(err => {
        console.log('debug - Error Market Buy - error:', err)
        return;
      })

    
  }
  // TD SELL ALERT TEXT FORMAT:
  // #BCE_ACTION_START#SELL#BCE_ACTION_END#
  // #BCE_PAIR_START#BTCUSDT#BCE_PAIR_END#
  else if (action === 'SELL' || action === 'STRONG SELL') {
    // get the balance of BTC
    binance_client.accountInfo()
      .then(results => {
        console.log('debug - Market Sell')
        // console.log('debug - Market Sell - accountInfo() results:', results)
        if(results && results.balances && results.balances.length > 0) {
          // console.log('my BTC balance - name:', results.balances[0].asset, 'amount free:', results.balances[0].free)
          // console.log('my USDT balance - name:', results.balances["USDT"].asset, 'amount free:', results.balances["USDT"].free)

          const bitcoinAsset = results.balances.find(pair => pair.asset === "BTC")
          const tetherAsset = results.balances.find(pair => pair.asset === "USDT")

          console.log('tether balance: name:', tetherAsset.asset, 'free:', tetherAsset.free)

          if(bitcoinAsset && bitcoinAsset.free) {
            const btcBalance = Number.parseFloat(bitcoinAsset.free - .00001).toFixed(6);
            console.log('btc balance (calculated):', btcBalance)

            if(tetherAsset && tetherAsset.free) {
              const usdtBalance = Number.parseFloat(tetherAsset.free - .1).toFixed(1);
              console.log('usdt balance (calculated):', usdtBalance)
              tetherBalance = usdtBalance;
            }
            else
              console.log('usdt balance not found or some error like that')

            balance = {...balance, 'BTCUSDT': btcBalance}
            quantity = {...quantity, 'BTCUSDT': btcBalance}
            total = {...total, 'BTCUSDT': btcBalance}
          }
          else {
            console.log('debug - almost there, but BTC is undefined in the results')
            console.log('debug - printing results:', results)
          }
        }
        else
          console.log('debug - Market Sell - accountInfo() results data came back incomplete or invalid')
      })

      // We are selling the Tether, not the Bitcoin. Let's do it
      .then(() => {
        if (trading[pair]) {
          if(Number.parseFloat(balance[pair]) > 0) {
            log(chalk.keyword('orange')("SELLING " + balance[pair] + " OF " + pair + " AT MARKET PRICE" ))
            binance_client.order({
              symbol: pair,
              side: 'SELL',
              type: 'MARKET',
              quantity: balance[pair],
              // quantity: tetherBalance,
              recvWindow: 59999
            })
            .then( order => {
              orderId[pair] = order.orderId
              log(logSymbols.success, chalk.grey("SELL MARKET ORDER SET "))
              check_market_order(pair, order.orderId)
              balance[pair] = 0
              quantity[pair] = 0
            })
            .catch( error => {
              log(logSymbols.error, "MARKET SELL ERROR " + error )
              return
            })
          }
          else
            log("Cannot sell a bitcoin balance that is at or near 0")
        }
        else {
          log(chalk.keyword('orange')("THIS PAIR IS NOT YET TRADED: " + pair ))
        }
      })
      .catch(err => {
        console.log('debug - Error Market Sell - error:', err)
        return;
      })
  }
}

function buy_at_market_price(pair) {
  console.log('debug - Market Buy - pair:', pair)
  // GET ORDER BOOK TO FIND OUT OUR BUY PRICE
  binance_client.book({ symbol: pair })
    .then(results => {
      // note: 'results' object is the order book with bids / asks
      // SO WE CAN TRY TO BUY AT THE 1ST BID PRICE + %0.02:
      buyPrice[pair] = parseFloat(results.asks[0].price)
      log(chalk.grey("CURRENT 1ST ASK PRICE : " + buyPrice[pair]))
      // if stepSize[pair] = 10.56,
      // then .split('.')[1] gives 56
      // length of 56 is 2;
      // so precision = 2;
      // .toFixed(2) just gives 2 decimal places....
      // so precision = 2 (or can be 0 if length is undefined, but still needs decimal point)
      // var precision = stepSize[pair].toString().split('.')[1].length || 0
      var precision = 4;
      
      const buyQuantity = 0.006; // BTC

      // now we need to calculate what this quantity really is
      // 
      // quantity[pair] = (( ((total[pair] / buyPrice[pair]) / parseFloat(stepSize[pair])) | 0 ) * parseFloat(stepSize[pair])).toFixed(precision)
      
      log(chalk.grey("BUYING " + buyQuantity + " OF " + pair + " AT MARKET PRICE" ))
      // log(chalk.grey("BUYING " + quantity[pair] + " OF " + pair + " AT MARKET PRICE" ))
      // SETUP MARKET BUY xORDER
      binance_client.order({
        symbol: pair,
        side: 'BUY',
        type: 'MARKET',
        // quantity: quantity[pair],
        // quantity: 0,
        quantity: buyQuantity,
        // note: recvWindow is not required!!
        recvWindow: 59999
    })
    .then((order) => {
      orderId[pair] = order.orderId
      trading[pair] = true
      if (balance[pair]) {
        var precision = stepSize[pair].toString().split('.')[1].length || 0
        balance[pair] = (parseFloat(balance[pair]) + parseFloat(quantity[pair])).toFixed(precision)
      }
      else {
        balance[pair] = quantity[pair]
      }
      log(logSymbols.success, chalk.grey("BUY MARKET ORDER SET"))
      check_market_order(pair, order.orderId)
    })
    .catch((error) => {
      log(logSymbols.error, "BUY MARKET ERROR " + error)
      return;
    })
  })
}


function check_market_order(pair, orderId) {
  binance_client.getOrder({
    symbol: pair,
    orderId: orderId,
    recvWindow: 59999
  })
  .then( order => {
    if (order.status === "FILLED") {
      log(logSymbols.success, chalk.gray("MARKET ORDER FILLED "))
      return
    }
    else {
      log(logSymbols.warning, chalk.gray("MARKET ORDER NOT YET FILLED "))
      check_market_order(pair, orderId)
    }
  })
  .catch( error => {
    console.log('debug - Error with check market order - error:', error)
    //log(logSymbols.error, "CHECK MARKET ORDER API ERROR " + error )
    return
  })
}


/**
 * Make sure that only one mail is being handled at a time
 */
function runOneAtATime(mail) {
  if (runningMailHandler) {
    setTimeout(runOneAtATime, 100, mail);
  }
  else {
    runningMailHandler = true;
    handleMail(mail);
    log(logSymbols.info, 'Listening for new TradingView notifications...');
    runningMailHandler = false;
  }
}

/**
 * Test an order, without actually placing it. Optional params for the order type that defaults to market order
 */
const placeTestOrder = async (type = "MARKET", side = 'BUY') => {
  const testOrderResults = await binance_client.orderTest({
    symbol: 'BTCUSDT',
    type,
    side,
    quantity: 100,
    price: 0.0002,
  })

  console.log('debug - test order results - results:', testOrderResults)
}


/**
 * Calculate net profit / loss of account, either to-date or with timeframe in mind
 */
function getNetProfitLoss(symbol = 'BTCUSDT', timeframe = null, tradesLimit = 500) {
  if(timeframe) {
    console.log('debug - getting pnl by timeframe not supported yet')
  }
  else {
    // get trade history, limits to last 500 trades by default
    const tradeHistory = binance_client.tradesHistory({ symbol: symbol, limit: tradesLimit, })
      .then(result => {
        console.log('trades history results:', result);
        return result;
      })
      .catch(err => {
        console.log('debug - there was an error getting the trade history - err:', err)
      })

    // return tradeHistory;
  }
}