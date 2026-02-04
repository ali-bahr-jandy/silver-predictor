import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval, Cron } from "@nestjs/schedule";
import { PriceFetcherService } from "../price-fetcher/price-fetcher.service";
import { PatternAnalyzerService } from "../pattern-analyzer/pattern-analyzer.service";
import { AiDecisionService } from "../ai-decision/ai-decision.service";
import { TradeExecutorService } from "../trade-executor/trade-executor.service";
import { TelegramBotService } from "../telegram-bot/telegram-bot.service";
import { NoghreseaAuthService } from "../noghresea/noghresea-auth.service";
import { DailyAnalysisService } from "../analysis/daily-analysis.service";
import { TransactionService } from "../trade-executor/transaction.service";

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunning = false;
  private lastStatusSent = 0;
  private cycleCount = 0;
  private lastAiCallTime = 0; // Track last AI call for cooldown
  private readonly AI_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cooldown between AI calls

  constructor(
    private configService: ConfigService,
    private priceFetcher: PriceFetcherService,
    private patternAnalyzer: PatternAnalyzerService,
    private aiDecision: AiDecisionService,
    private tradeExecutor: TradeExecutorService,
    private telegramBot: TelegramBotService,
    private authService: NoghreseaAuthService,
    private dailyAnalysis: DailyAnalysisService,
    private transactionService: TransactionService,
  ) {}

  onModuleInit() {
    // Connect telegram bot to trade executor and daily analysis
    this.telegramBot.setTradeExecutor(this.tradeExecutor);
    this.telegramBot.setDailyAnalysis(this.dailyAnalysis);
    this.telegramBot.setTransactionService(this.transactionService);
    this.telegramBot.setPriceFetcher(this.priceFetcher);
    this.telegramBot.setPatternAnalyzer(this.patternAnalyzer);
    this.logger.log("🚀 Scheduler initialized");

    // Start first cycle immediately
    setTimeout(() => this.runCycle(), 5000);
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
      const isAuthed = this.authService.isAuthenticated();
      this.logger.log(`🔐 Auth check: ${isAuthed}`);
      if (!isAuthed) {
        if (this.cycleCount % 30 === 1) {
          // Every 5 minutes
          await this.telegramBot.sendAuthRequired();
        }
        this.isRunning = false;
        return;
      }

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

      // Step 4: Get wallet state
      const wallet = await this.tradeExecutor.getWalletState();

      // Step 5: Log cycle info
      this.logger.log(
        `Cycle ${this.cycleCount}: Price=${prices.noghresea.price?.toFixed(2)}, ` +
          `Patterns=${analysis.patterns.length}, Confidence=${analysis.overallConfidence.toFixed(1)}%, Suggestion=${analysis.suggestion}`,
      );

      // Step 6: Smart AI calling to reduce costs
      // Only call AI when:
      // 1. Pattern analyzer suggests BUY or SELL (not HOLD)
      // 2. Confidence is high enough (>= 70%)
      // 3. Cooldown period has passed (2 minutes)
      const shouldCallAi =
        analysis.detected &&
        analysis.overallConfidence >= 70 &&
        analysis.suggestion !== "HOLD" && // SKIP AI for HOLD - saves money!
        Date.now() - this.lastAiCallTime >= this.AI_COOLDOWN_MS;

      if (shouldCallAi) {
        this.logger.log(
          `📊 Pattern detected: ${analysis.patterns.map((p) => p.type).join(", ")} → ${analysis.suggestion}`,
        );

        // Send pattern alert (not too frequently)
        if (this.shouldSendAlert()) {
          await this.telegramBot.sendPatternAlert(analysis, prices);
        }

        // Check for DROP_BOTTOM with very high confidence - execute directly without AI!
        const hasDropBottom = analysis.patterns.some(
          (p) => p.type === "DROP_BOTTOM" && p.confidence >= 85,
        );

        if (hasDropBottom) {
          // Direct execution for high-confidence DROP_BOTTOM - no AI needed!
          this.logger.log(
            `🎯 HIGH CONFIDENCE DROP_BOTTOM - Executing BUY directly (no AI call)`,
          );
          const directDecision = {
            action: "BUY" as const,
            confidence: analysis.overallConfidence,
            volumePercent: 3,
            reasoning: `Pattern analyzer: DROP_BOTTOM with ${analysis.overallConfidence.toFixed(1)}% confidence`,
            expectedOutcome: "Price recovery expected after manipulation drop",
          };
          await this.tradeExecutor.executeTrade(
            directDecision,
            Number(prices.noghresea.price),
          );
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

          // Step 7: Execute trade if conditions met
          if (decision.action !== "HOLD") {
            await this.tradeExecutor.executeTrade(
              decision,
              Number(prices.noghresea.price),
            );
          }
        }
      } else if (
        analysis.detected &&
        analysis.overallConfidence >= 70 &&
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
    } catch (error) {
      this.logger.error(`Cycle error: ${error.message}`, error.stack);
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
