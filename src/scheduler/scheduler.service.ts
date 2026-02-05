import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval, Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PriceFetcherService } from "../price-fetcher/price-fetcher.service";
import { PatternAnalyzerService } from "../pattern-analyzer/pattern-analyzer.service";
import { AiDecisionService } from "../ai-decision/ai-decision.service";
import { TradeExecutorService } from "../trade-executor/trade-executor.service";
import { TelegramBotService } from "../telegram-bot/telegram-bot.service";
import { NoghreseaAuthService } from "../noghresea/noghresea-auth.service";
import { NoghreseaApiService } from "../noghresea/noghresea-api.service";
import { DailyAnalysisService } from "../analysis/daily-analysis.service";
import { MultiFactorAnalysisService } from "../analysis/multi-factor-analysis.service";
import { AiPredictionService } from "../analysis/ai-prediction.service";
import { TransactionService } from "../trade-executor/transaction.service";
import { UserTradingService } from "../trade-executor/user-trading.service";
import { AuthState } from "../database/entities/auth-state.entity";
import { TradeSource } from "../database/entities/user-trade-history.entity";

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunning = false;
  private lastStatusSent = 0;
  private cycleCount = 0;
  private lastAiCallTime = 0; // Track last AI call for cooldown
  private readonly AI_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cooldown between AI calls
  private primaryChatId: string | null = null; // Primary user's chat ID

  constructor(
    private configService: ConfigService,
    private priceFetcher: PriceFetcherService,
    private patternAnalyzer: PatternAnalyzerService,
    private aiDecision: AiDecisionService,
    private tradeExecutor: TradeExecutorService,
    private telegramBot: TelegramBotService,
    private authService: NoghreseaAuthService,
    private noghreseaApi: NoghreseaApiService,
    private dailyAnalysis: DailyAnalysisService,
    private multiFactorAnalysis: MultiFactorAnalysisService,
    private aiPredictionService: AiPredictionService,
    private transactionService: TransactionService,
    private userTradingService: UserTradingService,
    @InjectRepository(AuthState)
    private authStateRepo: Repository<AuthState>,
  ) {}

  async onModuleInit() {
    // Connect telegram bot to trade executor and daily analysis
    this.telegramBot.setTradeExecutor(this.tradeExecutor);
    this.telegramBot.setDailyAnalysis(this.dailyAnalysis);
    this.telegramBot.setTransactionService(this.transactionService);
    this.telegramBot.setPriceFetcher(this.priceFetcher);
    this.telegramBot.setPatternAnalyzer(this.patternAnalyzer);
    this.telegramBot.setUserTradingService(this.userTradingService);

    // Load primary chat ID from config or database
    await this.loadPrimaryChatId();
    this.logger.log("🚀 Scheduler initialized");

    // Start first cycle immediately
    setTimeout(() => this.runCycle(), 5000);
  }

  private async loadPrimaryChatId() {
    // First try to get from config
    this.primaryChatId = this.configService.get("TELEGRAM_CHAT_ID") || null;

    // If not in config, try to get the first valid authenticated user from DB
    if (!this.primaryChatId) {
      const auth = await this.authStateRepo.findOne({
        where: { isValid: true },
        order: { updatedAt: "DESC" },
      });

      if (auth && auth.telegramChatId) {
        this.primaryChatId = auth.telegramChatId;
        this.logger.log(
          `📱 Using primary chat ID from database: ${this.primaryChatId}`,
        );
        // Load auth state for this user
        await this.authService.loadUserAuth(this.primaryChatId);
      } else {
        this.logger.warn(
          `⚠️ No authenticated user found. Please authenticate via Telegram.`,
        );
      }
    } else {
      this.logger.log(
        `📱 Using primary chat ID from config: ${this.primaryChatId}`,
      );
      // Load auth state for this user
      await this.authService.loadUserAuth(this.primaryChatId);
    }
  }

  // Daily summary at midnight Iran time (20:30 UTC)
  @Cron("0 30 20 * * *")
  async generateDailySummary() {
    this.logger.log("📊 Generating end-of-day summary...");
    try {
      const summary = await this.dailyAnalysis.generateDailySummary();
      if (summary) {
        await this.sendDailySummaryToTelegram(summary);
      }
    } catch (error: any) {
      this.logger.error(`Daily summary error: ${error.message}`);
    }
  }

  private async sendDailySummaryToTelegram(summary: any) {
    // This will be sent via telegram bot
    const message = `📊 *End of Day Summary - ${summary.date}*\n\n${summary.notes}`;
    await this.telegramBot.sendMessage(message);
  }

  @Interval(10000) // Every 10 seconds
  async scheduledCycle() {
    // Skip logging when disabled to reduce noise
    if (this.tradeExecutor.isTradingEnabled()) {
      this.logger.log("⏰ Interval triggered");
    }
    await this.runCycle();
  }

  private async runCycle() {
    // Check if trading/monitoring is enabled FIRST
    if (!this.tradeExecutor.isTradingEnabled()) {
      // Only log occasionally to avoid spam
      if (this.cycleCount % 30 === 0) {
        this.logger.log("⏸️ Bot is STOPPED - skipping all monitoring");
      }
      this.cycleCount++;
      return;
    }

    this.logger.log(`🔄 Running cycle, isRunning=${this.isRunning}`);
    if (this.isRunning) {
      this.logger.debug("Previous cycle still running, skipping");
      return;
    }

    this.isRunning = true;
    this.cycleCount++;

    try {
      // Step 1: Check authentication
      // Reload primary chat ID if not set
      if (!this.primaryChatId) {
        await this.loadPrimaryChatId();
      }

      // If still no primary chat ID, can't proceed
      if (!this.primaryChatId) {
        this.logger.log(`🔐 Auth check: false (chatId: none)`);
        if (this.cycleCount % 30 === 1) {
          // Every 5 minutes
          await this.telegramBot.sendAuthRequired();
        }
        this.isRunning = false;
        return;
      }

      // At this point we know primaryChatId is not null
      const chatId = this.primaryChatId;

      const isAuthed = this.authService.isAuthenticated(chatId);
      this.logger.log(`🔐 Auth check: ${isAuthed} (chatId: ${chatId})`);
      if (!isAuthed) {
        if (this.cycleCount % 30 === 1) {
          // Every 5 minutes
          await this.telegramBot.sendAuthRequired();
        }
        this.isRunning = false;
        return;
      }

      // Set active chat ID for API requests
      this.noghreseaApi.setActiveChatId(chatId);

      // Step 2: Fetch all prices
      this.logger.log("📊 Fetching prices...");
      const prices = await this.priceFetcher.fetchAllPrices();

      if (!prices.noghresea) {
        this.logger.warn("Failed to fetch Noghresea price");
        this.isRunning = false;
        return;
      }

      // Step 3: Analyze patterns
      const analysis = await this.patternAnalyzer.analyze(prices);

      // Step 3.5: Multi-factor analysis (Gold, Silver, USDT correlation + manipulation detection)
      const multiFactorResult = await this.multiFactorAnalysis.analyze(prices);

      // Boost confidence if multi-factor analysis supports the pattern suggestion
      let adjustedConfidence = analysis.overallConfidence;
      if (multiFactorResult.confidenceBoost !== 0) {
        adjustedConfidence += multiFactorResult.confidenceBoost;
        this.logger.log(
          `🔬 Multi-factor: ${multiFactorResult.marketDirection}, ` +
            `Manipulation=${multiFactorResult.isManipulated ? multiFactorResult.manipulationType : "NONE"}, ` +
            `Score=${multiFactorResult.overallScore.toFixed(1)}, Confidence boost: ${multiFactorResult.confidenceBoost > 0 ? "+" : ""}${multiFactorResult.confidenceBoost}`,
        );
      }

      // Step 4: Get wallet state
      const wallet = await this.tradeExecutor.getWalletState();

      // Step 5: Log cycle info with enhanced analysis
      this.logger.log(
        `Cycle ${this.cycleCount}: Price=${prices.noghresea.price?.toFixed(2)}, ` +
          `Patterns=${analysis.patterns.length}, Confidence=${adjustedConfidence.toFixed(1)}% (base: ${analysis.overallConfidence.toFixed(1)}%), Suggestion=${analysis.suggestion}`,
      );

      // Step 6: Smart AI calling with enhanced decision making
      // Only call AI when:
      // 1. Pattern analyzer suggests BUY or SELL (not HOLD)
      // 2. Confidence is high enough (>= threshold from user settings or default 70%)
      // 3. Cooldown period has passed (2 minutes)
      // 4. Multi-factor analysis supports the decision OR manipulation detected
      const userSettings =
        await this.userTradingService.getOrCreateSettings(chatId);
      const minConfidence = userSettings.minConfidence || 70;

      const shouldCallAi =
        analysis.detected &&
        adjustedConfidence >= minConfidence &&
        analysis.suggestion !== "HOLD" &&
        Date.now() - this.lastAiCallTime >= this.AI_COOLDOWN_MS;

      if (shouldCallAi) {
        this.logger.log(
          `📊 Pattern detected: ${analysis.patterns.map((p) => p.type).join(", ")} → ${analysis.suggestion}`,
        );

        // Send pattern alert (not too frequently)
        if (this.shouldSendAlert()) {
          await this.telegramBot.sendPatternAlert(analysis, prices);
        }

        // Check for DROP_BOTTOM with very high confidence AND manipulation detected
        const hasDropBottom = analysis.patterns.some(
          (p) => p.type === "DROP_BOTTOM" && p.confidence >= 85,
        );
        const isFakeDrop =
          multiFactorResult.isManipulated &&
          multiFactorResult.manipulationType === "FAKE_DROP";

        if (hasDropBottom && isFakeDrop) {
          // Direct execution for high-confidence DROP_BOTTOM with manipulation confirmed
          this.logger.log(
            `🎯 DROP_BOTTOM + MANIPULATION - Executing BUY directly`,
          );
          const directDecision = {
            action: "BUY" as const,
            confidence: adjustedConfidence,
            volumePercent: 3,
            reasoning: `DROP_BOTTOM (${analysis.overallConfidence.toFixed(1)}%) + Manipulation confirmed`,
            expectedOutcome: "Price recovery expected after manipulation drop",
          };

          // Save the prediction
          await this.aiPredictionService.savePrediction(
            directDecision,
            prices,
            analysis,
            multiFactorResult,
          );

          // Calculate and execute trade
          const tradeCalc = await this.userTradingService.calculateTradeAmount(
            chatId,
            "BUY",
            Number(prices.noghresea.price),
            wallet.silverBalance,
            wallet.tomanBalance,
          );

          if (tradeCalc.canTrade && userSettings.autoTradingEnabled) {
            // Auto-start session for AI trading if needed
            const currentPrice = Number(prices.noghresea.price);
            await this.userTradingService.ensureSessionForAiTrade(
              chatId,
              "BUY",
              tradeCalc.silverAmount,
              tradeCalc.silverAmount * currentPrice,
              currentPrice,
            );

            // Check position validity (can't BUY if already holding silver from previous BUY)
            const positionValid =
              await this.userTradingService.isActionValidForPosition(
                chatId,
                "BUY",
              );
            if (!positionValid) {
              this.logger.log(
                `⚠️ Position invalid for BUY - already holding silver, waiting for SELL signal`,
              );
            } else {
              await this.tradeExecutor.executeTrade(
                directDecision,
                currentPrice,
              );

              // Record in user trade history
              await this.userTradingService.recordTrade(
                chatId,
                this.authService.getPhoneNumber(chatId),
                "BUY",
                tradeCalc.silverAmount,
                currentPrice,
                TradeSource.AI,
                {
                  aiConfidence: adjustedConfidence,
                  aiReasoning: directDecision.reasoning,
                  silverOunce: prices.silverOunce ?? undefined,
                  goldOunce: prices.goldOunce ?? undefined,
                  usdtToman: prices.usdtToman ?? undefined,
                },
              );
            }
          }
        } else {
          // Get AI decision for other patterns
          this.lastAiCallTime = Date.now();
          const decision = await this.aiDecision.getDecision(
            prices,
            analysis,
            wallet,
          );

          this.logger.log(
            `🤖 AI Decision: ${decision.action} (${decision.confidence.toFixed(1)}%) - ${decision.reasoning}`,
          );

          // Save AI prediction for historical tracking (30 days)
          await this.aiPredictionService.savePrediction(
            decision,
            prices,
            analysis,
            multiFactorResult,
          );

          // Step 7: Execute trade if conditions met
          if (decision.action !== "HOLD" && userSettings.autoTradingEnabled) {
            const tradeCalc =
              await this.userTradingService.calculateTradeAmount(
                chatId,
                decision.action,
                Number(prices.noghresea.price),
                wallet.silverBalance,
                wallet.tomanBalance,
              );

            if (tradeCalc.canTrade) {
              // Auto-start session for AI trading if needed
              const currentPrice = Number(prices.noghresea.price);
              const tomanAmount =
                decision.action === "BUY"
                  ? tradeCalc.silverAmount * currentPrice
                  : tradeCalc.silverAmount * currentPrice;
              await this.userTradingService.ensureSessionForAiTrade(
                chatId,
                decision.action,
                tradeCalc.silverAmount,
                tomanAmount,
                currentPrice,
              );

              // Check position validity (can't BUY if already holding, can't SELL if not holding)
              const positionValid =
                await this.userTradingService.isActionValidForPosition(
                  chatId,
                  decision.action,
                );
              if (!positionValid) {
                this.logger.log(
                  `⚠️ Position invalid for ${decision.action} - waiting for opposite signal`,
                );
              } else {
                await this.tradeExecutor.executeTrade(decision, currentPrice);

                // Record in user trade history
                await this.userTradingService.recordTrade(
                  chatId,
                  this.authService.getPhoneNumber(chatId),
                  decision.action,
                  tradeCalc.silverAmount,
                  currentPrice,
                  TradeSource.AI,
                  {
                    aiConfidence: decision.confidence,
                    aiReasoning: decision.reasoning,
                    silverOunce: prices.silverOunce ?? undefined,
                    goldOunce: prices.goldOunce ?? undefined,
                    usdtToman: prices.usdtToman ?? undefined,
                  },
                );
              }
            }
          }
        }
      } else if (
        analysis.detected &&
        adjustedConfidence >= minConfidence &&
        analysis.suggestion === "HOLD"
      ) {
        // Log that we're skipping AI call to save money
        this.logger.debug(
          `💰 Skipping AI call - Pattern suggests HOLD (saving API costs)`,
        );
      }

      // Step 8: Send periodic status (every 5 minutes)
      const now = Date.now();
      if (now - this.lastStatusSent > 5 * 60 * 1000) {
        await this.telegramBot.sendFullStatus(
          prices,
          analysis,
          wallet,
          this.tradeExecutor.isTradingEnabled(),
        );
        this.lastStatusSent = now;
      }
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Cycle error: ${err.message}`, err.stack);
    } finally {
      this.isRunning = false;
    }
  }

  private lastAlertSent = 0;
  private shouldSendAlert(): boolean {
    const now = Date.now();
    if (now - this.lastAlertSent > 60 * 1000) {
      // At most every minute
      this.lastAlertSent = now;
      return true;
    }
    return false;
  }
}
