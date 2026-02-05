import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, LessThan, MoreThan, Between } from "typeorm";
import { Cron } from "@nestjs/schedule";
import {
  AiPrediction,
  PredictionAction,
} from "../database/entities/ai-prediction.entity";
import { AllPrices } from "../price-fetcher/price-fetcher.service";
import { PatternAnalysis } from "../pattern-analyzer/pattern-analyzer.service";
import { MultiFactorAnalysis } from "./multi-factor-analysis.service";
import { AiDecision } from "../ai-decision/ai-decision.service";

@Injectable()
export class AiPredictionService {
  private readonly logger = new Logger(AiPredictionService.name);

  constructor(
    @InjectRepository(AiPrediction)
    private predictionRepo: Repository<AiPrediction>,
  ) {}

  /**
   * Save an AI prediction with all market context
   */
  async savePrediction(
    decision: AiDecision,
    prices: AllPrices,
    patternAnalysis: PatternAnalysis,
    multiFactorAnalysis?: MultiFactorAnalysis,
  ): Promise<AiPrediction> {
    const prediction = new AiPrediction();
    prediction.action = decision.action as PredictionAction;
    prediction.confidence = decision.confidence;
    prediction.volumePercent = decision.volumePercent;
    prediction.reasoning = decision.reasoning;
    prediction.expectedOutcome = decision.expectedOutcome;
    prediction.rawResponse = decision.rawResponse || "";

    // Market state
    prediction.noghreseaPrice = prices.noghresea?.price || 0;
    prediction.silverOuncePrice = prices.silverOunce ?? 0;
    prediction.goldOuncePrice = prices.goldOunce ?? 0;
    prediction.usdtTomanPrice = prices.usdtToman ?? 0;

    // Pattern analysis
    prediction.detectedPatterns = patternAnalysis.patterns.map((p) => ({
      type: p.type,
      confidence: p.confidence,
      description: p.description,
    }));
    prediction.patternConfidence = patternAnalysis.overallConfidence;
    prediction.patternSuggestion = patternAnalysis.suggestion;

    // Multi-factor scores
    prediction.silverCorrelationScore =
      multiFactorAnalysis?.silverCorrelationScore ?? 0;
    prediction.goldCorrelationScore =
      multiFactorAnalysis?.goldCorrelationScore ?? 0;
    prediction.usdtImpactScore = multiFactorAnalysis?.usdtImpactScore ?? 0;
    prediction.manipulationScore = multiFactorAnalysis?.manipulationScore ?? 0;

    await this.predictionRepo.save(prediction);
    this.logger.log(
      `Saved AI prediction: ${decision.action} @ ${decision.confidence}% confidence`,
    );

    return prediction;
  }

  /**
   * Update prediction with actual price outcome (called later)
   */
  async updatePredictionOutcome(
    predictionId: string,
    actualPrice5min: number,
    actualPrice10min: number,
    currentPrice: number,
  ): Promise<void> {
    const prediction = await this.predictionRepo.findOne({
      where: { id: predictionId },
    });

    if (!prediction) return;

    prediction.actualPriceAfter5min = actualPrice5min;
    prediction.actualPriceAfter10min = actualPrice10min;

    // Determine if prediction was correct
    const initialPrice = Number(prediction.noghreseaPrice);
    const priceChange10min =
      ((actualPrice10min - initialPrice) / initialPrice) * 100;

    if (prediction.action === PredictionAction.BUY) {
      // BUY prediction correct if price went up
      prediction.wasPredictionCorrect = priceChange10min > 0.1;
    } else if (prediction.action === PredictionAction.SELL) {
      // SELL prediction correct if price went down
      prediction.wasPredictionCorrect = priceChange10min < -0.1;
    } else {
      // HOLD prediction correct if price stayed relatively stable
      prediction.wasPredictionCorrect = Math.abs(priceChange10min) < 0.3;
    }

    await this.predictionRepo.save(prediction);
  }

