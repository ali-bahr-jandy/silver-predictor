import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThan } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { UserTradingSettings } from "../database/entities/user-trading-settings.entity";
import {
  UserTradeHistory,
  TradeSource,
  TradeStatus,
} from "../database/entities/user-trade-history.entity";
import { AllPrices } from "../price-fetcher/price-fetcher.service";

export interface TradeCalculation {
  silverAmount: number;
  tomanAmount: number;
  canTrade: boolean;
  reason?: string;
}

export interface SessionStatus {
  hasActiveSession: boolean;
  sessionId?: string;
  currentPosition: "silver" | "toman";
  silverAmount?: number;
  tomanAmount?: number;
  tradeCount: number;
  profitLoss?: number;
  profitLossPercent?: number;
}

@Injectable()
export class UserTradingService {
  private readonly logger = new Logger(UserTradingService.name);

  readonly TRADE_FEE_PERCENT = 0.01; // 1% fee per transaction

  constructor(
    @InjectRepository(UserTradingSettings)
    private settingsRepo: Repository<UserTradingSettings>,
    @InjectRepository(UserTradeHistory)
    private tradeHistoryRepo: Repository<UserTradeHistory>,
  ) {}

  // ============ Settings Management ============

  async getOrCreateSettings(
    chatId: string,
    phoneNumber?: string,
  ): Promise<UserTradingSettings> {
    let settings = await this.settingsRepo.findOne({
      where: { telegramChatId: chatId },
    });

    if (!settings) {
      settings = this.settingsRepo.create({
        telegramChatId: chatId,
        phoneNumber,
        tradeMode: "percentage",
        tradePercent: 5,
        minConfidence: 70,
        maxLossPercent: 10,
      });
      await this.settingsRepo.save(settings);
      this.logger.log(`Created trading settings for chat ${chatId}`);
    }

    return settings;
  }

  async updateTradeAmount(
    chatId: string,
    mode: "percentage" | "fixed_amount",
    value: number,
  ): Promise<UserTradingSettings> {
    const settings = await this.getOrCreateSettings(chatId);

    settings.tradeMode = mode;
    if (mode === "percentage") {
      settings.tradePercent = Math.min(Math.max(value, 1), 100);
      settings.fixedSilverGrams = undefined as any;
    } else {
      settings.fixedSilverGrams = value;
    }

    await this.settingsRepo.save(settings);
    this.logger.log(`Updated trade amount for ${chatId}: ${mode} = ${value}`);

    return settings;
  }

  async updateMinConfidence(
    chatId: string,
    confidence: number,
  ): Promise<UserTradingSettings> {
    const settings = await this.getOrCreateSettings(chatId);
    settings.minConfidence = Math.min(Math.max(confidence, 50), 100);
    await this.settingsRepo.save(settings);
    return settings;
  }

  async toggleAutoTrading(
    chatId: string,
    enabled: boolean,
  ): Promise<UserTradingSettings> {
    const settings = await this.getOrCreateSettings(chatId);
    settings.autoTradingEnabled = enabled;
    await this.settingsRepo.save(settings);
    return settings;
  }

  // ============ Session Management ============

  async startSession(
    chatId: string,
    silverAmount: number,
    currentPrice: number,
  ): Promise<UserTradingSettings> {
    const settings = await this.getOrCreateSettings(chatId);

    settings.hasActiveSession = true;
    settings.sessionSilverAmount = silverAmount;
    settings.sessionTomanAmount = undefined as any;
    settings.currentPosition = "silver";
    settings.sessionTradeCount = 0;
    settings.sessionInitialSilver = silverAmount;
    settings.sessionInitialTomanValue = silverAmount * currentPrice;
    settings.sessionStartedAt = new Date();

    await this.settingsRepo.save(settings);
    this.logger.log(
      `Started trading session for ${chatId}: ${silverAmount}g silver`,
    );

    return settings;
  }

