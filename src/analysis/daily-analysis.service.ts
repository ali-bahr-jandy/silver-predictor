import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import { DailySummary } from "../database/entities/daily-summary.entity";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";
import {
  PriceSnapshot,
  PriceSource,
} from "../database/entities/price-snapshot.entity";
import { AiDecision } from "../database/entities/ai-decision.entity";
import { GRAMS_PER_OUNCE, GRAMS_PER_MESGHAL } from "../common/constants";

interface DayData {
  prices: NoghreseaPrice[];
  silverSnapshots: PriceSnapshot[];
  usdtSnapshots: PriceSnapshot[];
  aiDecisions: AiDecision[];
}

@Injectable()
export class DailyAnalysisService {
  private readonly logger = new Logger(DailyAnalysisService.name);

  constructor(
    @InjectRepository(DailySummary)
    private dailySummaryRepo: Repository<DailySummary>,
    @InjectRepository(NoghreseaPrice)
    private noghreseaPriceRepo: Repository<NoghreseaPrice>,
    @InjectRepository(PriceSnapshot)
    private priceSnapshotRepo: Repository<PriceSnapshot>,
    @InjectRepository(AiDecision)
    private aiDecisionRepo: Repository<AiDecision>,
  ) {}

  /**
   * Generate daily summary for a specific date
   */
  async generateDailySummary(
    date: Date = new Date(),
  ): Promise<DailySummary | null> {
    const dateStr = this.formatDate(date);
    this.logger.log(`📊 Generating daily summary for ${dateStr}`);

    // Get start and end of day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch all data for the day
    const dayData = await this.fetchDayData(startOfDay, endOfDay);

    // Check if we have enough data
    if (dayData.prices.length < 2) {
      this.logger.warn(
        `Not enough price data for ${dateStr} (${dayData.prices.length} records)`,
      );
      return null;
    }

    // Calculate all metrics
    const summary = await this.calculateSummary(dateStr, dayData);

    // Generate GPT prompt data
    summary.gptPromptData = this.generateGptPromptData(summary, dayData);
    summary.notes = this.generateHumanReadableNotes(summary);

    // Save or update
    const existing = await this.dailySummaryRepo.findOne({
      where: { date: dateStr },
    });
    if (existing) {
      summary.id = existing.id;
      summary.updatedAt = new Date();
    }

    const saved = await this.dailySummaryRepo.save(summary);
    this.logger.log(`✅ Daily summary saved for ${dateStr}`);

    return saved;
  }

  private async fetchDayData(
    startOfDay: Date,
    endOfDay: Date,
  ): Promise<DayData> {
    const [prices, silverSnapshots, usdtSnapshots, aiDecisions] =
      await Promise.all([
        this.noghreseaPriceRepo.find({
          where: { recordedAt: Between(startOfDay, endOfDay) },
          order: { recordedAt: "ASC" },
        }),
        this.priceSnapshotRepo.find({
          where: {
            source: PriceSource.SILVER_OUNCE,
            fetchedAt: Between(startOfDay, endOfDay),
          },
          order: { fetchedAt: "ASC" },
        }),
        this.priceSnapshotRepo.find({
          where: {
            source: PriceSource.USDT_TOMAN,
            fetchedAt: Between(startOfDay, endOfDay),
          },
          order: { fetchedAt: "ASC" },
        }),
        this.aiDecisionRepo.find({
          where: { createdAt: Between(startOfDay, endOfDay) },
          order: { createdAt: "ASC" },
        }),
      ]);

    return { prices, silverSnapshots, usdtSnapshots, aiDecisions };
  }

