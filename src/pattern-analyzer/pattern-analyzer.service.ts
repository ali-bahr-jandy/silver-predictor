import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  PatternEvent,
  PatternType,
} from "../database/entities/pattern-event.entity";
import { NoghreseaApiService } from "../noghresea/noghresea-api.service";
import {
  PriceFetcherService,
  AllPrices,
} from "../price-fetcher/price-fetcher.service";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";

export interface PatternAnalysis {
  detected: boolean;
  patterns: DetectedPattern[];
  overallConfidence: number;
  suggestion: "BUY" | "SELL" | "HOLD";
}

export interface DetectedPattern {
  type: PatternType;
  confidence: number;
  description: string;
}

@Injectable()
export class PatternAnalyzerService {
  private readonly logger = new Logger(PatternAnalyzerService.name);

  constructor(
    @InjectRepository(PatternEvent)
    private patternEventRepo: Repository<PatternEvent>,
    private noghreseaApi: NoghreseaApiService,
    private priceFetcher: PriceFetcherService,
  ) {}

  async analyze(prices: AllPrices): Promise<PatternAnalysis> {
    const recentPrices = await this.noghreseaApi.getRecentPrices(10); // Last 10 minutes
    const patterns: DetectedPattern[] = [];

    this.logger.debug(
      `Analyzing ${recentPrices.length} recent prices from last 10 minutes`,
    );

    if (recentPrices.length < 3) {
      this.logger.debug("Not enough price data for pattern analysis (need 3+)");
      return {
        detected: false,
        patterns: [],
        overallConfidence: 0,
        suggestion: "HOLD",
      };
    }

    // Log recent price changes for debugging
    const changes = recentPrices.slice(0, 5).map((p) => ({
      change: Number(p.changeFromPrev).toFixed(2),
      percent: Number(p.changePercent).toFixed(3),
    }));
    this.logger.debug(`Recent changes: ${JSON.stringify(changes)}`);

    // Check for multi-bearish pattern (2-3 consecutive drops)
    const multiBearish = this.detectMultiBearish(recentPrices);
    if (multiBearish) patterns.push(multiBearish);

    // Check for multi-bullish pattern
    const multiBullish = this.detectMultiBullish(recentPrices);
    if (multiBullish) patterns.push(multiBullish);

    // Check for sudden change
    const suddenChange = this.detectSuddenChange(recentPrices);
    if (suddenChange) patterns.push(suddenChange);

    // Check for manipulation vs market-driven
    const marketCorrelation = await this.detectMarketCorrelation(
      prices,
      recentPrices,
    );
    if (marketCorrelation) patterns.push(marketCorrelation);

    // Check for recovery pattern
    const recovery = this.detectRecovery(recentPrices);
    if (recovery) patterns.push(recovery);

    // Check for drop bottom pattern (first rise after multiple drops - BUY signal!)
    const dropBottom = this.detectDropBottom(recentPrices);
    if (dropBottom) patterns.push(dropBottom);

    // Calculate overall analysis
    const analysis = this.calculateOverallAnalysis(patterns, recentPrices);

    // Save significant patterns (only when confidence >= 70% - lowered for better tracking)
    if (analysis.detected && analysis.overallConfidence >= 70) {
      await this.savePatternEvent(analysis, prices);
    }

    return analysis;
  }

  private detectMultiBearish(prices: NoghreseaPrice[]): DetectedPattern | null {
    if (prices.length < 3) return null;

    // Get last 5 price changes
    const recentChanges = prices.slice(0, 5);
    let consecutiveDrops = 0;
    let totalDrop = 0;

    for (let i = 0; i < recentChanges.length - 1; i++) {
      const change = Number(recentChanges[i].changeFromPrev);
      if (change < 0) {
        consecutiveDrops++;
        totalDrop += Math.abs(change);
      } else {
        break;
      }
    }

    if (consecutiveDrops >= 2) {
      const confidence = Math.min(
        40 + consecutiveDrops * 15 + totalDrop * 5,
        95,
      );
      return {
        type: PatternType.MULTI_BEARISH,
        confidence,
        description: `${consecutiveDrops} consecutive drops detected (total: -${totalDrop.toFixed(2)})`,
      };
    }

    return null;
  }

  private detectMultiBullish(prices: NoghreseaPrice[]): DetectedPattern | null {
    if (prices.length < 3) return null;

    const recentChanges = prices.slice(0, 5);
    let consecutiveRises = 0;
    let totalRise = 0;

    for (let i = 0; i < recentChanges.length - 1; i++) {
      const change = Number(recentChanges[i].changeFromPrev);
      if (change > 0) {
        consecutiveRises++;
        totalRise += change;
      } else {
        break;
      }
    }

    if (consecutiveRises >= 2) {
      const confidence = Math.min(
        40 + consecutiveRises * 15 + totalRise * 5,
        95,
      );
      return {
        type: PatternType.MULTI_BULLISH,
        confidence,
        description: `${consecutiveRises} consecutive rises detected (total: +${totalRise.toFixed(2)})`,
      };
    }

    return null;
  }

