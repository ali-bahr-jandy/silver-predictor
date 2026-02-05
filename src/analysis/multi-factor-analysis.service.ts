import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThan } from "typeorm";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";
import { PriceSnapshot } from "../database/entities/price-snapshot.entity";
import {
  AllPrices,
  PriceFetcherService,
} from "../price-fetcher/price-fetcher.service";

export interface MultiFactorAnalysis {
  // Individual factor scores (0-100)
  silverCorrelationScore: number;
  goldCorrelationScore: number;
  usdtImpactScore: number;
  manipulationScore: number;

  // Combined analysis
  overallScore: number;
  marketDirection: "BULLISH" | "BEARISH" | "NEUTRAL";
  isManipulated: boolean;
  manipulationType: "FAKE_DROP" | "FAKE_RISE" | "NONE";

  // Confidence adjustment
  confidenceBoost: number; // How much to boost/reduce the pattern analyzer confidence

  // Detailed reasoning
  factors: FactorDetail[];
}

export interface FactorDetail {
  factor: string;
  score: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  description: string;
  weight: number;
}

@Injectable()
export class MultiFactorAnalysisService {
  private readonly logger = new Logger(MultiFactorAnalysisService.name);

  // Weights for each factor (total = 100)
  private readonly WEIGHTS = {
    SILVER_CORRELATION: 35, // International silver price correlation
    GOLD_CORRELATION: 20, // Gold price as leading indicator
    USDT_IMPACT: 25, // USDT/Toman rate impact (currency factor)
    MANIPULATION: 20, // Manipulation detection
  };

  constructor(
    @InjectRepository(NoghreseaPrice)
    private noghreseaPriceRepo: Repository<NoghreseaPrice>,
    @InjectRepository(PriceSnapshot)
    private priceSnapshotRepo: Repository<PriceSnapshot>,
    private priceFetcher: PriceFetcherService,
  ) {}

  async analyze(prices: AllPrices): Promise<MultiFactorAnalysis> {
    const factors: FactorDetail[] = [];

    // Get historical data for analysis
    const lookbackMinutes = 15;
    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);

    // 1. Silver Correlation Analysis
    const silverAnalysis = await this.analyzeSilverCorrelation(prices, since);
    factors.push(silverAnalysis);

    // 2. Gold Correlation Analysis (leading indicator)
    const goldAnalysis = await this.analyzeGoldCorrelation(prices, since);
    factors.push(goldAnalysis);

    // 3. USDT/Toman Impact Analysis
    const usdtAnalysis = await this.analyzeUsdtImpact(prices, since);
    factors.push(usdtAnalysis);

    // 4. Manipulation Detection
    const manipulationAnalysis = await this.detectManipulation(
      prices,
      since,
      silverAnalysis,
      goldAnalysis,
    );
    factors.push(manipulationAnalysis);

    // Calculate overall score and direction
    const result = this.combineFactors(factors, manipulationAnalysis);

    this.logger.debug(
      `Multi-factor analysis: Score=${result.overallScore.toFixed(1)}, ` +
        `Direction=${result.marketDirection}, Manipulation=${result.isManipulated}`,
    );