  private async calculateSummary(
    dateStr: string,
    data: DayData,
  ): Promise<DailySummary> {
    const { prices, silverSnapshots, usdtSnapshots, aiDecisions } = data;

    const summary = new DailySummary();
    summary.date = dateStr;

    // Basic price metrics
    const priceValues = prices.map((p) => Number(p.price));
    summary.openPrice = priceValues[0];
    summary.closePrice = priceValues[priceValues.length - 1];
    summary.highPrice = Math.max(...priceValues);
    summary.lowPrice = Math.min(...priceValues);
    summary.priceChange = summary.closePrice - summary.openPrice;
    summary.priceChangePercent =
      (summary.priceChange / summary.openPrice) * 100;

    // Volatility
    summary.range = summary.highPrice - summary.lowPrice;
    summary.rangePercent = (summary.range / summary.openPrice) * 100;
    summary.volatility = this.calculateVolatility(priceValues);

    // International silver
    if (silverSnapshots.length > 0) {
      const silverValues = silverSnapshots.map((s) => Number(s.price));
      summary.internationalSilverOpen = silverValues[0];
      summary.internationalSilverClose = silverValues[silverValues.length - 1];
      summary.internationalChangePercent =
        ((summary.internationalSilverClose - summary.internationalSilverOpen) /
          summary.internationalSilverOpen) *
        100;

      // Calculate premium
      const avgNoghresea =
        priceValues.reduce((a, b) => a + b, 0) / priceValues.length;
      const avgSilver =
        silverValues.reduce((a, b) => a + b, 0) / silverValues.length;

      // Convert Noghresea to USD for comparison (rough estimate)
      if (usdtSnapshots.length > 0) {
        const avgUsdt =
          usdtSnapshots.reduce((a, b) => a + Number(b.price), 0) /
          usdtSnapshots.length;
        const noghreseaPerGram = (avgNoghresea * 1000) / GRAMS_PER_MESGHAL;
        const noghreseaPerOunceUsd =
          (noghreseaPerGram * GRAMS_PER_OUNCE) / avgUsdt;
        summary.premiumToInternational =
          ((noghreseaPerOunceUsd - avgSilver) / avgSilver) * 100;
      }
    }

    // USDT metrics
    if (usdtSnapshots.length > 0) {
      const usdtValues = usdtSnapshots.map((s) => Number(s.price));
      summary.usdtOpen = usdtValues[0];
      summary.usdtClose = usdtValues[usdtValues.length - 1];
      summary.usdtChangePercent =
        ((summary.usdtClose - summary.usdtOpen) / summary.usdtOpen) * 100;
    }

    // Pattern detection
    const patterns = this.detectPatterns(prices);
    summary.detectedPatterns = patterns.patterns;
    summary.manipulationSignals = patterns.manipulationCount;

    // Sentiment analysis
    const sentiment = this.analyzeSentiment(summary, prices);
    summary.sentiment = sentiment.sentiment;
    summary.trendDirection = sentiment.direction;
    summary.trendStrength = sentiment.strength;

    // Trading activity
    summary.priceUpdates = prices.length;
    summary.significantMoves = this.countSignificantMoves(priceValues);

    // Time-based analysis
    const timeAnalysis = this.analyzeTimePatterns(prices);
    summary.mostActiveHour = timeAnalysis.mostActiveHour;
    summary.morningChange = timeAnalysis.morningChange;
    summary.afternoonChange = timeAnalysis.afternoonChange;
    summary.eveningChange = timeAnalysis.eveningChange;

    // AI decision summary
    summary.aiDecisions = aiDecisions.length;
    summary.buySignals = aiDecisions.filter((d) => d.action === "buy").length;
    summary.sellSignals = aiDecisions.filter((d) => d.action === "sell").length;
    if (aiDecisions.length > 0) {
      summary.avgConfidence =
        aiDecisions.reduce((a, b) => a + Number(b.confidence), 0) /
        aiDecisions.length;
    }

    return summary;
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    // Calculate standard deviation
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map((r) => Math.pow(r - mean, 2));
    const variance =
      squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;

    return Math.sqrt(variance) * 100; // Return as percentage
  }

