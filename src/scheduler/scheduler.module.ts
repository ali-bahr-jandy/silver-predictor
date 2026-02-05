import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SchedulerService } from "./scheduler.service";
import { PriceFetcherModule } from "../price-fetcher/price-fetcher.module";
import { PatternAnalyzerModule } from "../pattern-analyzer/pattern-analyzer.module";
import { AiDecisionModule } from "../ai-decision/ai-decision.module";
import { TradeExecutorModule } from "../trade-executor/trade-executor.module";
import { TelegramBotModule } from "../telegram-bot/telegram-bot.module";
import { NoghreseaModule } from "../noghresea/noghresea.module";
import { AnalysisModule } from "../analysis/analysis.module";
import { AuthState } from "../database/entities/auth-state.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthState]),
    PriceFetcherModule,
    PatternAnalyzerModule,
    AiDecisionModule,
    TradeExecutorModule,
    TelegramBotModule,
    NoghreseaModule,
    AnalysisModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