  async endSession(chatId: string): Promise<SessionStatus> {
    const settings = await this.getOrCreateSettings(chatId);

    const status = await this.getSessionStatus(chatId);

    settings.hasActiveSession = false;
    settings.sessionSilverAmount = undefined as any;
    settings.sessionTomanAmount = undefined as any;
    settings.sessionTradeCount = 0;

    await this.settingsRepo.save(settings);
    this.logger.log(`Ended trading session for ${chatId}`);

    return status;
  }

  async getSessionStatus(chatId: string): Promise<SessionStatus> {
    const settings = await this.getOrCreateSettings(chatId);

    if (!settings.hasActiveSession) {
      return {
        hasActiveSession: false,
        currentPosition: "silver",
        tradeCount: 0,
      };
    }

    // Calculate current profit/loss
    let profitLoss = 0;
    let profitLossPercent = 0;

    const recentTrades = await this.tradeHistoryRepo.find({
      where: {
        telegramChatId: chatId,
        sessionId: settings.sessionStartedAt?.toISOString(),
      },
      order: { executedAt: "DESC" },
    });

    if (recentTrades.length > 0) {
      const lastTrade = recentTrades[0];
      if (
        settings.currentPosition === "silver" &&
        lastTrade.silverBalanceAfter
      ) {
        // We have silver, compare to initial
        const currentValue =
          Number(lastTrade.silverBalanceAfter) * Number(lastTrade.pricePerGram);
        profitLoss = currentValue - settings.sessionInitialTomanValue;
        profitLossPercent =
          (profitLoss / settings.sessionInitialTomanValue) * 100;
      }
    }

    return {
      hasActiveSession: true,
      sessionId: settings.sessionStartedAt?.toISOString(),
      currentPosition: settings.currentPosition,
      silverAmount: settings.sessionSilverAmount,
      tomanAmount: settings.sessionTomanAmount,
      tradeCount: settings.sessionTradeCount,
      profitLoss,
      profitLossPercent,
    };
  }

  // ============ Position Validation ============

  /**
   * Check if an action is valid given current position
   * This prevents selling when we already sold (holding toman) and vice versa
   */
  async isActionValidForPosition(
    chatId: string,
    action: "BUY" | "SELL",
  ): Promise<{ valid: boolean; reason?: string; currentPosition: string }> {
    const settings = await this.getOrCreateSettings(chatId);

    // If no active session, any action is valid (will start a new session)
    if (!settings.hasActiveSession) {
      return { valid: true, currentPosition: "none" };
    }

    const currentPosition = settings.currentPosition;

    // If holding silver, can only SELL
    if (currentPosition === "silver" && action === "SELL") {
      return { valid: true, currentPosition };
    }

    // If holding toman (after selling), can only BUY
    if (currentPosition === "toman" && action === "BUY") {
      return { valid: true, currentPosition };
    }

    // Invalid action for current position
    return {
      valid: false,
      currentPosition,
      reason:
        currentPosition === "silver"
          ? "Already holding silver - waiting for SELL signal"
          : "Already holding Toman from previous sale - waiting for BUY signal",
    };
  }

  /**
   * Auto-start a trading session when AI makes first trade
   * This ensures position tracking works correctly
   */
  async ensureSessionForAiTrade(
    chatId: string,
    action: "BUY" | "SELL",
    silverAmount: number,
    tomanAmount: number,
    currentPrice: number,
  ): Promise<void> {
    const settings = await this.getOrCreateSettings(chatId);

    // If already has active session, do nothing
    if (settings.hasActiveSession) {
      return;
    }

    // Start a new session
    settings.hasActiveSession = true;
    settings.sessionTradeCount = 0;
    settings.sessionStartedAt = new Date();

    if (action === "SELL") {
      // Starting with a SELL - we're selling silver to get Toman
      settings.currentPosition = "silver"; // Will become "toman" after the trade
      settings.sessionSilverAmount = silverAmount;
      settings.sessionInitialSilver = silverAmount;
      settings.sessionInitialTomanValue = silverAmount * currentPrice;
    } else {
      // Starting with a BUY - we're buying silver with Toman
      settings.currentPosition = "toman"; // Will become "silver" after the trade
      settings.sessionTomanAmount = tomanAmount;
      settings.sessionInitialSilver = silverAmount;
      settings.sessionInitialTomanValue = tomanAmount;
    }

    await this.settingsRepo.save(settings);
    this.logger.log(
      `Auto-started trading session for ${chatId}: ${action} ${silverAmount.toFixed(4)}g`,
    );
  }

