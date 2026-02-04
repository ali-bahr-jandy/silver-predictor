# Silver Predictor - Architecture Document

## 🎯 Project Overview

A NestJS application that monitors silver prices across multiple sources, detects manipulation patterns on noghresea.ir, and uses AI (GPT-4.1) to make buy/sell decisions.

---

## 📊 Data Sources

| Source                | Data                        | Update Frequency    |
| --------------------- | --------------------------- | ------------------- |
| **noghresea.ir**      | Platform silver price (IRR) | Every 10-30 seconds |
| **International API** | Silver Ounce (USD)          | Real-time/WebSocket |
| **International API** | Gold Ounce (USD)            | Real-time/WebSocket |
| **Iranian Exchange**  | USD/IRR rate                | Every minute        |
| **Iranian Exchange**  | USDT/IRR rate               | Every minute        |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SCHEDULER (Cron)                         │
│                   Runs every 10-30 seconds                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Price Fetcher  │ │  Price Fetcher  │ │  Price Fetcher  │
│   (Noghresea)   │ │  (International)│ │   (Tether/USD)  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             ▼
                 ┌───────────────────────┐
                 │    Price Aggregator   │
                 │  (Normalize & Store)  │
                 └───────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│    Pattern Analyzer     │    │      Database (PG)      │
│ - Detect manipulation   │    │ - Price history         │
│ - Detect market-driven  │    │ - Pattern events        │
│ - Multi-bearish detect  │    │ - Trade history         │
└───────────┬─────────────┘    └─────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│    AI Decision Engine   │
│      (GPT-4.1 API)      │
│ - Analyze patterns      │
│ - Historical context    │
│ - BUY/SELL/HOLD signal  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    Trade Executor       │
│ - Execute on noghresea  │
│ - Manage wallet balance │
│ - Risk management       │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Telegram Bot          │
│ - Real-time alerts      │
│ - Manual controls       │
│ - Status reports        │
└─────────────────────────┘
```

---

## 📁 Module Structure

```
src/
├── app.module.ts
├── main.ts
│
├── config/
│   └── configuration.ts          # Environment variables
│
├── database/
│   ├── database.module.ts
│   └── entities/
│       ├── price-snapshot.entity.ts    # All price snapshots
│       ├── noghresea-price.entity.ts   # Noghresea specific prices
│       ├── pattern-event.entity.ts     # Detected patterns
│       ├── trade.entity.ts             # Trade history
│       └── bot-settings.entity.ts      # Bot configuration
│
├── price-fetcher/
│   ├── price-fetcher.module.ts
│   ├── price-fetcher.service.ts        # Orchestrates all fetchers
│   ├── noghresea-api.service.ts        # Noghresea API client
│   ├── international-price.service.ts  # Silver/Gold ounce prices
│   └── tether-price.service.ts         # USDT/USD rates
│
├── pattern-analyzer/
│   ├── pattern-analyzer.module.ts
│   └── pattern-analyzer.service.ts
│       # Detects:
│       # - MULTI_BEARISH: 2-3 consecutive drops
│       # - MULTI_BULLISH: 2-3 consecutive rises
│       # - SUDDEN_DROP: >0.5% drop in single tick
│       # - SUDDEN_SPIKE: >0.5% rise in single tick
│       # - MANIPULATION: Platform vs market divergence
│       # - MARKET_DRIVEN: Follows international price
│       # - RECOVERY: Bounce back after drop
│
├── ai-decision/
│   ├── ai-decision.module.ts
│   ├── ai-decision.service.ts          # GPT-4.1 integration
│   └── prompt-builder.service.ts       # Builds context prompts
│
├── trade-executor/
│   ├── trade-executor.module.ts
│   └── trade-executor.service.ts
│       # Actions:
│       # - BUY: Convert Toman → Silver
│       # - SELL: Convert Silver → Toman
│       # - Risk limits & position management
│
├── telegram-bot/
│   ├── telegram-bot.module.ts
│   └── telegram-bot.service.ts
│       # Commands:
│       # - /status: Current prices & positions
│       # - /start: Enable auto-trading
│       # - /stop: Disable auto-trading
│       # - /history: Recent trades
│
└── scheduler/
    ├── scheduler.module.ts
    └── scheduler.service.ts            # Main loop coordination
