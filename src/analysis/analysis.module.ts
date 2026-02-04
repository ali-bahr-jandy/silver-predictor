import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DailyAnalysisService } from "./daily-analysis.service";
import { DailySummary } from "../database/entities/daily-summary.entity";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";
import { PriceSnapshot } from "../database/entities/price-snapshot.entity";
import { AiDecision } from "../database/entities/ai-decision.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailySummary,
      NoghreseaPrice,
      PriceSnapshot,
      AiDecision,
    ]),
  ],
  providers: [DailyAnalysisService],
  exports: [DailyAnalysisService],
})
export class AnalysisModule {}