  /**
   * Get fee information for prompts and analysis
   */
  getFeeInfo(): { feePercent: number; minProfitForBreakeven: number } {
    return {
      feePercent: this.TRADE_FEE_PERCENT * 100, // 1%
      minProfitForBreakeven: this.TRADE_FEE_PERCENT * 2 * 100, // 2% (buy + sell)
    };
  }

  // ============ Trade Calculation ============

  async calculateTradeAmount(
    chatId: string,
    action: "BUY" | "SELL",
    currentPrice: number,
    walletSilver: number,
    walletToman: number,
  ): Promise<TradeCalculation> {
    const settings = await this.getOrCreateSettings(chatId);

    // If we have an active session, use session amounts
    if (settings.hasActiveSession) {
      return this.calculateSessionTrade(settings, action, currentPrice);
    }

    // Otherwise, calculate based on settings
    if (settings.tradeMode === "fixed_amount") {
      if (!settings.fixedSilverGrams) {
        return {
          silverAmount: 0,
          tomanAmount: 0,
          canTrade: false,
          reason: "Fixed silver amount not set",
        };
      }

      if (action === "SELL") {
        if (walletSilver < settings.fixedSilverGrams) {
          return {
            silverAmount: walletSilver,
            tomanAmount: walletSilver * currentPrice,
            canTrade: walletSilver > 0.01,
            reason: `Insufficient silver. Have ${walletSilver.toFixed(2)}g, need ${settings.fixedSilverGrams}g`,
          };
        }
        return {
          silverAmount: settings.fixedSilverGrams,
          tomanAmount: settings.fixedSilverGrams * currentPrice,
          canTrade: true,
        };
      } else {
        // BUY
        const tomanNeeded = settings.fixedSilverGrams * currentPrice;
        if (walletToman < tomanNeeded) {
          const affordableSilver = walletToman / currentPrice;
          return {
            silverAmount: affordableSilver,
            tomanAmount: walletToman,
            canTrade: walletToman > 1000,
            reason: `Insufficient Toman. Have ${walletToman.toLocaleString()}, need ${tomanNeeded.toLocaleString()}`,
          };
        }
        return {
          silverAmount: settings.fixedSilverGrams,
          tomanAmount: tomanNeeded,
          canTrade: true,
        };
      }
    }

    // Percentage mode
    const percent = settings.tradePercent / 100;

    if (action === "SELL") {
      const silverAmount = walletSilver * percent;
      return {
        silverAmount,
        tomanAmount: silverAmount * currentPrice,
        canTrade: silverAmount > 0.01,
      };
    } else {
      // BUY
      const tomanAmount = walletToman * percent;
      return {
        silverAmount: tomanAmount / currentPrice,
        tomanAmount,
        canTrade: tomanAmount > 1000,
      };
    }
  }

  private calculateSessionTrade(
    settings: UserTradingSettings,
    action: "BUY" | "SELL",
    currentPrice: number,
  ): TradeCalculation {
    // In a session, we trade the exact session amount
    if (action === "SELL" && settings.currentPosition === "silver") {
      // We have silver, sell it all
      const silverAmount = settings.sessionSilverAmount || 0;
      return {
        silverAmount,
        tomanAmount: silverAmount * currentPrice,
        canTrade: silverAmount > 0.01,
      };
    } else if (action === "BUY" && settings.currentPosition === "toman") {
      // We have Toman, buy silver with all of it
      const tomanAmount = settings.sessionTomanAmount || 0;
      return {
        silverAmount: tomanAmount / currentPrice,
        tomanAmount,
        canTrade: tomanAmount > 1000,
      };
    }

    return {
      silverAmount: 0,
      tomanAmount: 0,
      canTrade: false,
      reason: `Cannot ${action} - current position is ${settings.currentPosition}`,
    };
  }