```

---

## 🗄️ Database Schema

### 1. price_snapshots

Stores all external price data.

| Column      | Type      | Description                                 |
| ----------- | --------- | ------------------------------------------- |
| id          | UUID      | Primary key                                 |
| source      | ENUM      | SILVER_OUNCE, GOLD_OUNCE, USD_IRR, USDT_IRR |
| price       | DECIMAL   | Price value                                 |
| currency    | VARCHAR   | USD, IRR                                    |
| recorded_at | TIMESTAMP | When fetched                                |

### 2. noghresea_prices

Stores noghresea.ir specific data with change tracking.

| Column           | Type      | Description                 |
| ---------------- | --------- | --------------------------- |
| id               | UUID      | Primary key                 |
| price            | DECIMAL   | Silver price (IRR)          |
| change_from_prev | DECIMAL   | Change from previous record |
| change_percent   | DECIMAL   | Percentage change           |
| recorded_at      | TIMESTAMP | When fetched                |
| is_manipulation  | BOOLEAN   | Flagged as manipulation     |

### 3. pattern_events

Stores detected patterns for analysis.

| Column             | Type      | Description                      |
| ------------------ | --------- | -------------------------------- |
| id                 | UUID      | Primary key                      |
| pattern_type       | ENUM      | Pattern type detected            |
| confidence         | INTEGER   | 0-100 confidence score           |
| silver_ounce_price | DECIMAL   | International price at detection |
| noghresea_price    | DECIMAL   | Platform price at detection      |
| description        | TEXT      | Human-readable description       |
| detected_at        | TIMESTAMP | When detected                    |

### 4. trades

Stores all executed trades.

| Column       | Type      | Description          |
| ------------ | --------- | -------------------- |
| id           | UUID      | Primary key          |
| action       | ENUM      | BUY, SELL            |
| amount       | DECIMAL   | Amount traded        |
| price        | DECIMAL   | Execution price      |
| ai_reasoning | TEXT      | GPT-4.1 reasoning    |
| pattern_id   | UUID      | Related pattern (FK) |
| profit_loss  | DECIMAL   | Calculated P/L       |
| executed_at  | TIMESTAMP | Execution time       |

### 5. bot_settings

Stores bot configuration.

| Column     | Type      | Description   |
| ---------- | --------- | ------------- |
| id         | UUID      | Primary key   |
| key        | VARCHAR   | Setting name  |
| value      | TEXT      | Setting value |
| updated_at | TIMESTAMP | Last update   |

---

## 🔍 Pattern Detection Logic

### Multi-Bearish Detection

```
IF last 2-3 price changes are ALL negative
   AND total drop > 0.3%
   AND happened within 2 minutes
THEN → MULTI_BEARISH pattern
```

### Manipulation vs Market-Driven

```
IF noghresea price changed > 0.5%
   AND international silver ounce changed < 0.2%
   AND USD/IRR stable
THEN → MANIPULATION (platform game)

IF noghresea price changed
   AND international silver ounce changed similarly
THEN → MARKET_DRIVEN (following market)
```

### Recovery Detection

```
IF previous 2-3 prices were dropping
   AND current price is rising
   AND rise > 30% of previous drop
THEN → RECOVERY pattern (potential buy signal)
```

---

## 🤖 AI Decision Flow

### Prompt Structure

```
You are a silver trading assistant analyzing noghresea.ir platform.

CURRENT PRICES:
- Noghresea Silver: XXX,XXX IRR
- Silver Ounce: $XX.XX
- Gold Ounce: $X,XXX
- USD/IRR: XX,XXX
- USDT/IRR: XX,XXX

RECENT PRICE HISTORY (last 10 minutes):
[List of price changes with timestamps]

DETECTED PATTERNS:
- Pattern: MULTI_BEARISH
- Confidence: 85%
- Description: 3 consecutive drops totaling -1.2%

CURRENT POSITION:
- Silver Balance: XXX grams
- Toman Balance: XXX,XXX IRR

HISTORICAL CONTEXT:
- Similar patterns in past led to: [outcomes]

Based on this analysis, should I BUY, SELL, or HOLD?
Respond with JSON: { "action": "BUY|SELL|HOLD", "confidence": 0-100, "reasoning": "..." }
```

---

## 📡 API Requirements

### From You (Required):

#### 1. Noghresea.ir APIs

- **Login/Auth**: Endpoint, payload, response format
- **Get Current Price**: Endpoint to fetch live silver price
- **Get Wallet Balance**: Endpoint to check Toman/Silver balance
- **Buy Silver**: Endpoint, payload format
- **Sell Silver**: Endpoint, payload format
- **Price History** (if available): Historical prices

#### 2. Iranian Tether Exchange

- **Get USDT/IRR Rate**: Which platform? API endpoint?
- **Get USD/IRR Rate**: Source for dollar price

### I Will Implement:

- **Silver Ounce Price**: Free APIs available (e.g., metals-api.com, goldapi.io)
- **Gold Ounce Price**: Same sources as silver
- **WebSocket connections** for real-time data if available

---

## ⚙️ Configuration Needed

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/silver_predictor

# Noghresea.ir
NOGHRESEA_API_URL=https://api.noghresea.ir
NOGHRESEA_USERNAME=your_username
NOGHRESEA_PASSWORD=your_password

# AI
OPENAI_API_KEY=your_openai_key
AI_MODEL=gpt-4.1

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Trading Settings
MAX_TRADE_PERCENT=50          # Max % of balance per trade
MIN_CONFIDENCE=70             # Min AI confidence to execute
ENABLE_AUTO_TRADING=false     # Start with manual mode
```

---

## 🚀 Development Phases

### Phase 1: Foundation ✅ COMPLETE

- [x] NestJS project setup
- [x] Database entities & migrations (10 entities)
- [x] Basic module structure
- [x] Environment validation