  private detectPatterns(prices: NoghreseaPrice[]): {
    patterns: string[];
    manipulationCount: number;
  } {
    const patterns: string[] = [];
    let manipulationCount = 0;

    const priceValues = prices.map((p) => Number(p.price));

    // Sudden spike detection (>2% in 5 minutes)
    for (let i = 5; i < priceValues.length; i++) {
      const change =
        Math.abs((priceValues[i] - priceValues[i - 5]) / priceValues[i - 5]) *
        100;
      if (change > 2) {
        if (!patterns.includes("sudden_spike")) patterns.push("sudden_spike");
        manipulationCount++;
      }
    }

    // V-shape recovery (drop then quick recovery)
    for (let i = 10; i < priceValues.length; i++) {
      const mid = priceValues[i - 5];
      const start = priceValues[i - 10];
      const end = priceValues[i];

      if (mid < start * 0.98 && end > start * 0.99) {
        if (!patterns.includes("v_shape_recovery"))
          patterns.push("v_shape_recovery");
        manipulationCount++;
      }
    }

    // Gap detection (significant jump between consecutive prices)
    for (let i = 1; i < priceValues.length; i++) {
      const gap =
        Math.abs((priceValues[i] - priceValues[i - 1]) / priceValues[i - 1]) *
        100;
      if (gap > 1) {
        if (!patterns.includes("price_gap")) patterns.push("price_gap");
      }
    }

    // Consolidation (low volatility period)
    const recentPrices = priceValues.slice(-30);
    if (recentPrices.length >= 30) {
      const range =
        (Math.max(...recentPrices) - Math.min(...recentPrices)) /
        recentPrices[0];
      if (range < 0.005) {
        patterns.push("consolidation");
      }
    }

    // Trending detection
    const trend = this.detectTrend(priceValues);
    if (trend !== "sideways") {
      patterns.push(`${trend}_trend`);
    }

    return { patterns, manipulationCount };
  }

  private detectTrend(prices: number[]): "up" | "down" | "sideways" {
    if (prices.length < 10) return "sideways";

    // Simple linear regression
    const n = prices.length;
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i];
      sumXY += i * prices[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPrice = sumY / n;
    const slopePercent = (slope / avgPrice) * 100;

    if (slopePercent > 0.1) return "up";
    if (slopePercent < -0.1) return "down";
    return "sideways";
  }

  private analyzeSentiment(
    summary: DailySummary,
    prices: NoghreseaPrice[],
  ): {
    sentiment: "bullish" | "bearish" | "neutral" | "volatile";
    direction: "up" | "down" | "sideways";
    strength: number;
  } {
    let sentiment: "bullish" | "bearish" | "neutral" | "volatile" = "neutral";
    let direction: "up" | "down" | "sideways" = "sideways";
    let strength = 50;

    const changePercent = summary.priceChangePercent;
    const volatility = summary.volatility;

    // High volatility = volatile sentiment
    if (volatility > 2) {
      sentiment = "volatile";
      strength = Math.min(100, volatility * 25);
    } else if (changePercent > 1) {
      sentiment = "bullish";
      direction = "up";
      strength = Math.min(100, changePercent * 30);
    } else if (changePercent < -1) {
      sentiment = "bearish";
      direction = "down";
      strength = Math.min(100, Math.abs(changePercent) * 30);
    } else {
      // Neutral - look at recent trend
      const recentPrices = prices.slice(-20).map((p) => Number(p.price));
      direction = this.detectTrend(recentPrices);

      if (direction === "up") {
        sentiment = "bullish";
        strength = 40;
      } else if (direction === "down") {
        sentiment = "bearish";
        strength = 40;
      }
    }

    return { sentiment, direction, strength };
  }