  private detectSuddenChange(prices: NoghreseaPrice[]): DetectedPattern | null {
    if (prices.length < 2) return null;

    const latest = prices[0];
    const changePercent = Math.abs(Number(latest.changePercent));

    // Sudden change if > 0.2% in a single tick (lowered from 0.5% for silver market)
    if (changePercent > 0.2) {
      const isDrop = Number(latest.changeFromPrev) < 0;
      return {
        type: isDrop ? PatternType.SUDDEN_DROP : PatternType.SUDDEN_SPIKE,
        confidence: Math.min(40 + changePercent * 30, 95),
        description: `Sudden ${isDrop ? "drop" : "spike"} of ${changePercent.toFixed(2)}%`,
      };
    }

    return null;
  }

  private async detectMarketCorrelation(
    prices: AllPrices,
    recentNoghresea: NoghreseaPrice[],
  ): Promise<DetectedPattern | null> {
    if (!prices.silverOunce || recentNoghresea.length < 3) return null;

    // Get recent silver ounce prices
    const recentSilverOunce = await this.priceFetcher.getRecentSnapshots(
      "SILVER_OUNCE" as any,
      5,
    );

    if (recentSilverOunce.length < 2) return null;

    // Calculate silver ounce change
    const ounceChange =
      ((Number(recentSilverOunce[0].price) -
        Number(recentSilverOunce[recentSilverOunce.length - 1].price)) /
        Number(recentSilverOunce[recentSilverOunce.length - 1].price)) *
      100;

    // Calculate noghresea change
    const noghreseaChange =
      ((Number(recentNoghresea[0].price) -
        Number(recentNoghresea[recentNoghresea.length - 1].price)) /
        Number(recentNoghresea[recentNoghresea.length - 1].price)) *
      100;

    // If noghresea moved significantly but market didn't → manipulation
    const marketStable = Math.abs(ounceChange) < 0.15; // Lowered from 0.3%
    const noghreseaMoved = Math.abs(noghreseaChange) > 0.25; // Lowered from 0.5%

    if (marketStable && noghreseaMoved) {
      return {
        type: PatternType.MANIPULATION,
        confidence: Math.min(60 + Math.abs(noghreseaChange) * 10, 95),
        description: `Platform moved ${noghreseaChange.toFixed(2)}% while market stable (${ounceChange.toFixed(2)}%)`,
      };
    }

    // If market moved and noghresea followed → market-driven
    if (
      Math.abs(ounceChange) > 0.15 && // Lowered from 0.3%
      Math.sign(ounceChange) === Math.sign(noghreseaChange)
    ) {
      return {
        type: PatternType.MARKET_DRIVEN,
        confidence: 60,
        description: `Market-driven: ounce ${ounceChange > 0 ? "+" : ""}${ounceChange.toFixed(2)}%`,
      };
    }

    return null;
  }

  private detectRecovery(prices: NoghreseaPrice[]): DetectedPattern | null {
    if (prices.length < 5) return null;

    // Check if there was a drop followed by recovery
    const p0 = Number(prices[0].price);
    const p1 = Number(prices[1].price);
    const p2 = Number(prices[2].price);
    const p3 = Number(prices[3].price);

    // Pattern: drop-drop-rise-rise
    if (p3 > p2 && p2 < p1 && p1 < p0) {
      const recoveryAmount = p0 - p2;
      const dropAmount = p3 - p2;
      const recoveryPercent = (recoveryAmount / dropAmount) * 100;

      if (recoveryPercent > 50) {
        return {
          type: PatternType.RECOVERY,
          confidence: Math.min(50 + recoveryPercent * 0.3, 85),
          description: `Recovery detected: ${recoveryPercent.toFixed(0)}% of drop recovered`,
        };
      }
    }

    return null;
  }

  /**
   * Detect DROP_BOTTOM pattern - THE MOST IMPORTANT FOR BUYING!
   * This detects when a drop sequence ends (first rise after multiple drops)
   * This is the optimal BUY moment after manipulation drops
   */
  private detectDropBottom(prices: NoghreseaPrice[]): DetectedPattern | null {
    if (prices.length < 4) return null;

    // prices[0] is latest, prices[1] is previous, etc.
    const latestChange = Number(prices[0].changeFromPrev);
    const p0 = Number(prices[0].price);
    const p1 = Number(prices[1].price);
    const p2 = Number(prices[2].price);
    const p3 = Number(prices[3].price);

    // Count how many drops happened before this rise
    let priorDrops = 0;
    let totalDropAmount = 0;

    for (let i = 1; i < Math.min(prices.length, 10); i++) {
      const change = Number(prices[i].changeFromPrev);
      if (change < 0) {
        priorDrops++;
        totalDropAmount += Math.abs(change);
      } else {
        break; // Stop at first rise in history
      }
    }

    // Pattern: Latest price ROSE, but previous 3+ prices were drops
    // This means: the drop sequence just ended, price is starting to rise = BUY NOW!
    if (latestChange > 0 && priorDrops >= 3) {
      // Calculate total drop percentage
      const highestRecentPrice = Math.max(p1, p2, p3);
      const lowestPrice = Math.min(p0, p1, p2, p3);
      const totalDropPercent =
        ((highestRecentPrice - lowestPrice) / highestRecentPrice) * 100;

      // High confidence if significant drop preceded this rise
      const confidence = Math.min(
        60 + priorDrops * 8 + totalDropPercent * 3,
        95,
      );

      this.logger.log(
        `🎯 DROP_BOTTOM DETECTED! ${priorDrops} prior drops (${totalDropAmount.toFixed(2)} total), now rising. Confidence: ${confidence.toFixed(1)}%`,
      );

      return {
        type: PatternType.DROP_BOTTOM,
        confidence,
        description: `Bottom detected after ${priorDrops} drops (total: -${totalDropAmount.toFixed(2)}). First rise = BUY signal!`,
      };
    }

    return null;
  }

