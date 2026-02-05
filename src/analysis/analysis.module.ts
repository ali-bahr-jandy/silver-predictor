import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DailyAnalysisService } from "./daily-analysis.service";
import { MultiFactorAnalysisService } from "./multi-factor-analysis.service";
import { AiPredictionService } from "./ai-prediction.service";
import { DailySummary } from "../database/entities/daily-summary.entity";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";
import { PriceSnapshot } from "../database/entities/price-snapshot.entity";
import { AiDecision } from "../database/entities/ai-decision.entity";
import { AiPrediction } from "../database/entities/ai-prediction.entity";
import { PriceFetcherModule } from "../price-fetcher/price-fetcher.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailySummary,
      NoghreseaPrice,
      PriceSnapshot,
      AiDecision,
      AiPrediction,
    ]),
    forwardRef(() => PriceFetcherModule),
  ],
  providers: [
    DailyAnalysisService,
    MultiFactorAnalysisService,
    AiPredictionService,
  ],
  exports: [
    DailyAnalysisService,
    MultiFactorAnalysisService,
    AiPredictionService,
  ],
})
export class AnalysisModule {}