  /**
   * Get recent predictions for analysis
   */
  async getRecentPredictions(
    hours = 24,
    action?: PredictionAction,
  ): Promise<AiPrediction[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const where: any = { createdAt: MoreThan(since) };
    if (action) where.action = action;

    return this.predictionRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: 100,
    });
  }

  /**
   * Get prediction accuracy statistics
   */
  async getPredictionStats(days = 7): Promise<{
    totalPredictions: number;
    correctPredictions: number;
    accuracy: number;
    byAction: {
      action: string;
      total: number;
      correct: number;
      accuracy: number;
    }[];
    avgConfidence: number;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const predictions = await this.predictionRepo.find({
      where: {
        createdAt: MoreThan(since),
        wasPredictionCorrect: true, // Only get ones with outcome tracked
      },
    });

    const allPredictions = await this.predictionRepo.find({
      where: { createdAt: MoreThan(since) },
    });

    const withOutcome = allPredictions.filter(
      (p) => p.wasPredictionCorrect !== null,
    );
    const correct = withOutcome.filter((p) => p.wasPredictionCorrect === true);

    // By action breakdown
    const byAction = [
      PredictionAction.BUY,
      PredictionAction.SELL,
      PredictionAction.HOLD,
    ].map((action) => {
      const actionPreds = withOutcome.filter((p) => p.action === action);
      const actionCorrect = actionPreds.filter(
        (p) => p.wasPredictionCorrect === true,
      );
      return {
        action,
        total: actionPreds.length,
        correct: actionCorrect.length,
        accuracy:
          actionPreds.length > 0
            ? (actionCorrect.length / actionPreds.length) * 100
            : 0,
      };
    });

    const avgConfidence =
      allPredictions.length > 0
        ? allPredictions.reduce((sum, p) => sum + Number(p.confidence), 0) /
          allPredictions.length
        : 0;

    return {
      totalPredictions: allPredictions.length,
      correctPredictions: correct.length,
      accuracy:
        withOutcome.length > 0
          ? (correct.length / withOutcome.length) * 100
          : 0,
      byAction,
      avgConfidence,
    };
  }

  /**
   * Get predictions for prompt context (for future AI analysis)
   */
  async getPredictionsForPrompt(limit = 50): Promise<string> {
    const predictions = await this.predictionRepo.find({
      where: { wasPredictionCorrect: true }, // Only include ones with known outcomes
      order: { createdAt: "DESC" },
      take: limit,
    });

    if (predictions.length === 0) {
      return "No historical predictions with verified outcomes available.";
    }

    const lines = predictions.map((p) => {
      const outcome = p.wasPredictionCorrect ? "CORRECT" : "WRONG";
      const price5minChange = p.actualPriceAfter5min
        ? (
            ((Number(p.actualPriceAfter5min) - Number(p.noghreseaPrice)) /
              Number(p.noghreseaPrice)) *
            100
          ).toFixed(2)
        : "N/A";
      const price10minChange = p.actualPriceAfter10min
        ? (
            ((Number(p.actualPriceAfter10min) - Number(p.noghreseaPrice)) /
              Number(p.noghreseaPrice)) *
            100
          ).toFixed(2)
        : "N/A";

      return `- ${p.createdAt.toISOString().split("T")[0]} | ${p.action} @ ${Number(p.confidence).toFixed(0)}% | Price: ${Number(p.noghreseaPrice).toFixed(0)} | 5min: ${price5minChange}% | 10min: ${price10minChange}% | ${outcome}`;
    });

    return lines.join("\n");
  }

  /**
   * Get all predictions for the last 30 days (general access)
   */
  async getLast30DaysPredictions(): Promise<AiPrediction[]> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return this.predictionRepo.find({
      where: { createdAt: MoreThan(since) },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Cleanup old predictions (older than 30 days)
   * Runs daily at 3 AM
   */
  @Cron("0 3 * * *")
  async cleanupOldPredictions(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await this.predictionRepo.delete({
      createdAt: LessThan(thirtyDaysAgo),
    });

    if ((result.affected ?? 0) > 0) {
      this.logger.log(
        `Cleaned up ${result.affected} predictions older than 30 days`,
      );
    }
  }

  /**
   * Find similar historical predictions for pattern learning
   */
  async findSimilarPredictions(
    currentPatterns: string[],
    currentManipulationScore: number,
  ): Promise<AiPrediction[]> {
    // Get predictions with similar patterns
    const recentPredictions = await this.predictionRepo.find({
      where: {
        wasPredictionCorrect: true,
        manipulationScore: Between(
          currentManipulationScore - 15,
          currentManipulationScore + 15,
        ),
      },
      order: { createdAt: "DESC" },
      take: 20,
    });

    // Filter by similar patterns
    return recentPredictions.filter((p) => {
      if (!p.detectedPatterns) return false;
      const patterns = (p.detectedPatterns as any[]).map(
        (pat: any) => pat.type,
      );
      return currentPatterns.some((cp) => patterns.includes(cp));
    });
  }
}