  // ============ Trade Recording ============

  async recordTrade(
    chatId: string,
    phoneNumber: string | null,
    action: "BUY" | "SELL",
    silverAmount: number,
    pricePerGram: number,
    source: TradeSource,
    options: {
      noghreseaOrderId?: string;
      aiPredictionId?: string;
      aiConfidence?: number;
      aiReasoning?: string;
      silverBalanceAfter?: number;
      tomanBalanceAfter?: number;
      silverOunce?: number;
      goldOunce?: number;
      usdtToman?: number;
      notes?: string;
    } = {},
  ): Promise<UserTradeHistory> {
    const settings = await this.getOrCreateSettings(chatId);

    const totalToman = silverAmount * pricePerGram;
    const feePercent = this.TRADE_FEE_PERCENT; // 1% fee
    const feeAmount = totalToman * feePercent;

    // Create trade record
    const trade = new UserTradeHistory();
    trade.telegramChatId = chatId;
    trade.phoneNumber = phoneNumber || "";
    trade.action = action;
    trade.silverAmount = silverAmount;
    trade.pricePerGram = pricePerGram;
    trade.totalToman = totalToman;
    trade.feePercent = feePercent;
    trade.feeAmount = feeAmount;
    trade.source = source;
    trade.status = TradeStatus.EXECUTED;
    trade.noghreseaOrderId = options.noghreseaOrderId as string;
    trade.aiPredictionId = options.aiPredictionId as string;
    trade.aiConfidence = options.aiConfidence as number;
    trade.aiReasoning = options.aiReasoning as string;
    trade.sessionId = settings.hasActiveSession
      ? (settings.sessionStartedAt?.toISOString() as string)
      : (undefined as any);
    trade.sessionSequence = settings.hasActiveSession
      ? settings.sessionTradeCount + 1
      : (undefined as any);
    trade.silverBalanceAfter = options.silverBalanceAfter as number;
    trade.tomanBalanceAfter = options.tomanBalanceAfter as number;
    trade.silverOunceAtTrade = options.silverOunce as number;
    trade.goldOunceAtTrade = options.goldOunce as number;
    trade.usdtTomanAtTrade = options.usdtToman as number;
    trade.notes = options.notes as string;
    trade.executedAt = new Date();

    await this.tradeHistoryRepo.save(trade);

    // Update session if active
    if (settings.hasActiveSession) {
      settings.sessionTradeCount++;

      if (action === "SELL") {
        // We sold silver, now we have Toman
        settings.currentPosition = "toman";
        settings.sessionTomanAmount = totalToman - feeAmount;
        settings.sessionSilverAmount = undefined as any;
      } else {
        // We bought silver, now we have silver
        settings.currentPosition = "silver";
        settings.sessionSilverAmount = silverAmount;
        settings.sessionTomanAmount = undefined as any;
      }

      await this.settingsRepo.save(settings);
    }

    this.logger.log(
      `Recorded ${source} ${action} trade for ${chatId}: ${silverAmount.toFixed(4)}g @ ${pricePerGram.toLocaleString()}`,
    );

    return trade;
  }

  // ============ Trade History ============

  async getTradeHistory(
    chatId: string,
    limit = 20,
  ): Promise<UserTradeHistory[]> {
    return this.tradeHistoryRepo.find({
      where: { telegramChatId: chatId },
      order: { executedAt: "DESC" },
      take: limit,
    });
  }

  async getTradesBySession(sessionId: string): Promise<UserTradeHistory[]> {
    return this.tradeHistoryRepo.find({
      where: { sessionId },
      order: { sessionSequence: "ASC" },
    });
  }