    return result;
  }

  private async analyzeSilverCorrelation(
    prices: AllPrices,
    since: Date,
  ): Promise<FactorDetail> {
    try {
      // Get recent Noghresea prices
      const noghreseaPrices = await this.noghreseaPriceRepo.find({
        where: { recordedAt: MoreThan(since) },
        order: { recordedAt: "DESC" },
        take: 30,
      });

      // Get recent silver ounce prices
      const silverSnapshots = await this.priceSnapshotRepo.find({
        where: {
          source: "SILVER_OUNCE" as any,
          fetchedAt: MoreThan(since),
        },
        order: { fetchedAt: "DESC" },
        take: 30,
      });

      if (noghreseaPrices.length < 3 || silverSnapshots.length < 3) {
        return {
          factor: "SILVER_CORRELATION",
          score: 50,
          direction: "NEUTRAL",
          description: "Insufficient data for silver correlation analysis",
          weight: this.WEIGHTS.SILVER_CORRELATION,
        };
      }

      // Calculate price changes
      const noghreseaChange = this.calculatePriceChange(noghreseaPrices);
      const silverChange = this.calculateSnapshotChange(silverSnapshots);

      // Calculate correlation
      const correlation = this.calculateCorrelation(
        noghreseaChange,
        silverChange,
      );
      const sameDirection =
        Math.sign(noghreseaChange) === Math.sign(silverChange);

      let score: number;
      let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
      let description: string;

      // If international silver is rising significantly
      if (silverChange > 0.1) {
        score = sameDirection ? 70 + correlation * 30 : 30;
        direction = "BULLISH";
        description = `Intl silver UP ${silverChange.toFixed(2)}%, Noghresea ${sameDirection ? "following" : "diverging"} (${noghreseaChange.toFixed(2)}%)`;
      }
      // If international silver is falling significantly
      else if (silverChange < -0.1) {
        score = sameDirection ? 30 : 60 + Math.abs(correlation) * 20;
        direction = "BEARISH";
        description = `Intl silver DOWN ${silverChange.toFixed(2)}%, Noghresea ${sameDirection ? "following" : "diverging"} (${noghreseaChange.toFixed(2)}%)`;
      }
      // Silver stable
      else {
        score = 50;
        direction = "NEUTRAL";
        description = `Intl silver stable (${silverChange.toFixed(2)}%), Noghresea: ${noghreseaChange.toFixed(2)}%`;
      }

      return {
        factor: "SILVER_CORRELATION",
        score,
        direction,
        description,
        weight: this.WEIGHTS.SILVER_CORRELATION,
      };
    } catch (e: unknown) {
      const err = e as Error;
      this.logger.warn(`Silver correlation analysis failed: ${err.message}`);
      return {
        factor: "SILVER_CORRELATION",
        score: 50,
        direction: "NEUTRAL",
        description: "Analysis failed",
        weight: this.WEIGHTS.SILVER_CORRELATION,
      };
    }
  }

  private async analyzeGoldCorrelation(
    prices: AllPrices,
    since: Date,
  ): Promise<FactorDetail> {
    try {
      const goldSnapshots = await this.priceSnapshotRepo.find({
        where: {
          source: "GOLD_OUNCE" as any,
          fetchedAt: MoreThan(since),
        },
        order: { fetchedAt: "DESC" },
        take: 30,
      });

      const noghreseaPrices = await this.noghreseaPriceRepo.find({
        where: { recordedAt: MoreThan(since) },
        order: { recordedAt: "DESC" },
        take: 30,
      });

      if (goldSnapshots.length < 3 || noghreseaPrices.length < 3) {
        return {
          factor: "GOLD_CORRELATION",
          score: 50,
          direction: "NEUTRAL",
          description: "Insufficient data for gold correlation analysis",
          weight: this.WEIGHTS.GOLD_CORRELATION,
        };
      }

      const goldChange = this.calculateSnapshotChange(goldSnapshots);
      const noghreseaChange = this.calculatePriceChange(noghreseaPrices);

      // Gold often leads silver - if gold is moving, silver may follow
      let score: number;
      let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
      let description: string;

      if (goldChange > 0.15) {
        // Gold rising significantly - bullish signal for silver
        score = 75;
        direction = "BULLISH";
        description = `Gold UP ${goldChange.toFixed(2)}% - leading indicator for silver rise`;
      } else if (goldChange < -0.15) {
        // Gold falling - bearish signal
        score = 30;
        direction = "BEARISH";
        description = `Gold DOWN ${goldChange.toFixed(2)}% - leading indicator for silver drop`;
      } else {
        score = 50;
        direction = "NEUTRAL";
        description = `Gold stable (${goldChange.toFixed(2)}%)`;
      }

      return {
        factor: "GOLD_CORRELATION",
        score,
        direction,
        description,
        weight: this.WEIGHTS.GOLD_CORRELATION,
      };
    } catch (e) {
      return {
        factor: "GOLD_CORRELATION",
        score: 50,
        direction: "NEUTRAL",
        description: "Analysis failed",
        weight: this.WEIGHTS.GOLD_CORRELATION,
      };
    }
  }

  private async analyzeUsdtImpact(
    prices: AllPrices,
    since: Date,
  ): Promise<FactorDetail> {
    try {
      const usdtSnapshots = await this.priceSnapshotRepo.find({
        where: {
          source: "USDT_TOMAN" as any,
          fetchedAt: MoreThan(since),
        },
        order: { fetchedAt: "DESC" },
        take: 30,
      });

      const noghreseaPrices = await this.noghreseaPriceRepo.find({
        where: { recordedAt: MoreThan(since) },
        order: { recordedAt: "DESC" },
        take: 30,
      });

      if (usdtSnapshots.length < 3) {
        return {
          factor: "USDT_IMPACT",
          score: 50,
          direction: "NEUTRAL",
          description: "Insufficient USDT data",
          weight: this.WEIGHTS.USDT_IMPACT,
        };
      }

      const usdtChange = this.calculateSnapshotChange(usdtSnapshots);
      const noghreseaChange = this.calculatePriceChange(noghreseaPrices);

      // USDT/Toman rising means Toman weakening = silver price should rise
      // This is a currency effect, not real silver value change
      let score: number;
      let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
      let description: string;

      if (usdtChange > 0.2) {
        // Toman weakening (USDT rising)
        score = 70;
        direction = "BULLISH";
        description = `Toman weakening (USDT +${usdtChange.toFixed(2)}%) - nominal silver price should rise`;
      } else if (usdtChange < -0.2) {
        // Toman strengthening (USDT falling)
        score = 35;
        direction = "BEARISH";
        description = `Toman strengthening (USDT ${usdtChange.toFixed(2)}%) - nominal price pressure down`;
      } else {
        score = 50;
        direction = "NEUTRAL";
        description = `USDT stable (${usdtChange.toFixed(2)}%)`;
      }

      // Check for currency-driven vs real move
      if (
        Math.abs(usdtChange) > 0.1 &&
        Math.abs(noghreseaChange) > 0.1 &&
        Math.sign(usdtChange) === Math.sign(noghreseaChange)
      ) {
        description += " - price move appears currency-driven";
      }

      return {
        factor: "USDT_IMPACT",
        score,
        direction,
        description,
        weight: this.WEIGHTS.USDT_IMPACT,
      };
    } catch (e) {
      return {
        factor: "USDT_IMPACT",
        score: 50,
        direction: "NEUTRAL",
        description: "Analysis failed",
        weight: this.WEIGHTS.USDT_IMPACT,
      };
    }
  }

  private async detectManipulation(
    prices: AllPrices,
    since: Date,
    silverAnalysis: FactorDetail,
    goldAnalysis: FactorDetail,
  ): Promise<FactorDetail> {
    try {
      const noghreseaPrices = await this.noghreseaPriceRepo.find({
        where: { recordedAt: MoreThan(since) },
        order: { recordedAt: "DESC" },
        take: 30,
      });

      if (noghreseaPrices.length < 5) {
        return {
          factor: "MANIPULATION",
          score: 50,
          direction: "NEUTRAL",
          description: "Insufficient data for manipulation detection",
          weight: this.WEIGHTS.MANIPULATION,
        };
      }

      const noghreseaChange = this.calculatePriceChange(noghreseaPrices);
      const marketStable =
        silverAnalysis.direction === "NEUTRAL" &&
        goldAnalysis.direction === "NEUTRAL";

      // Count consecutive drops/rises
      let consecutiveDrops = 0;
      let consecutiveRises = 0;
      let totalDropAmount = 0;
      let totalRiseAmount = 0;

      for (const price of noghreseaPrices.slice(0, 10)) {
        const change = Number(price.changeFromPrev);
        if (change < -0.05) {
          // Drop > 0.05 Toman
          if (consecutiveRises === 0) {
            consecutiveDrops++;
            totalDropAmount += Math.abs(change);
          } else break;
        } else if (change > 0.05) {
          // Rise > 0.05 Toman
          if (consecutiveDrops === 0) {
            consecutiveRises++;
            totalRiseAmount += change;
          } else break;
        }
      }

      let score: number;
      let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
      let description: string;
      let manipulationType: "FAKE_DROP" | "FAKE_RISE" | "NONE" = "NONE";

      // FAKE DROP Detection:
      // Noghresea dropping significantly while international markets stable
      if (consecutiveDrops >= 3 && marketStable) {
        score = 80; // High confidence of manipulation
        direction = "BULLISH"; // Expect recovery
        manipulationType = "FAKE_DROP";
        description = `FAKE DROP: ${consecutiveDrops} consecutive drops (total: -${totalDropAmount.toFixed(2)}) while markets stable - expect recovery`;
      }
      // FAKE RISE Detection:
      // Noghresea rising while international markets stable or falling
      else if (
        consecutiveRises >= 3 &&
        marketStable &&
        goldAnalysis.direction !== "BULLISH"
      ) {
        score = 25; // Expect drop
        direction = "BEARISH";
        manipulationType = "FAKE_RISE";
        description = `FAKE RISE: ${consecutiveRises} consecutive rises (total: +${totalRiseAmount.toFixed(2)}) while markets stable - expect correction`;
      }
      // Single big move while market stable = likely manipulation
      else if (Math.abs(noghreseaChange) > 0.3 && marketStable) {
        if (noghreseaChange < 0) {
          score = 70;
          direction = "BULLISH";
          manipulationType = "FAKE_DROP";
          description = `Sudden drop ${noghreseaChange.toFixed(2)}% while markets stable - likely manipulation`;
        } else {
          score = 35;
          direction = "BEARISH";
          manipulationType = "FAKE_RISE";
          description = `Sudden rise ${noghreseaChange.toFixed(2)}% while markets stable - likely manipulation`;
        }
      }
      // No manipulation detected
      else {
        score = 50;
        direction = "NEUTRAL";
        description = "No clear manipulation pattern detected";
      }

      return {
        factor: "MANIPULATION",
        score,
        direction,
        description,
        weight: this.WEIGHTS.MANIPULATION,
      } as FactorDetail & { manipulationType: string };
    } catch (e) {
      return {
        factor: "MANIPULATION",
        score: 50,
        direction: "NEUTRAL",
        description: "Analysis failed",
        weight: this.WEIGHTS.MANIPULATION,
      };
    }
  }

  private combineFactors(
    factors: FactorDetail[],
    manipulationAnalysis: FactorDetail,
  ): MultiFactorAnalysis {
    // Calculate weighted overall score
    let totalWeight = 0;
    let weightedScore = 0;
    let bullishCount = 0;
    let bearishCount = 0;

    for (const factor of factors) {
      weightedScore += factor.score * factor.weight;
      totalWeight += factor.weight;

      if (factor.direction === "BULLISH") bullishCount++;
      else if (factor.direction === "BEARISH") bearishCount++;
    }

    const overallScore = weightedScore / totalWeight;

    // Determine market direction
    let marketDirection: "BULLISH" | "BEARISH" | "NEUTRAL";
    if (overallScore >= 60) {
      marketDirection = "BULLISH";
    } else if (overallScore <= 40) {
      marketDirection = "BEARISH";
    } else {
      marketDirection = "NEUTRAL";
    }

    // Extract manipulation info
    const manipFactor = manipulationAnalysis as FactorDetail & {
      manipulationType?: string;
    };
    const isManipulated = manipFactor.description.includes("FAKE");
    const manipulationType =
      (manipFactor as any).manipulationType ||
      (manipFactor.description.includes("FAKE_DROP")
        ? "FAKE_DROP"
        : manipFactor.description.includes("FAKE_RISE")
          ? "FAKE_RISE"
          : "NONE");

    // Calculate confidence boost/reduction
    let confidenceBoost = 0;
    if (isManipulated && manipulationType === "FAKE_DROP") {
      confidenceBoost = 20; // Boost BUY confidence
    } else if (isManipulated && manipulationType === "FAKE_RISE") {
      confidenceBoost = -15; // Reduce BUY confidence, boost SELL
    }

    return {
      silverCorrelationScore: factors.find(
        (f) => f.factor === "SILVER_CORRELATION",
      )!.score,
      goldCorrelationScore: factors.find(
        (f) => f.factor === "GOLD_CORRELATION",
      )!.score,
      usdtImpactScore: factors.find((f) => f.factor === "USDT_IMPACT")!.score,
      manipulationScore: manipulationAnalysis.score,
      overallScore,
      marketDirection,
      isManipulated,
      manipulationType: manipulationType as "FAKE_DROP" | "FAKE_RISE" | "NONE",
      confidenceBoost,
      factors,
    };
  }

  // Helper methods
  private calculatePriceChange(prices: NoghreseaPrice[]): number {
    if (prices.length < 2) return 0;
    const latest = Number(prices[0].price);
    const oldest = Number(prices[prices.length - 1].price);
    return ((latest - oldest) / oldest) * 100;
  }

  private calculateSnapshotChange(snapshots: PriceSnapshot[]): number {
    if (snapshots.length < 2) return 0;
    const latest = Number(snapshots[0].price);
    const oldest = Number(snapshots[snapshots.length - 1].price);
    return ((latest - oldest) / oldest) * 100;
  }

  private calculateCorrelation(change1: number, change2: number): number {
    // Simplified correlation: how similar are the changes
    if (Math.abs(change1) < 0.01 || Math.abs(change2) < 0.01) return 0;
    const ratio =
      Math.min(Math.abs(change1), Math.abs(change2)) /
      Math.max(Math.abs(change1), Math.abs(change2));
    const sameDirection = Math.sign(change1) === Math.sign(change2);
    return sameDirection ? ratio : -ratio;
  }
}
