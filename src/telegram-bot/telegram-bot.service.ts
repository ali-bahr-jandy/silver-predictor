import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Telegraf, Markup } from "telegraf";
import { NoghreseaAuthService } from "../noghresea/noghresea-auth.service";
import { NoghreseaApiService } from "../noghresea/noghresea-api.service";
import { TradeHistory } from "../database/entities/trade-history.entity";
import { AiDecision } from "../ai-decision/ai-decision.service";
import { AllPrices } from "../price-fetcher/price-fetcher.service";
import { PatternAnalysis } from "../pattern-analyzer/pattern-analyzer.service";
import { DailyAnalysisService } from "../analysis/daily-analysis.service";
import { TransactionService } from "../trade-executor/transaction.service";

// State for manual trading flow
interface ManualTradeState {
  action: "buy" | "sell";
  awaitingAmount: boolean;
  maxAmount: number;
  currentPrice: number;
}

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf;
  private chatId: string | null = null;
  private awaitingOtp = false;
  private awaitingPhone = false; // For phone number input
  private tradeExecutor: any = null; // Will be injected later to avoid circular dep
  private dailyAnalysis: DailyAnalysisService | null = null;
  private transactionService: TransactionService | null = null;
  private priceFetcher: any = null;
  private patternAnalyzer: any = null;
  private manualTradeState: ManualTradeState | null = null; // For manual buy/sell flow

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => NoghreseaAuthService))
    private authService: NoghreseaAuthService,
    @Inject(forwardRef(() => NoghreseaApiService))
    private noghreseaApi: NoghreseaApiService,
  ) {
    const token = this.configService.get("TELEGRAM_BOT_TOKEN");
    this.logger.log(`Telegram token configured: ${token ? "YES" : "NO"}`);
    if (token) {
      this.logger.log(`Token starts with: ${token.substring(0, 10)}...`);
      this.bot = new Telegraf(token);
      this.chatId = this.configService.get("TELEGRAM_CHAT_ID") || null;
      this.logger.log(`Chat ID: ${this.chatId || "not set"}`);
    } else {
      this.logger.warn("No TELEGRAM_BOT_TOKEN found in environment!");
    }
  }

  setTradeExecutor(executor: any) {
    this.tradeExecutor = executor;
  }

  setDailyAnalysis(service: DailyAnalysisService) {
    this.dailyAnalysis = service;
  }

  setTransactionService(service: TransactionService) {
    this.transactionService = service;
  }

  setPriceFetcher(service: any) {
    this.priceFetcher = service;
  }

  setPatternAnalyzer(service: any) {
    this.patternAnalyzer = service;
  }

  async onModuleInit() {
    if (!this.bot) {
      this.logger.warn("Telegram bot not configured - no token provided");
      return;
    }

    this.logger.log("Setting up Telegram bot handlers...");
    this.setupHandlers();

    // Add error handling for the bot
    this.bot.catch((err: Error, ctx) => {
      this.logger.error(`Telegraf error for ${ctx.updateType}: ${err.message}`);
    });

    // Launch bot with explicit options
    this.logger.log("Launching Telegram bot with polling...");

    try {
      // Drop any pending updates and start polling
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
      this.logger.log("Webhook cleared, starting polling...");

      // Launch returns a promise that resolves when bot stops, not when it starts
      // So we start it and immediately log success
      this.bot.launch({
        dropPendingUpdates: true,
        allowedUpdates: ["message", "callback_query"],
      });

      // Bot is now listening
      this.logger.log("🤖 Telegram bot started: @silverpredictorbot");
      this.logger.log("📡 Listening for commands...");
    } catch (error: any) {
      this.logger.error(`Failed to start Telegram bot: ${error.message}`);
      this.logger.error(error.stack);
    }
  }

  async onModuleDestroy() {
    if (this.bot) {
      this.logger.log("🛑 Stopping Telegram bot...");
      this.bot.stop("Application shutdown");
      this.logger.log("✅ Telegram bot stopped gracefully");
    }
  }

  private setupHandlers() {
    // Log all incoming updates and handle Start/Stop Bot
    this.bot.use(async (ctx, next) => {
      const text = (ctx.message as any)?.text || "";
      this.logger.log(
        `📩 Received update: ${ctx.updateType} from chat ${ctx.chat?.id} - text: "${text}"`,
      );

      // Handle Start Bot / Stop Bot commands here to avoid emoji encoding issues
      if (text.includes("Start Bot")) {
        this.logger.log("▶️ Start Bot button pressed (via middleware)");
        if (this.tradeExecutor) {
          await this.tradeExecutor.enableTrading();
          this.logger.log("✅ Trading enabled via button");
          await ctx.reply(
            "✅ *Bot STARTED*\n\n" +
              "Full monitoring resumed:\n" +
              "• Price checking every 10 seconds\n" +
              "• Pattern analysis active\n" +
              "• AI trading decisions enabled",
            { parse_mode: "Markdown" },
          );
        } else {
          await ctx.reply(
            "❌ Trade executor not available. Please restart the bot.",
          );
        }
        return; // Don't call next, we handled it
      }

      if (text.includes("Stop Bot")) {
        this.logger.log("⏸️ Stop Bot button pressed (via middleware)");
        if (this.tradeExecutor) {
          await this.tradeExecutor.disableTrading();
          this.logger.log("🛑 Trading disabled via button");
          await ctx.reply(
            "🛑 *Bot STOPPED*\n\n" +
              "All monitoring is paused:\n" +
              "• No price checking\n" +
              "• No pattern analysis\n" +
              "• No AI decisions\n" +
              "• No trades\n\n" +
              "Press *Start Bot* to resume.",
            { parse_mode: "Markdown" },
          );
        } else {
          await ctx.reply(
            "❌ Trade executor not available. Please restart the bot.",
          );
        }
        return; // Don't call next, we handled it
      }

      // Handle Buy command via middleware to avoid emoji encoding issues
      if (text.includes("Buy") && !text.includes("Start")) {
        this.logger.log("💰 Buy button pressed (via middleware)");
        await this.handleBuyCommand(ctx);
        return;
      }

      // Handle Sell command via middleware to avoid emoji encoding issues
      if (text.includes("Sell")) {
        this.logger.log("📤 Sell button pressed (via middleware)");
        await this.handleSellCommand(ctx);
        return;
      }

      return next();
    });

    // Start command
    this.bot.command("start", async (ctx) => {
      this.chatId = ctx.chat.id.toString();
      this.logger.log(`Chat ID set: ${this.chatId}`);

      await ctx.reply(
        "🪙 *Silver Predictor Bot*\n\n" +
          "Welcome! This bot monitors silver prices and executes trades automatically.\n\n" +
          "Use the menu below to control the bot.",
        {
          parse_mode: "Markdown",
          ...Markup.keyboard([
            ["📊 Status", "🔐 Auth"],
            ["▶️ Start Bot", "⏸️ Stop Bot"],
            ["💰 Buy", "📤 Sell"],
            ["📜 History", "💳 Transactions"],
            ["📈 Daily Report", "⚙️ Settings"],
          ]).resize(),
        },
      );

      // Check auth status
      if (!this.authService.isAuthenticated()) {
        await ctx.reply(
          "⚠️ *Not Authenticated*\n\nYou need to authenticate with Noghresea to start trading.",
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              Markup.button.callback("📱 Send OTP", "send_otp"),
            ]),
          },
        );
      }
    });

    // Status button
    this.bot.hears("📊 Status", async (ctx) => {
      await this.sendStatusReport(ctx);
    });

    // Transactions button
    this.bot.hears("💳 Transactions", async (ctx) => {
      if (!this.transactionService) {
        await ctx.reply("❌ Transaction service not available.");
        return;
      }

      try {
        const summary = await this.transactionService.getStatsSummary(30);
        await ctx.reply(summary, { parse_mode: "Markdown" });
      } catch (error: any) {
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    // Auth button
    this.bot.hears("🔐 Auth", async (ctx) => {
      if (this.authService.isAuthenticated()) {
        const phone = this.authService.getPhoneNumber();
        const maskedPhone = phone
          ? phone.replace(/(\d{4})(\d{3})(\d{4})/, "$1***$3")
          : "N/A";
        await ctx.reply(`✅ Already authenticated!\n\nPhone: ${maskedPhone}`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🚪 Logout", callback_data: "logout" }]],
          },
        });
      } else {
        this.awaitingPhone = true;
        this.awaitingOtp = false;
        await ctx.reply(
          "🔒 Authentication Required\n\n" +
            "Please enter your phone number:\n" +
            "Format: 09123456789",
        );
      }
    });

    // Logout action
    this.bot.action("logout", async (ctx) => {
      await ctx.answerCbQuery();
      await this.authService.invalidateToken();
      await ctx.editMessageText(
        "🚪 Logged out successfully!\n\nTap 🔐 Auth to login with a new phone number.",
      );
    });

    // Send OTP action (legacy, kept for compatibility)
    this.bot.action("send_otp", async (ctx) => {
      await ctx.answerCbQuery();
      const success = await this.authService.sendOtp();

      if (success) {
        this.awaitingOtp = true;
        this.awaitingPhone = false;
        await ctx.reply(
          "✅ OTP sent to your phone!\n\nPlease enter the OTP code:",
        );
      } else {
        await ctx.reply("❌ Failed to send OTP. Please try again.");
      }
    });

    // OTP input, phone input, and custom amount handler
    this.bot.on("text", async (ctx, next) => {
      const text = ctx.message.text.trim();

      // Handle phone number input
      if (this.awaitingPhone) {
        // Validate Iranian phone number format
        const phoneRegex = /^(09\d{9}|۰۹[\d۰-۹]{9})$/;
        // Convert Persian digits to English
        const normalizedPhone = text.replace(/[۰-۹]/g, (d) =>
          String.fromCharCode(d.charCodeAt(0) - 1728),
        );

        if (phoneRegex.test(text) || /^09\d{9}$/.test(normalizedPhone)) {
          const phone = normalizedPhone.startsWith("09")
            ? normalizedPhone
            : text;

          this.authService.setPhoneNumber(phone);
          await ctx.reply(`📱 Phone: ${phone}\n\nSending OTP...`);

          const success = await this.authService.sendOtp(phone);

          if (success) {
            this.awaitingPhone = false;
            this.awaitingOtp = true;
            await ctx.reply(
              "✅ *OTP Sent!*\n\nPlease enter the 5 or 6 digit code:",
              { parse_mode: "Markdown" },
            );
          } else {
            await ctx.reply(
              "❌ Failed to send OTP. Please check the phone number and try again.",
            );
          }
          return;
        } else {
          await ctx.reply(
            "❌ Invalid phone format.\n\nPlease enter like: `09123456789`",
            { parse_mode: "Markdown" },
          );
          return;
        }
      }

      // Handle OTP input
      if (this.awaitingOtp) {
        if (/^\d{5,6}$/.test(text)) {
          const success = await this.authService.verifyOtp(text);
          this.awaitingOtp = false;

          if (success) {
            await ctx.reply(
              "✅ *Authentication Successful!*\n\nYou can now start trading.",
              {
                parse_mode: "Markdown",
              },
            );
          } else {
            await ctx.reply("❌ Invalid OTP. Please try again.");
          }
          return;
        }
      }

      // Handle custom amount input for manual trading
      if (this.manualTradeState && this.manualTradeState.awaitingAmount) {
        const input = text.replace(/,/g, "");
        const amount = parseFloat(input);

        if (isNaN(amount) || amount <= 0) {
          await ctx.reply("❌ Invalid amount. Please enter a valid number.");
          return;
        }

        // API price is in thousands, real price = apiPrice * 1000
        const pricePerGram = this.manualTradeState.currentPrice * 1000;

        if (this.manualTradeState.action === "buy") {
          // Validate buy amount (in Toman)
          if (amount < 100000) {
            await ctx.reply("❌ Minimum buy amount is 100,000 Toman.");
            return;
          }
          if (amount > this.manualTradeState.maxAmount) {
            await ctx.reply(
              `❌ Amount exceeds your balance (${this.manualTradeState.maxAmount.toLocaleString()} Toman).`,
            );
            return;
          }

          // Calculate grams: Toman / pricePerGram
          const grams = Math.floor((amount / pricePerGram) * 1000) / 1000;
          this.manualTradeState.awaitingAmount = false;

          await ctx.reply(
            `⚠️ *Confirm Purchase*\n\n` +
              `Amount: ${amount.toLocaleString()} Toman\n` +
              `Price: ${pricePerGram.toLocaleString()} Toman/gram\n` +
              `You will receive: ~${grams.toFixed(3)} grams\n\n` +
              `Are you sure?`,
            {
              parse_mode: "Markdown",
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "✅ Confirm Buy",
                    `confirm_buy_${grams}`,
                  ),
                  Markup.button.callback("❌ Cancel", "trade_cancel"),
                ],
              ]),
            },
          );
          return;
        } else if (this.manualTradeState.action === "sell") {
          // Validate sell amount (in grams)
          const minGrams = 100000 / pricePerGram;

          if (amount > this.manualTradeState.maxAmount) {
            await ctx.reply(
              `❌ Amount exceeds your balance (${this.manualTradeState.maxAmount.toFixed(3)} grams).`,
            );
            return;
          }

          if (amount < minGrams) {
            await ctx.reply(
              `❌ Minimum sell is ${minGrams.toFixed(3)} grams (100,000 Toman worth).`,
            );
            return;
          }

          const totalValue = Math.floor(amount * pricePerGram);
          this.manualTradeState.awaitingAmount = false;

          await ctx.reply(
            `⚠️ *Confirm Sale*\n\n` +
              `Selling: ${amount.toFixed(3)} grams\n` +
              `Price: ${pricePerGram.toLocaleString()} Toman/gram\n` +
              `You will receive: ~${totalValue.toLocaleString()} Toman\n\n` +
              `Are you sure?`,
            {
              parse_mode: "Markdown",
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "✅ Confirm Sell",
                    `confirm_sell_${amount}`,
                  ),
                  Markup.button.callback("❌ Cancel", "trade_cancel"),
                ],
              ]),
            },
          );
          return;
        }
      }

      // Pass to next handler
      return next();
    });

    // Start bot (enable monitoring and trading)
    this.bot.hears("▶️ Start Bot", async (ctx) => {
      this.logger.log("▶️ Start Bot button pressed");
      if (this.tradeExecutor) {
        await this.tradeExecutor.enableTrading();
        this.logger.log("✅ Trading enabled via button");
        await ctx.reply(
          "✅ *Bot STARTED*\n\n" +
            "Full monitoring resumed:\n" +
            "• Price checking every 10 seconds\n" +
            "• Pattern analysis active\n" +
            "• AI trading decisions enabled",
          {
            parse_mode: "Markdown",
          },
        );
      } else {
        this.logger.error("❌ tradeExecutor is null!");
        await ctx.reply(
          "❌ Trade executor not available. Please restart the bot.",
        );
      }
    });

    // Stop bot (disable all monitoring and trading)
    this.bot.hears("⏸️ Stop Bot", async (ctx) => {
      this.logger.log("⏸️ Stop Bot button pressed");
      if (this.tradeExecutor) {
        await this.tradeExecutor.disableTrading();
        this.logger.log("🛑 Trading disabled via button");
        await ctx.reply(
          "🛑 *Bot STOPPED*\n\n" +
            "All monitoring is paused:\n" +
            "• No price checking\n" +
            "• No pattern analysis\n" +
            "• No AI decisions\n" +
            "• No trades\n\n" +
            "Press *▶️ Start Bot* to resume.",
          {
            parse_mode: "Markdown",
          },
        );
      } else {
        this.logger.error("❌ tradeExecutor is null!");
        await ctx.reply(
          "❌ Trade executor not available. Please restart the bot.",
        );
      }
    });

    // Pause options
    this.bot.action(/pause_(\d+)/, async (ctx) => {
      const minutes = parseInt(ctx.match[1]);
      if (this.tradeExecutor) {
        await this.tradeExecutor.pauseTrading(minutes);
        await ctx.answerCbQuery();
        await ctx.reply(`⏸️ Trading paused for ${minutes} minutes.`);
      }
    });

    // History
    this.bot.hears("📜 History", async (ctx) => {
      if (!this.tradeExecutor) {
        await ctx.reply(
          "❌ Trade executor not available. Please restart the bot.",
        );
        return;
      }

      try {
        const trades = await this.tradeExecutor.getRecentTrades(5);

        if (trades.length === 0) {
          await ctx.reply("📜 *Trade History*\n\nNo trades executed yet.", {
            parse_mode: "Markdown",
          });
          return;
        }

        const history = trades
          .map((t: TradeHistory) => {
            const time = new Date(t.executedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const emoji = t.action === "BUY" ? "🟢" : "🔴";
            return `${emoji} ${time}: ${t.action} ${t.volume}g @ ${t.price}\n   Confidence: ${t.aiConfidence}%`;
          })
          .join("\n\n");

        await ctx.reply(`📜 *Recent Trades*\n\n${history}`, {
          parse_mode: "Markdown",
        });
      } catch (error: any) {
        await ctx.reply(`❌ Error loading history: ${error.message}`);
      }
    });

    // Settings
    this.bot.hears("⚙️ Settings", async (ctx) => {
      const threshold = this.configService.get("CONFIDENCE_THRESHOLD", "70");
      const maxTrade = this.configService.get("MAX_TRADE_PERCENT", "5");
      const interval = this.configService.get("POLLING_INTERVAL_MS", "10000");

      await ctx.reply(
        `⚙️ *Current Settings*\n\n` +
          `• Confidence Threshold: ${threshold}%\n` +
          `• Max Trade: ${maxTrade}% of balance\n` +
          `• Polling Interval: ${parseInt(interval) / 1000}s\n` +
          `• Trading: ${this.tradeExecutor?.isTradingEnabled() ? "✅ Enabled" : "❌ Disabled"}`,
        { parse_mode: "Markdown" },
      );
    });

    // ============ MANUAL TRADING ============

    // 💰 Buy Handler
    this.bot.hears("💰 Buy", async (ctx) => {
      if (!this.authService.isAuthenticated()) {
        await ctx.reply("❌ Not authenticated! Use 🔐 Auth first.");
        return;
      }

      try {
        await ctx.reply("💰 Checking your balance...");

        // Get current price and inventory
        const [priceData, inventory] = await Promise.all([
          this.noghreseaApi.getSilverPrice(),
          this.noghreseaApi.getInventory(),
        ]);

        if (!priceData || !priceData.price) {
          await ctx.reply("❌ Could not fetch current price. Try again.");
          return;
        }

        const currentPrice = parseFloat(priceData.price);
        // API price is in thousands (709 = 709,000 Toman/gram)
        const pricePerGram = currentPrice * 1000;
        const tomanBalance = inventory?.tomanBalance || 0;

        if (tomanBalance < 100000) {
          await ctx.reply(
            `❌ *Insufficient Balance*\n\n` +
              `Your Toman balance: ${tomanBalance.toLocaleString()} Toman\n` +
              `Minimum required: 100,000 Toman`,
            { parse_mode: "Markdown" },
          );
          return;
        }

        // Calculate max grams you can buy (with 1% safety margin for fees)
        const safeBalance = Math.floor(tomanBalance * 0.99);
        const maxGrams = Math.floor((safeBalance / pricePerGram) * 1000) / 1000;

        // Store state for follow-up
        this.manualTradeState = {
          action: "buy",
          awaitingAmount: false,
          maxAmount: safeBalance, // Use safe balance instead of full balance
          currentPrice: currentPrice, // Keep API price format
        };

        await ctx.reply(
          `💰 *Buy Silver*\n\n` +
            `Current Price: ${pricePerGram.toLocaleString()} Toman/gram\n` +
            `Your Balance: ${tomanBalance.toLocaleString()} Toman\n` +
            `Max Purchase: ~${maxGrams.toFixed(3)} grams\n\n` +
            `How much do you want to buy?`,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  `💵 Buy Max (~${maxGrams.toFixed(3)}g)`,
                  "buy_max",
                ),
              ],
              [Markup.button.callback("✏️ Enter Custom Amount", "buy_custom")],
              [Markup.button.callback("❌ Cancel", "trade_cancel")],
            ]),
          },
        );
      } catch (error: any) {
        this.logger.error(`Buy handler error: ${error.message}`);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    // 📤 Sell Handler
    this.bot.hears("📤 Sell", async (ctx) => {
      if (!this.authService.isAuthenticated()) {
        await ctx.reply("❌ Not authenticated! Use 🔐 Auth first.");
        return;
      }

      try {
        await ctx.reply("📤 Checking your silver balance...");

        // Get current price and inventory
        const [priceData, inventory] = await Promise.all([
          this.noghreseaApi.getSilverPrice(),
          this.noghreseaApi.getInventory(),
        ]);

        if (!priceData || !priceData.price) {
          await ctx.reply("❌ Could not fetch current price. Try again.");
          return;
        }

        const currentPrice = parseFloat(priceData.price);
        const silverBalance = inventory?.silverBalance || 0;

        if (silverBalance <= 0) {
          await ctx.reply(
            `❌ *No Silver to Sell*\n\n` +
              `Your silver balance: ${silverBalance} grams`,
            { parse_mode: "Markdown" },
          );
          return;
        }

        const totalValue = Math.floor(silverBalance * currentPrice);

        // Store state for follow-up
        this.manualTradeState = {
          action: "sell",
          awaitingAmount: false,
          maxAmount: silverBalance,
          currentPrice: currentPrice,
        };

        await ctx.reply(
          `📤 *Sell Silver*\n\n` +
            `Current Price: ${currentPrice.toLocaleString()} Toman/gram\n` +
            `Your Silver: ${silverBalance} grams\n` +
            `Total Value: ~${totalValue.toLocaleString()} Toman\n\n` +
            `How much do you want to sell?`,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  `📤 Sell All (${silverBalance} grams)`,
                  "sell_all",
                ),
              ],
              [Markup.button.callback("✏️ Enter Custom Amount", "sell_custom")],
              [Markup.button.callback("❌ Cancel", "trade_cancel")],
            ]),
          },
        );
      } catch (error: any) {
        this.logger.error(`Sell handler error: ${error.message}`);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    // Buy Max callback
    this.bot.action("buy_max", async (ctx) => {
      if (!this.manualTradeState || this.manualTradeState.action !== "buy") {
        await ctx.answerCbQuery("Session expired. Try again.");
        return;
      }

      const { maxAmount, currentPrice } = this.manualTradeState;
      // currentPrice is API price (in thousands), real price = currentPrice * 1000
      const pricePerGram = currentPrice * 1000;
      const grams = Math.floor((maxAmount / pricePerGram) * 1000) / 1000;

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `⚠️ *Confirm Purchase*\n\n` +
          `Amount: ${maxAmount.toLocaleString()} Toman\n` +
          `Price: ${pricePerGram.toLocaleString()} Toman/gram\n` +
          `You will receive: ~${grams.toFixed(3)} grams\n\n` +
          `Are you sure?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback("✅ Confirm Buy", `confirm_buy_${grams}`),
              Markup.button.callback("❌ Cancel", "trade_cancel"),
            ],
          ]),
        },
      );
    });

    // Buy Custom callback
    this.bot.action("buy_custom", async (ctx) => {
      if (!this.manualTradeState || this.manualTradeState.action !== "buy") {
        await ctx.answerCbQuery("Session expired. Try again.");
        return;
      }

      this.manualTradeState.awaitingAmount = true;

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `✏️ *Enter Buy Amount*\n\n` +
          `Enter the amount in Toman (minimum 100,000):\n` +
          `Your max: ${this.manualTradeState.maxAmount.toLocaleString()} Toman\n\n` +
          `Example: \`500000\` for 500,000 Toman`,
        { parse_mode: "Markdown" },
      );
    });

    // Sell All callback
    this.bot.action("sell_all", async (ctx) => {
      if (!this.manualTradeState || this.manualTradeState.action !== "sell") {
        await ctx.answerCbQuery("Session expired. Try again.");
        return;
      }

      const { maxAmount, currentPrice } = this.manualTradeState;
      // currentPrice is API price (in thousands), real price = currentPrice * 1000
      const pricePerGram = currentPrice * 1000;
      const totalValue = Math.floor(maxAmount * pricePerGram);

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `⚠️ *Confirm Sale*\n\n` +
          `Selling: ${maxAmount.toFixed(3)} grams\n` +
          `Price: ${pricePerGram.toLocaleString()} Toman/gram\n` +
          `You will receive: ~${totalValue.toLocaleString()} Toman\n\n` +
          `Are you sure?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "✅ Confirm Sell",
                `confirm_sell_${maxAmount}`,
              ),
              Markup.button.callback("❌ Cancel", "trade_cancel"),
            ],
          ]),
        },
      );
    });

    // Sell Custom callback
    this.bot.action("sell_custom", async (ctx) => {
      if (!this.manualTradeState || this.manualTradeState.action !== "sell") {
        await ctx.answerCbQuery("Session expired. Try again.");
        return;
      }

      this.manualTradeState.awaitingAmount = true;

      // Calculate minimum grams for 100,000 Toman
      const pricePerGram = this.manualTradeState.currentPrice * 1000;
      const minGrams = (100000 / pricePerGram).toFixed(3);

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `✏️ *Enter Sell Amount*\n\n` +
          `Enter the amount in grams:\n` +
          `Your balance: ${this.manualTradeState.maxAmount.toFixed(3)} grams\n` +
          `Minimum: ${minGrams} grams (100,000 Toman)\n\n` +
          `Example: \`0.5\` for 0.5 grams`,
        { parse_mode: "Markdown" },
      );
    });

    // Trade Cancel callback
    this.bot.action("trade_cancel", async (ctx) => {
      this.manualTradeState = null;
      await ctx.answerCbQuery("Cancelled");
      await ctx.editMessageText("❌ Trade cancelled.");
    });

    // Confirm Buy callback
    this.bot.action(/confirm_buy_(.+)/, async (ctx) => {
      const grams = parseFloat(ctx.match[1]);

      if (!this.manualTradeState || this.manualTradeState.action !== "buy") {
        await ctx.answerCbQuery("Session expired. Try again.");
        return;
      }

      await ctx.answerCbQuery("Processing...");
      await ctx.editMessageText("⏳ Executing buy order...");

      try {
        // Volume in milligrams for API
        const volumeInMilligrams = Math.round(grams * 1000);

        const result = await this.noghreseaApi.createBuyOrder(
          this.manualTradeState.currentPrice,
          volumeInMilligrams,
        );

        this.manualTradeState = null;

        if (result && result.orderId) {
          await ctx.editMessageText(
            `✅ *Buy Order Executed!*\n\n` +
              `Bought: ${grams.toFixed(3)} grams\n` +
              `Order ID: ${result.orderId}`,
            { parse_mode: "Markdown" },
          );
        } else {
          await ctx.editMessageText(
            `❌ *Buy Order Failed*\n\n${result?.message || "Unknown error"}`,
            { parse_mode: "Markdown" },
          );
        }
      } catch (error: any) {
        this.manualTradeState = null;
        await ctx.editMessageText(`❌ Error: ${error.message}`);
      }
    });

    // Confirm Sell callback
    this.bot.action(/confirm_sell_(.+)/, async (ctx) => {
      const grams = parseFloat(ctx.match[1]);

      if (!this.manualTradeState || this.manualTradeState.action !== "sell") {
        await ctx.answerCbQuery("Session expired. Try again.");
        return;
      }

      await ctx.answerCbQuery("Processing...");
      await ctx.editMessageText("⏳ Executing sell order...");

      try {
        // Volume in milligrams for API
        const volumeInMilligrams = Math.round(grams * 1000);

        const result = await this.noghreseaApi.createSellOrder(
          this.manualTradeState.currentPrice,
          volumeInMilligrams,
        );

        const pricePerGram = this.manualTradeState.currentPrice * 1000;
        this.manualTradeState = null;

        if (result && result.orderId) {
          await ctx.editMessageText(
            `✅ *Sell Order Executed!*\n\n` +
              `Sold: ${grams.toFixed(3)} grams\n` +
              `Price: ${pricePerGram.toLocaleString()} Toman/gram\n\n` +
              `Order ID: ${result.orderId}`,
            { parse_mode: "Markdown" },
          );
        } else {
          await ctx.editMessageText(
            `❌ *Sell Order Failed*\n\n${result?.message || "Unknown error"}`,
            { parse_mode: "Markdown" },
          );
        }
      } catch (error: any) {
        this.manualTradeState = null;
        await ctx.editMessageText(`❌ Error: ${error.message}`);
      }
    });

    // Daily Report
    this.bot.hears("📈 Daily Report", async (ctx) => {
      await ctx.reply("📊 Generating daily report...");

      if (!this.dailyAnalysis) {
        await ctx.reply("❌ Daily analysis service not available.");
        return;
      }

      try {
        // Generate or get today's summary
        const summary = await this.dailyAnalysis.generateDailySummary();

        if (!summary) {
          await ctx.reply(
            "⚠️ Not enough data for daily report. Keep collecting data!",
          );
          return;
        }

        await ctx.reply(summary.notes, { parse_mode: "Markdown" });
      } catch (error: any) {
        await ctx.reply(`❌ Error generating report: ${error.message}`);
      }
    });

    // GPT Data - Get data formatted for GPT analysis
    this.bot.hears("🤖 GPT Data", async (ctx) => {
      await ctx.reply("🤖 Preparing GPT-ready data...");

      if (!this.dailyAnalysis) {
        await ctx.reply("❌ Daily analysis service not available.");
        return;
      }

      try {
        const gptData = await this.dailyAnalysis.getSummariesForGpt(7);

        // Split into chunks if too long (Telegram limit is 4096 chars)
        if (gptData.length > 4000) {
          const chunks = this.splitMessage(gptData, 4000);
          await ctx.reply(
            `📄 *GPT Analysis Data* (${chunks.length} parts)\n\nCopy and paste this into GPT-5.2:`,
            { parse_mode: "Markdown" },
          );

          for (let i = 0; i < chunks.length; i++) {
            await ctx.reply(`\`\`\`json\n${chunks[i]}\n\`\`\``, {
              parse_mode: "Markdown",
            });
          }
        } else {
          await ctx.reply(
            "📄 *GPT Analysis Data*\n\nCopy and paste this into GPT-5.2:",
            { parse_mode: "Markdown" },
          );
          await ctx.reply(`\`\`\`json\n${gptData}\n\`\`\``, {
            parse_mode: "Markdown",
          });
        }
      } catch (error: any) {
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    // Week summary command
    this.bot.command("week", async (ctx) => {
      if (!this.dailyAnalysis) {
        await ctx.reply("❌ Daily analysis service not available.");
        return;
      }

      try {
        const summaries = await this.dailyAnalysis.getRecentSummaries(7);

        if (summaries.length === 0) {
          await ctx.reply("No weekly data available yet.");
          return;
        }

        let message = "📊 *Weekly Summary*\n━━━━━━━━━━━━━━━━\n\n";

        summaries.forEach((s) => {
          const changeEmoji =
            s.priceChangePercent > 0
              ? "📈"
              : s.priceChangePercent < 0
                ? "📉"
                : "➡️";
          message += `*${s.date}* ${changeEmoji}\n`;
          message += `  Price: ${s.openPrice} → ${s.closePrice} (${s.priceChangePercent > 0 ? "+" : ""}${Number(s.priceChangePercent).toFixed(2)}%)\n`;
          message += `  Sentiment: ${s.sentiment}\n`;
          if (s.manipulationSignals > 0) {
            message += `  ⚠️ Manipulation signals: ${s.manipulationSignals}\n`;
          }
          message += "\n";
        });

        await ctx.reply(message, { parse_mode: "Markdown" });
      } catch (error: any) {
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    // Setup inline button handlers
    this.setupRefreshHandler();
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf("\n", maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint);
    }

    return chunks;
  }

  private async sendStatusReport(ctx: any) {
    try {
      // Get current prices
      let prices: any = null;
      if (this.priceFetcher) {
        prices = this.priceFetcher.getLastPrices();
      }

      // Get wallet state
      let wallet = { tomanBalance: 0, silverBalance: 0 };
      if (this.tradeExecutor) {
        try {
          wallet = await this.tradeExecutor.getWalletState();
        } catch (e) {
          // Wallet fetch might fail if not authenticated
        }
      }

      // Get trading status
      const tradingEnabled = this.tradeExecutor?.isTradingEnabled() ?? false;
      const tradingStatus = this.tradeExecutor?.getTradingStatus();

      // Build status message
      let message = `📊 *Silver Predictor Status*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (prices?.noghresea) {
        message += `💰 *Noghresea Price:* ${prices.noghresea.price} Toman\n`;
        message += `📈 *24h Change:* ${prices.noghresea.change24h || "N/A"}%\n\n`;
      } else {
        message += `💰 *Noghresea Price:* Loading...\n\n`;
      }

      message += `🌍 *Market Data:*\n`;
      message += `├── Silver Ounce: $${prices?.silverOunce?.toFixed(2) || "N/A"}\n`;
      message += `├── Gold Ounce: $${prices?.goldOunce?.toFixed(2) || "N/A"}\n`;
      message += `└── USDT/Toman: ${prices?.usdtToman?.toLocaleString() || "N/A"}\n\n`;

      message += `💼 *Wallet:*\n`;
      message += `├── Toman: ${wallet.tomanBalance.toLocaleString()}\n`;
      message += `└── Silver: ${wallet.silverBalance.toFixed(2)}g\n\n`;

      message += `🔐 *Auth:* ${this.authService.isAuthenticated() ? "✅ Authenticated" : "❌ Not authenticated"}\n`;
      message += `⚡ *Trading:* ${tradingEnabled ? "✅ ENABLED" : "❌ DISABLED"}\n`;

      if (tradingStatus?.pausedUntil) {
        message += `⏸️ *Paused until:* ${tradingStatus.pausedUntil.toLocaleTimeString()}\n`;
      }

      message += `\n━━━━━━━━━━━━━━━━━━━━━━━━`;

      await ctx.reply(message, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("🔄 Refresh", "refresh_status"),
            Markup.button.callback(
              tradingEnabled ? "⏸️ Pause 30m" : "▶️ Enable",
              tradingEnabled ? "pause_30" : "enable_trading",
            ),
          ],
        ]),
      });
    } catch (error: any) {
      await ctx.reply(`❌ Error loading status: ${error.message}`);
    }
  }

  // Refresh status action
  private setupRefreshHandler() {
    this.bot.action("refresh_status", async (ctx) => {
      await ctx.answerCbQuery("Refreshing...");
      await this.sendStatusReport(ctx);
    });

    this.bot.action("enable_trading", async (ctx) => {
      if (this.tradeExecutor) {
        await this.tradeExecutor.enableTrading();
        await ctx.answerCbQuery("Trading enabled!");
        await this.sendStatusReport(ctx);
      } else {
        await ctx.answerCbQuery("Trade executor not ready");
      }
    });

    this.bot.action("pause_30", async (ctx) => {
      if (this.tradeExecutor) {
        await this.tradeExecutor.pauseTrading(30);
        await ctx.answerCbQuery("Trading paused for 30 minutes");
        await this.sendStatusReport(ctx);
      } else {
        await ctx.answerCbQuery("Trade executor not ready");
      }
    });
    // Note: send_otp action is already registered in setupHandlers()
  }

  async sendFullStatus(
    prices: AllPrices,
    analysis: PatternAnalysis,
    wallet: { tomanBalance: number; silverBalance: number },
    tradingEnabled: boolean,
  ) {
    if (!this.chatId || !this.bot) return;

    // Escape special Markdown characters in pattern types
    const escapeMarkdown = (text: string) =>
      text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");

    const patternsText =
      analysis.patterns.length > 0
        ? analysis.patterns
            .map(
              (p) => `• ${escapeMarkdown(p.type)}: ${p.confidence.toFixed(0)}%`,
            )
            .join("\n")
        : "• No significant patterns";

    const message = `📊 *Silver Predictor Status*
━━━━━━━━━━━━━━━━━━━━━━━━

💰 *Noghresea Price:* ${prices.noghresea?.price || "N/A"} Toman
📈 *24h Change:* ${prices.noghresea?.change24h || "N/A"}%

🌍 *Market Data:*
├── Silver Ounce: $${prices.silverOunce?.toFixed(2) || "N/A"}
├── Gold Ounce: $${prices.goldOunce?.toFixed(2) || "N/A"}
└── USDT/Toman: ${prices.usdtToman?.toLocaleString() || "N/A"}

💼 *Wallet:*
├── Toman: ${wallet.tomanBalance.toLocaleString()}
└── Silver: ${wallet.silverBalance.toFixed(2)}g

🎯 *AI Analysis:*
${patternsText}
├── Suggestion: ${analysis.suggestion}
└── Confidence: ${analysis.overallConfidence.toFixed(1)}%

⚡ *Trading:* ${tradingEnabled ? "✅ ENABLED" : "❌ DISABLED"}
━━━━━━━━━━━━━━━━━━━━━━━━`;

    await this.bot.telegram.sendMessage(this.chatId, message, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("🔄 Refresh", "refresh_status"),
          Markup.button.callback(
            tradingEnabled ? "⏸️ Pause 30m" : "▶️ Resume",
            tradingEnabled ? "pause_30" : "enable_trading",
          ),
        ],
      ]),
    });
  }

  async sendAuthRequired() {
    if (!this.chatId || !this.bot) return;

    await this.bot.telegram.sendMessage(
      this.chatId,
      "🔒 *Authentication Required*\n\nYour session has expired. Please authenticate to continue trading.",
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          Markup.button.callback("📱 Send OTP", "send_otp"),
        ]),
      },
    );
  }

  async sendTradeExecuted(trade: TradeHistory, decision: AiDecision) {
    if (!this.chatId || !this.bot) return;

    const emoji = trade.action === "BUY" ? "🟢" : "🔴";
    const message = `${emoji} *Trade Executed*

*Action:* ${trade.action}
*Volume:* ${trade.volume}g
*Price:* ${trade.price} Toman
*Total:* ${Number(trade.totalValue).toLocaleString()} Toman
*Confidence:* ${trade.aiConfidence}%

📝 *Reasoning:*
${decision.reasoning}

🔮 *Expected:*
${decision.expectedOutcome}`;

    await this.bot.telegram.sendMessage(this.chatId, message, {
      parse_mode: "Markdown",
    });
  }

  async sendApproachingThreshold(decision: AiDecision) {
    if (!this.chatId || !this.bot) return;

    const message = `⚠️ *Approaching Trade Threshold*

*Suggested Action:* ${decision.action}
*Confidence:* ${decision.confidence.toFixed(1)}% (threshold: 70%)

📝 *Reasoning:*
${decision.reasoning}

_Trade will execute if confidence reaches 70%_`;

    await this.bot.telegram.sendMessage(this.chatId, message, {
      parse_mode: "Markdown",
    });
  }

  async sendTradeError(decision: AiDecision, error: string) {
    if (!this.chatId || !this.bot) return;

    await this.bot.telegram.sendMessage(
      this.chatId,
      `❌ *Trade Failed*\n\nAction: ${decision.action}\nError: ${error}`,
      { parse_mode: "Markdown" },
    );
  }

  async sendPatternAlert(analysis: PatternAnalysis, prices: AllPrices) {
    if (!this.chatId || !this.bot) return;

    const patterns = analysis.patterns
      .map((p) => `• *${p.type}*: ${p.description}`)
      .join("\n");

    const message = `🔔 *Pattern Detected*

${patterns}

*Confidence:* ${analysis.overallConfidence.toFixed(1)}%
*Suggestion:* ${analysis.suggestion}
*Price:* ${prices.noghresea?.price || "N/A"} Toman`;

    await this.bot.telegram.sendMessage(this.chatId, message, {
      parse_mode: "Markdown",
    });
  }

  async sendMessage(message: string) {
    if (!this.chatId || !this.bot) return;

    try {
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: "Markdown",
      });
    } catch (error: any) {
      this.logger.error(`Failed to send message: ${error.message}`);
    }
  }

  async sendDailySummary(summary: any) {
    if (!this.chatId || !this.bot) return;

    try {
      const message = `📊 *Daily Summary - ${summary.date}*\n\n${summary.notes}`;

      // Split if too long
      if (message.length > 4000) {
        const chunks = this.splitMessage(message, 4000);
        for (const chunk of chunks) {
          await this.bot.telegram.sendMessage(this.chatId, chunk, {
            parse_mode: "Markdown",
          });
        }
      } else {
        await this.bot.telegram.sendMessage(this.chatId, message, {
          parse_mode: "Markdown",
        });
      }
    } catch (error: any) {
      this.logger.error(`Failed to send daily summary: ${error.message}`);
    }
  }

  // Handle Buy command from middleware
  private async handleBuyCommand(ctx: any) {
    if (!this.authService.isAuthenticated()) {
      await ctx.reply("❌ Not authenticated! Use Auth button first.");
      return;
    }

    try {
      await ctx.reply("💰 Checking your balance...");

      const [priceData, inventory] = await Promise.all([
        this.noghreseaApi.getSilverPrice(),
        this.noghreseaApi.getInventory(),
      ]);

      if (!priceData || !priceData.price) {
        await ctx.reply("❌ Could not fetch current price. Try again.");
        return;
      }

      // API price is in thousands (e.g., 706 = 706,000 Toman/gram)
      const apiPrice = parseFloat(priceData.price);
      const pricePerGram = apiPrice * 1000; // Real price in Toman
      const tomanBalance = inventory?.tomanBalance || 0;

      if (tomanBalance < 100000) {
        await ctx.reply(
          `❌ *Insufficient Balance*\n\n` +
            `Your Toman balance: ${tomanBalance.toLocaleString()} Toman\n` +
            `Minimum required: 100,000 Toman`,
          { parse_mode: "Markdown" },
        );
        return;
      }

      // Calculate max grams (Toman / pricePerGram)
      const maxGrams = Math.floor((tomanBalance / pricePerGram) * 1000) / 1000;

      this.manualTradeState = {
        action: "buy",
        awaitingAmount: false,
        maxAmount: tomanBalance,
        currentPrice: apiPrice, // Store API price for order
      };

      await ctx.reply(
        `💰 *Buy Silver*\n\n` +
          `Current Price: ${pricePerGram.toLocaleString()} Toman/gram\n` +
          `Your Balance: ${tomanBalance.toLocaleString()} Toman\n` +
          `Max Purchase: ~${maxGrams} grams\n\n` +
          `How much do you want to buy?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `Buy Max (${tomanBalance.toLocaleString()} Toman)`,
                "buy_max",
              ),
            ],
            [Markup.button.callback("Enter Custom Amount", "buy_custom")],
            [Markup.button.callback("Cancel", "trade_cancel")],
          ]),
        },
      );
    } catch (error: any) {
      this.logger.error(`Buy handler error: ${error.message}`);
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  // Handle Sell command from middleware
  private async handleSellCommand(ctx: any) {
    if (!this.authService.isAuthenticated()) {
      await ctx.reply("❌ Not authenticated! Use Auth button first.");
      return;
    }

    try {
      await ctx.reply("📤 Checking your silver balance...");

      const [priceData, inventory] = await Promise.all([
        this.noghreseaApi.getSilverPrice(),
        this.noghreseaApi.getInventory(),
      ]);

      if (!priceData || !priceData.price) {
        await ctx.reply("❌ Could not fetch current price. Try again.");
        return;
      }

      // API price is in thousands (e.g., 706 = 706,000 Toman/gram)
      const apiPrice = parseFloat(priceData.price);
      const pricePerGram = apiPrice * 1000; // Real price in Toman
      const silverBalance = inventory?.silverBalance || 0;

      // Calculate minimum grams needed for 100,000 Toman minimum
      const minGrams = Math.ceil((100000 / pricePerGram) * 1000) / 1000;

      if (silverBalance <= 0) {
        await ctx.reply(
          `❌ *No Silver to Sell*\n\n` +
            `Your silver balance: ${silverBalance} grams`,
          { parse_mode: "Markdown" },
        );
        return;
      }

      if (silverBalance < minGrams) {
        await ctx.reply(
          `❌ *Insufficient Silver*\n\n` +
            `Your silver: ${silverBalance.toFixed(3)} grams\n` +
            `Minimum required: ${minGrams.toFixed(3)} grams (100,000 Toman worth)`,
          { parse_mode: "Markdown" },
        );
        return;
      }

      const totalValue = Math.floor(silverBalance * pricePerGram);

      this.manualTradeState = {
        action: "sell",
        awaitingAmount: false,
        maxAmount: silverBalance,
        currentPrice: apiPrice, // Store API price for order
      };

      await ctx.reply(
        `📤 *Sell Silver*\n\n` +
          `Current Price: ${pricePerGram.toLocaleString()} Toman/gram\n` +
          `Your Silver: ${silverBalance.toFixed(3)} grams\n` +
          `Total Value: ~${totalValue.toLocaleString()} Toman\n` +
          `Minimum Sell: ${minGrams.toFixed(3)} grams (100,000 Toman)\n\n` +
          `How much do you want to sell?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `Sell All (${silverBalance.toFixed(3)} grams)`,
                "sell_all",
              ),
            ],
            [Markup.button.callback("Enter Custom Amount", "sell_custom")],
            [Markup.button.callback("Cancel", "trade_cancel")],
          ]),
        },
      );
    } catch (error: any) {
      this.logger.error(`Sell handler error: ${error.message}`);
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }
}