  async getTradeStats(chatId: string): Promise<{
    totalTrades: number;
    buyCount: number;
    sellCount: number;
    aiTrades: number;
    manualTrades: number;
  }> {
    const trades = await this.tradeHistoryRepo.find({
      where: { telegramChatId: chatId },
    });

    return {
      totalTrades: trades.length,
      buyCount: trades.filter((t) => t.action === "BUY").length,
      sellCount: trades.filter((t) => t.action === "SELL").length,
      aiTrades: trades.filter((t) => t.source === TradeSource.AI).length,
      manualTrades: trades.filter((t) => t.source === TradeSource.MANUAL)
        .length,
    };
  }

  // ============ AI Trade Analyzer ============

  /**
   * Get comprehensive AI trade analysis for up to a year
   */
  async getAiTradeAnalysis(
    chatId?: string,
    period: "week" | "month" | "quarter" | "year" = "month",
  ): Promise<AiTradeAnalysis> {
    const periodDays = {
      week: 7,
      month: 30,
      quarter: 90,
      year: 365,
    };

    const since = new Date();
    since.setDate(since.getDate() - periodDays[period]);

    // Get all AI trades (optionally filtered by user)
    const whereClause: any = {
      source: TradeSource.AI,
      executedAt: MoreThan(since),
    };
    if (chatId) {
      whereClause.telegramChatId = chatId;
    }

    const trades = await this.tradeHistoryRepo.find({
      where: whereClause,
      order: { executedAt: "ASC" },
    });

    if (trades.length === 0) {
      return {
        period,
        totalTrades: 0,
        buyTrades: 0,
        sellTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        successRate: 0,
        totalSilverBought: 0,
        totalSilverSold: 0,
        totalTomanSpent: 0,
        totalTomanReceived: 0,
        netProfitLoss: 0,
        netProfitLossPercent: 0,
        avgBuyPrice: 0,
        avgSellPrice: 0,
        avgConfidence: 0,
        highConfidenceSuccessRate: 0,
        lowConfidenceSuccessRate: 0,
        bestTrade: null,
        worstTrade: null,
        tradePairs: [],
        monthlyBreakdown: [],
        feePercent: this.TRADE_FEE_PERCENT * 100,
        totalFeesPaid: 0,
        netProfitLossAfterFees: 0,
      };
    }

    // Separate buys and sells
    const buys = trades.filter((t) => t.action === "BUY");
    const sells = trades.filter((t) => t.action === "SELL");

    // Calculate totals
    const totalSilverBought = buys.reduce(
      (sum, t) => sum + Number(t.silverAmount),
      0,
    );
    const totalSilverSold = sells.reduce(
      (sum, t) => sum + Number(t.silverAmount),
      0,
    );
    const totalTomanSpent = buys.reduce(
      (sum, t) => sum + Number(t.totalToman),
      0,
    );
    const totalTomanReceived = sells.reduce(
      (sum, t) => sum + Number(t.totalToman),
      0,
    );

    // Calculate averages
    const avgBuyPrice =
      buys.length > 0
        ? buys.reduce((sum, t) => sum + Number(t.pricePerGram), 0) / buys.length
        : 0;
    const avgSellPrice =
      sells.length > 0
        ? sells.reduce((sum, t) => sum + Number(t.pricePerGram), 0) /
          sells.length
        : 0;
    const avgConfidence =
      trades.reduce((sum, t) => sum + (Number(t.aiConfidence) || 0), 0) /
      trades.length;

    // Analyze trade pairs (BUY followed by SELL)
    const tradePairs = this.analyzeTradePairs(trades);

    // Calculate success/failure
    let successfulTrades = 0;
    let failedTrades = 0;
    let bestTrade: TradePairResult | null = null;
    let worstTrade: TradePairResult | null = null;

    for (const pair of tradePairs) {
      if (pair.profitLossPercent > 0) {
        successfulTrades++;
        if (
          !bestTrade ||
          pair.profitLossPercent > bestTrade.profitLossPercent
        ) {
          bestTrade = pair;
        }
      } else {
        failedTrades++;
        if (
          !worstTrade ||
          pair.profitLossPercent < worstTrade.profitLossPercent
        ) {
          worstTrade = pair;
        }
      }
    }

    const successRate =
      tradePairs.length > 0 ? (successfulTrades / tradePairs.length) * 100 : 0;

    // High confidence (>= 80%) vs low confidence (< 80%) success rates
    const highConfPairs = tradePairs.filter((p) => p.avgConfidence >= 80);
    const lowConfPairs = tradePairs.filter((p) => p.avgConfidence < 80);

    const highConfidenceSuccessRate =
      highConfPairs.length > 0
        ? (highConfPairs.filter((p) => p.profitLossPercent > 0).length /
            highConfPairs.length) *
          100
        : 0;

    const lowConfidenceSuccessRate =
      lowConfPairs.length > 0
        ? (lowConfPairs.filter((p) => p.profitLossPercent > 0).length /
            lowConfPairs.length) *
          100
        : 0;

    // Net P/L
    const netProfitLoss = tradePairs.reduce(
      (sum, p) => sum + p.profitLossToman,
      0,
    );
    const totalInvested = tradePairs.reduce((sum, p) => sum + p.buyToman, 0);
    const netProfitLossPercent =
      totalInvested > 0 ? (netProfitLoss / totalInvested) * 100 : 0;

    // Calculate total fees paid (1% on each transaction)
    const totalVolumeToman = totalTomanSpent + totalTomanReceived;
    const totalFeesPaid = totalVolumeToman * this.TRADE_FEE_PERCENT;
    const netProfitLossAfterFees = netProfitLoss - totalFeesPaid;

    // Monthly breakdown
    const monthlyBreakdown = this.getMonthlyBreakdown(tradePairs);

    return {
      period,
      totalTrades: trades.length,
      buyTrades: buys.length,
      sellTrades: sells.length,
      successfulTrades,
      failedTrades,
      successRate,
      totalSilverBought,
      totalSilverSold,
      totalTomanSpent,
      totalTomanReceived,
      netProfitLoss,
      netProfitLossPercent,
      avgBuyPrice,
      avgSellPrice,
      avgConfidence,
      highConfidenceSuccessRate,
      lowConfidenceSuccessRate,
      bestTrade,
      worstTrade,
      tradePairs,
      monthlyBreakdown,
      feePercent: this.TRADE_FEE_PERCENT * 100,
      totalFeesPaid,
      netProfitLossAfterFees,
    };
  }