  private countSignificantMoves(prices: number[]): number {
    let count = 0;
    for (let i = 1; i < prices.length; i++) {
      const change =
        Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]) * 100;
      if (change > 0.5) count++;
    }
    return count;
  }

  private analyzeTimePatterns(prices: NoghreseaPrice[]): {
    mostActiveHour: string;
    morningChange: number;
    afternoonChange: number;
    eveningChange: number;
  } {
    const hourlyChanges: Map<number, number[]> = new Map();

    // Group price changes by hour
    for (let i = 1; i < prices.length; i++) {
      const hour = new Date(prices[i].recordedAt).getHours();
      const change =
        Math.abs(
          (Number(prices[i].price) - Number(prices[i - 1].price)) /
            Number(prices[i - 1].price),
        ) * 100;

      if (!hourlyChanges.has(hour)) hourlyChanges.set(hour, []);
      hourlyChanges.get(hour)!.push(change);
    }

    // Find most active hour
    let maxActivity = 0;
    let mostActiveHour = "12:00";

    hourlyChanges.forEach((changes, hour) => {
      const totalChange = changes.reduce((a, b) => a + b, 0);
      if (totalChange > maxActivity) {
        maxActivity = totalChange;
        mostActiveHour = `${hour.toString().padStart(2, "0")}:00`;
      }
    });

    // Calculate period changes
    const morningPrices = prices.filter(
      (p) => new Date(p.recordedAt).getHours() < 12,
    );
    const afternoonPrices = prices.filter((p) => {
      const h = new Date(p.recordedAt).getHours();
      return h >= 12 && h < 18;
    });
    const eveningPrices = prices.filter(
      (p) => new Date(p.recordedAt).getHours() >= 18,
    );

    const calculatePeriodChange = (periodPrices: NoghreseaPrice[]): number => {
      if (periodPrices.length < 2) return 0;
      const first = Number(periodPrices[0].price);
      const last = Number(periodPrices[periodPrices.length - 1].price);
      return ((last - first) / first) * 100;
    };

    return {
      mostActiveHour,
      morningChange: calculatePeriodChange(morningPrices),
      afternoonChange: calculatePeriodChange(afternoonPrices),
      eveningChange: calculatePeriodChange(eveningPrices),
    };
  }

  private generateGptPromptData(summary: DailySummary, data: DayData): string {
    const promptData = {
      date: summary.date,
      market_data: {
        noghresea: {
          open: summary.openPrice,
          close: summary.closePrice,
          high: summary.highPrice,
          low: summary.lowPrice,
          change_percent: summary.priceChangePercent,
          volatility: summary.volatility,
          range_percent: summary.rangePercent,
        },
        international_silver: {
          open: summary.internationalSilverOpen,
          close: summary.internationalSilverClose,
          change_percent: summary.internationalChangePercent,
        },
        usdt_toman: {
          open: summary.usdtOpen,
          close: summary.usdtClose,
          change_percent: summary.usdtChangePercent,
        },
        premium_to_international: summary.premiumToInternational,
      },
      patterns: {
        detected: summary.detectedPatterns,
        manipulation_signals: summary.manipulationSignals,
      },
      sentiment: {
        overall: summary.sentiment,
        trend_direction: summary.trendDirection,
        trend_strength: summary.trendStrength,
      },
      activity: {
        price_updates: summary.priceUpdates,
        significant_moves: summary.significantMoves,
        most_active_hour: summary.mostActiveHour,
        morning_change: summary.morningChange,
        afternoon_change: summary.afternoonChange,
        evening_change: summary.eveningChange,
      },
      ai_signals: {
        total_decisions: summary.aiDecisions,
        buy_signals: summary.buySignals,
        sell_signals: summary.sellSignals,
        avg_confidence: summary.avgConfidence,
      },
      price_samples: data.prices.slice(0, 50).map((p) => ({
        time: new Date(p.recordedAt).toISOString(),
        price: Number(p.price),
        change_24h: Number(p.change24h),
      })),
    };

    return JSON.stringify(promptData, null, 2);
  }

  private generateHumanReadableNotes(summary: DailySummary): string {
    const lines: string[] = [];

    lines.push(`📅 Daily Summary for ${summary.date}`);
    lines.push("");
    lines.push("📈 Price Movement:");
    lines.push(`  Open: ${summary.openPrice} → Close: ${summary.closePrice}`);
    lines.push(
      `  Change: ${summary.priceChange > 0 ? "+" : ""}${summary.priceChangePercent.toFixed(2)}%`,
    );
    lines.push(
      `  Range: ${summary.lowPrice} - ${summary.highPrice} (${summary.rangePercent.toFixed(2)}%)`,
    );
    lines.push(`  Volatility: ${summary.volatility.toFixed(3)}%`);
    lines.push("");

    if (summary.internationalSilverOpen) {
      lines.push("🌍 International Silver:");
      lines.push(
        `  $${summary.internationalSilverOpen.toFixed(2)} → $${summary.internationalSilverClose.toFixed(2)}`,
      );
      lines.push(
        `  Change: ${summary.internationalChangePercent > 0 ? "+" : ""}${summary.internationalChangePercent.toFixed(2)}%`,
      );
      if (summary.premiumToInternational) {
        lines.push(
          `  Noghresea Premium: ${summary.premiumToInternational > 0 ? "+" : ""}${summary.premiumToInternational.toFixed(1)}%`,
        );
      }
      lines.push("");
    }

    lines.push("🎯 Sentiment:");
    lines.push(`  Overall: ${summary.sentiment.toUpperCase()}`);
    lines.push(
      `  Trend: ${summary.trendDirection} (strength: ${summary.trendStrength}%)`,
    );
    lines.push("");

    if (summary.detectedPatterns?.length > 0) {
      lines.push("⚠️ Patterns Detected:");
      summary.detectedPatterns.forEach((p) =>
        lines.push(`  • ${p.replace(/_/g, " ")}`),
      );
      if (summary.manipulationSignals > 0) {
        lines.push(`  🚨 Manipulation signals: ${summary.manipulationSignals}`);
      }
      lines.push("");
    }

    lines.push("⏰ Time Analysis:");
    lines.push(`  Most active hour: ${summary.mostActiveHour}`);
    lines.push(
      `  Morning: ${summary.morningChange > 0 ? "+" : ""}${summary.morningChange?.toFixed(2) || 0}%`,
    );
    lines.push(
      `  Afternoon: ${summary.afternoonChange > 0 ? "+" : ""}${summary.afternoonChange?.toFixed(2) || 0}%`,
    );
    lines.push(
      `  Evening: ${summary.eveningChange > 0 ? "+" : ""}${summary.eveningChange?.toFixed(2) || 0}%`,
    );
    lines.push("");

    if (summary.aiDecisions > 0) {
      lines.push("🤖 AI Decisions:");
      lines.push(
        `  Total: ${summary.aiDecisions} (Buy: ${summary.buySignals}, Sell: ${summary.sellSignals})`,
      );
      lines.push(
        `  Avg Confidence: ${summary.avgConfidence?.toFixed(1) || 0}%`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Get the last N days of summaries for GPT analysis
   */
  async getSummariesForGpt(days: number = 7): Promise<string> {
    const summaries = await this.dailySummaryRepo.find({
      order: { date: "DESC" },
      take: days,
    });

    if (summaries.length === 0) {
      return "No daily summaries available yet.";
    }

    const gptPrompt = {
      analysis_request:
        "Analyze the following silver price data from Noghresea.ir (Iranian silver trading platform) and provide trading insights.",
      context: {
        platform: "Noghresea.ir - Iranian silver trading platform",
        currency: "Prices are in thousand Tomans per Mesghal (4.6083 grams)",
        market_hours: "24/7 trading",
        data_period: `${summaries.length} days`,
      },
      daily_data: summaries.map((s) => JSON.parse(s.gptPromptData || "{}")),
      analysis_goals: [
        "Identify recurring patterns in price movements",
        "Detect potential manipulation or unusual activity",
        "Predict likely price direction for next trading session",
        "Suggest optimal buy/sell timing based on historical patterns",
        "Assess current market sentiment and its reliability",
        "Identify correlation between Noghresea and international silver prices",
      ],
    };

    return JSON.stringify(gptPrompt, null, 2);
  }

  /**
   * Get summary for a specific date
   */
  async getSummary(date: string): Promise<DailySummary | null> {
    return this.dailySummaryRepo.findOne({ where: { date } });
  }

  /**
   * Get recent summaries
   */
  async getRecentSummaries(days: number = 7): Promise<DailySummary[]> {
    return this.dailySummaryRepo.find({
      order: { date: "DESC" },
      take: days,
    });
  }

  private formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
  }
}