  private calculateOverallAnalysis(
    patterns: DetectedPattern[],
    recentPrices: NoghreseaPrice[],
  ): PatternAnalysis {
    if (patterns.length === 0) {
      // Calculate a baseline confidence based on data quality
      // Even without patterns, we have some confidence in our analysis
      const dataPoints = recentPrices.length;
      const baselineConfidence = Math.min(dataPoints * 3, 25); // Max 25% baseline

      return {
        detected: false,
        patterns: [],
        overallConfidence: baselineConfidence,
        suggestion: "HOLD",
      };
    }

    // Calculate weighted confidence
    const maxConfidence = Math.max(...patterns.map((p) => p.confidence));
    const avgConfidence =
      patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    const overallConfidence = maxConfidence * 0.7 + avgConfidence * 0.3;

    // Determine suggestion based on patterns
    let suggestion: "BUY" | "SELL" | "HOLD" = "HOLD";

    const hasMultiBearish = patterns.some(
      (p) => p.type === PatternType.MULTI_BEARISH,
    );
    const hasMultiBullish = patterns.some(
      (p) => p.type === PatternType.MULTI_BULLISH,
    );
    const hasManipulation = patterns.some(
      (p) => p.type === PatternType.MANIPULATION,
    );
    const hasRecovery = patterns.some((p) => p.type === PatternType.RECOVERY);
    const hasSuddenDrop = patterns.some(
      (p) => p.type === PatternType.SUDDEN_DROP,
    );
    const hasSuddenSpike = patterns.some(
      (p) => p.type === PatternType.SUDDEN_SPIKE,
    );
    const hasDropBottom = patterns.some(
      (p) => p.type === PatternType.DROP_BOTTOM,
    );

    // Decision logic - ORDER MATTERS! Check most actionable patterns first

    // 1. DROP_BOTTOM is the #1 BUY signal - first rise after drop sequence
    if (hasDropBottom) {
      suggestion = "BUY";
      this.logger.log("💚 DROP_BOTTOM detected → BUY signal!");
    }
    // 2. Recovery after manipulation → BUY
    else if (hasRecovery) {
      suggestion = "BUY";
    }
    // 3. Multi-bearish WITHOUT manipulation → market is falling, SELL
    else if (hasMultiBearish && !hasManipulation) {
      suggestion = "SELL";
    }
    // 4. Multi-bearish WITH manipulation → wait for bottom (will trigger DROP_BOTTOM)
    else if (hasMultiBearish && hasManipulation) {
      suggestion = "HOLD"; // Wait for DROP_BOTTOM signal
    }
    // 5. Sudden spike → take profit, SELL
    else if (hasSuddenSpike) {
      suggestion = "SELL";
    }
    // 6. Multi-bullish rising → might be time to SELL at peak
    else if (hasMultiBullish) {
      suggestion = "HOLD"; // Wait for peak confirmation
    }
    // 7. Sudden drop with manipulation → BUY opportunity coming
    else if (hasSuddenDrop && hasManipulation) {
      suggestion = "HOLD"; // Wait for bottom
    }

    return {
      detected: true,
      patterns,
      overallConfidence,
      suggestion,
    };
  }

  private async savePatternEvent(analysis: PatternAnalysis, prices: AllPrices) {
    const mainPattern = analysis.patterns.reduce((prev, curr) =>
      curr.confidence > prev.confidence ? curr : prev,
    );

    const event = this.patternEventRepo.create({
      patternType: mainPattern.type,
      confidence: analysis.overallConfidence,
      noghreseaPrice: prices.noghresea?.price || 0,
      silverOuncePrice: prices.silverOunce || 0,
      goldOuncePrice: prices.goldOunce || 0,
      usdtTomanPrice: prices.usdtToman || 0,
      contextData: {
        patterns: analysis.patterns,
        suggestion: analysis.suggestion,
      },
      detectedAt: new Date(),
    });

    await this.patternEventRepo.save(event);
    return event;
  }

  async getRecentPatterns(hours: number = 24): Promise<PatternEvent[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.patternEventRepo
      .createQueryBuilder("p")
      .where("p.detectedAt >= :since", { since })
      .orderBy("p.detectedAt", "DESC")
      .getMany();
  }
}