  /**
   * Analyze BUY-SELL pairs to determine profit/loss
   */
  private analyzeTradePairs(trades: UserTradeHistory[]): TradePairResult[] {
    const pairs: TradePairResult[] = [];
    const pendingBuys: UserTradeHistory[] = [];

    for (const trade of trades) {
      if (trade.action === "BUY") {
        pendingBuys.push(trade);
      } else if (trade.action === "SELL" && pendingBuys.length > 0) {
        // Match with the oldest pending buy (FIFO)
        const buy = pendingBuys.shift()!;

        const buyToman = Number(buy.totalToman);
        const sellToman = Number(trade.totalToman);
        const profitLossToman = sellToman - buyToman;
        const profitLossPercent = (profitLossToman / buyToman) * 100;

        pairs.push({
          buyDate: buy.executedAt,
          sellDate: trade.executedAt,
          buyPrice: Number(buy.pricePerGram),
          sellPrice: Number(trade.pricePerGram),
          silverAmount: Number(buy.silverAmount),
          buyToman,
          sellToman,
          profitLossToman,
          profitLossPercent,
          avgConfidence:
            ((Number(buy.aiConfidence) || 0) +
              (Number(trade.aiConfidence) || 0)) /
            2,
          holdingDays: Math.floor(
            (trade.executedAt.getTime() - buy.executedAt.getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        });
      }
    }

    return pairs;
  }

  /**
   * Get monthly breakdown of trade performance
   */
  private getMonthlyBreakdown(
    pairs: TradePairResult[],
  ): MonthlyTradeBreakdown[] {
    const monthlyMap = new Map<string, MonthlyTradeBreakdown>();

    for (const pair of pairs) {
      const monthKey = `${pair.sellDate.getFullYear()}-${String(pair.sellDate.getMonth() + 1).padStart(2, "0")}`;

      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          month: monthKey,
          trades: 0,
          successfulTrades: 0,
          failedTrades: 0,
          profitLoss: 0,
          successRate: 0,
        });
      }

      const monthly = monthlyMap.get(monthKey)!;
      monthly.trades++;
      monthly.profitLoss += pair.profitLossToman;

      if (pair.profitLossPercent > 0) {
        monthly.successfulTrades++;
      } else {
        monthly.failedTrades++;
      }
    }