### Phase 2: Data Collection ✅ COMPLETE

- [x] Noghresea API integration (Auth, prices, wallet, orders)
- [x] International price fetching (gold-api.com, metals.live)
- [x] Tether/USD rate fetching (Wallex API)
- [x] Price storage & history

### Phase 3: Pattern Analysis ✅ COMPLETE

- [x] Multi-bearish/bullish detection
- [x] Manipulation vs market-driven detection
- [x] Sudden drop/spike detection
- [x] Recovery pattern detection
- [x] Confidence scoring with baseline

### Phase 4: AI Integration ✅ COMPLETE

- [x] GPT-4.1 prompt engineering
- [x] Decision parsing (JSON format)
- [x] Historical context building
- [x] Similar pattern matching

### Phase 5: Trade Execution ✅ COMPLETE

- [x] Noghresea buy/sell integration
- [x] Risk management (confidence threshold, max trade %)
- [x] Position tracking (wallet snapshots)
- [x] Enable/disable trading toggle
- [x] Transaction service

### Phase 6: Notifications ✅ COMPLETE

- [x] Telegram bot setup (@silverpredictorbot)
- [x] Real-time alerts (patterns, trades, errors)
- [x] Manual controls (Start/Stop Bot, Auth)
- [x] Status reports (every 5 minutes)
- [x] Daily summary generation
- [x] Graceful shutdown handling

---

## 🏗️ Implemented Components

| Component           | File                                               | Status |
| ------------------- | -------------------------------------------------- | ------ |
| App Module          | `src/app.module.ts`                                | ✅     |
| Price Fetcher       | `src/price-fetcher/`                               | ✅     |
| Metals Service      | `src/price-fetcher/sources/metals.service.ts`      | ✅     |
| Wallex Service      | `src/price-fetcher/sources/wallex.service.ts`      | ✅     |
| Noghresea API       | `src/noghresea/noghresea-api.service.ts`           | ✅     |
| Noghresea Auth      | `src/noghresea/noghresea-auth.service.ts`          | ✅     |
| Browser Session     | `src/noghresea/browser-session.service.ts`         | ✅     |
| Pattern Analyzer    | `src/pattern-analyzer/pattern-analyzer.service.ts` | ✅     |
| AI Decision         | `src/ai-decision/ai-decision.service.ts`           | ✅     |
| Prompt Builder      | `src/ai-decision/prompt-builder.service.ts`        | ✅     |
| Trade Executor      | `src/trade-executor/trade-executor.service.ts`     | ✅     |
| Transaction Service | `src/trade-executor/transaction.service.ts`        | ✅     |
| Telegram Bot        | `src/telegram-bot/telegram-bot.service.ts`         | ✅     |
| Scheduler           | `src/scheduler/scheduler.service.ts`               | ✅     |
| Daily Analysis      | `src/analysis/daily-analysis.service.ts`           | ✅     |
| Health Check        | `src/health/health.controller.ts`                  | ✅     |
| Env Validation      | `src/common/env.validation.ts`                     | ✅     |
| Constants           | `src/common/constants.ts`                          | ✅     |

---

## 📊 Database Entities (10 Total)

| Entity           | Table              | Purpose                                       |
| ---------------- | ------------------ | --------------------------------------------- |
| `PriceSnapshot`  | `price_snapshots`  | External price data (silver/gold ounce, USDT) |
| `NoghreseaPrice` | `noghresea_prices` | Platform prices with change tracking          |
| `PatternEvent`   | `pattern_events`   | Detected patterns for analysis                |
| `TradeHistory`   | `trade_history`    | Executed trades with AI reasoning             |
| `WalletSnapshot` | `wallet_snapshots` | Wallet balance history                        |
| `AppSettings`    | `app_settings`     | Bot configuration (trading_enabled, etc.)     |
| `AuthState`      | `auth_states`      | Authentication tokens storage                 |
| `AiDecision`     | `ai_decisions`     | AI decision history                           |
| `DailySummary`   | `daily_summaries`  | End-of-day reports                            |
| `Transaction`    | `transactions`     | Transaction history                           |

---

## 🔧 Pattern Types Detected

| Pattern         | Threshold                     | Action Suggested         |
| --------------- | ----------------------------- | ------------------------ |
| `MULTI_BEARISH` | 2+ consecutive drops          | SELL (if market-driven)  |
| `MULTI_BULLISH` | 2+ consecutive rises          | BUY (continue trend)     |
| `SUDDEN_DROP`   | >0.2% single tick drop        | HOLD (wait for recovery) |
| `SUDDEN_SPIKE`  | >0.2% single tick rise        | SELL (take profit)       |
| `MANIPULATION`  | Platform moves, market stable | HOLD (wait for revert)   |
| `MARKET_DRIVEN` | Follows international price   | Follow trend             |
| `RECOVERY`      | Drop then rise pattern        | BUY opportunity          |

---

## 📝 All Features Implemented

The Silver Predictor application is **fully implemented** with all requested features! 🎉
