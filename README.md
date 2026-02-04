# Silver Predictor

A NestJS application that monitors silver prices, detects manipulation patterns, and executes automated trades on noghresea.ir using AI-powered decision making.

## Features

- 📊 Real-time price monitoring (every 10 seconds)
- 🔍 Pattern detection (multi-bearish, manipulation, recovery, etc.)
- 🤖 AI-powered trading decisions via GPT-4.1
- 💰 Automated buy/sell execution
- 📱 Telegram bot for control and notifications
- 🔐 OTP-based authentication with noghresea.ir

## Setup

### 1. Start the database

```bash
docker-compose up -d
```

### 2. Configure environment

Edit `.env` file with your credentials:

```env
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4.1  # Optional, defaults to gpt-4.1
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id  # Get this by messaging the bot
```

### 3. Install dependencies

```bash
npm install
```

### 4. Run the application

```bash
# Development
npm run start:dev

# Production
npm run build
npm start
```

## Telegram Bot Commands

Once started, message `@silverpredictorbot`:

- **📊 Status** - View current prices, wallet, and AI analysis
- **🔐 Auth** - Authenticate with noghresea.ir via OTP
- **▶️ Enable Trading** - Enable automatic trade execution
- **⏸️ Disable Trading** - Stop all trading
- **📜 History** - View recent trades
- **⚙️ Settings** - View current configuration

## Configuration

| Setting                | Default | Description                            |
| ---------------------- | ------- | -------------------------------------- |
| `CONFIDENCE_THRESHOLD` | 70      | Minimum AI confidence to execute trade |
| `MAX_TRADE_PERCENT`    | 5       | Maximum % of balance per trade         |
| `POLLING_INTERVAL_MS`  | 10000   | Price check interval (10 sec)          |

## Architecture

```
src/
├── noghresea/          # noghresea.ir API client
├── price-fetcher/      # External price sources (Wallex, metals)
├── pattern-analyzer/   # Pattern detection algorithms
├── ai-decision/        # GPT-4.1 integration
├── trade-executor/     # Order execution
├── telegram-bot/       # Telegram interface
└── scheduler/          # Main loop (10-second cycle)
```

## Safety Features

- 🛑 Trading can be disabled instantly via Telegram
- 📊 Only trades when confidence ≥ 70%
- 💰 Maximum 5% of balance per trade
- 📱 All trades notify via Telegram
- ⚠️ Alerts when confidence approaches threshold (65%+)
# Test CI/CD - Wed Feb  4 09:00:48 AM UTC 2026