    // Calculate success rates
    for (const monthly of monthlyMap.values()) {
      monthly.successRate =
        monthly.trades > 0
          ? (monthly.successfulTrades / monthly.trades) * 100
          : 0;
    }

    return Array.from(monthlyMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    );
  }

  /**
   * Get all-time AI performance stats
   */
  async getAllTimeAiStats(): Promise<AllTimeAiStats> {
    const trades = await this.tradeHistoryRepo.find({
      where: { source: TradeSource.AI },
      order: { executedAt: "ASC" },
    });

    if (trades.length === 0) {
      return {
        firstTradeDate: null,
        lastTradeDate: null,
        totalDaysActive: 0,
        totalTrades: 0,
        totalVolumeSilver: 0,
        totalVolumeToman: 0,
        overallSuccessRate: 0,
        overallProfitLoss: 0,
      };
    }

    const pairs = this.analyzeTradePairs(trades);
    const successfulPairs = pairs.filter((p) => p.profitLossPercent > 0);

    return {
      firstTradeDate: trades[0].executedAt,
      lastTradeDate: trades[trades.length - 1].executedAt,
      totalDaysActive: Math.floor(
        (trades[trades.length - 1].executedAt.getTime() -
          trades[0].executedAt.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
      totalTrades: trades.length,
      totalVolumeSilver: trades.reduce(
        (sum, t) => sum + Number(t.silverAmount),
        0,
      ),
      totalVolumeToman: trades.reduce(
        (sum, t) => sum + Number(t.totalToman),
        0,
      ),
      overallSuccessRate:
        pairs.length > 0 ? (successfulPairs.length / pairs.length) * 100 : 0,
      overallProfitLoss: pairs.reduce((sum, p) => sum + p.profitLossToman, 0),
    };
  }
}

// ============ Interfaces ============

export interface TradePairResult {
  buyDate: Date;
  sellDate: Date;
  buyPrice: number;
  sellPrice: number;
  silverAmount: number;
  buyToman: number;
  sellToman: number;
  profitLossToman: number;
  profitLossPercent: number;
  avgConfidence: number;
  holdingDays: number;
}

export interface MonthlyTradeBreakdown {
  month: string;
  trades: number;
  successfulTrades: number;
  failedTrades: number;
  profitLoss: number;
  successRate: number;
}

export interface AiTradeAnalysis {
  period: string;
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  successfulTrades: number;
  failedTrades: number;
  successRate: number;
  totalSilverBought: number;
  totalSilverSold: number;
  totalTomanSpent: number;
  totalTomanReceived: number;
  netProfitLoss: number;
  netProfitLossPercent: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  avgConfidence: number;
  highConfidenceSuccessRate: number;
  lowConfidenceSuccessRate: number;
  bestTrade: TradePairResult | null;
  worstTrade: TradePairResult | null;
  tradePairs: TradePairResult[];
  monthlyBreakdown: MonthlyTradeBreakdown[];
  // Fee tracking
  feePercent: number;
  totalFeesPaid: number;
  netProfitLossAfterFees: number;
}

export interface AllTimeAiStats {
  firstTradeDate: Date | null;
  lastTradeDate: Date | null;
  totalDaysActive: number;
  totalTrades: number;
  totalVolumeSilver: number;
  totalVolumeToman: number;
  overallSuccessRate: number;
  overallProfitLoss: number;
}
