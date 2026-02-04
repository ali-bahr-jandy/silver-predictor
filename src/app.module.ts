import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";

import { NoghreseaModule } from "./noghresea/noghresea.module";
import { PriceFetcherModule } from "./price-fetcher/price-fetcher.module";
import { PatternAnalyzerModule } from "./pattern-analyzer/pattern-analyzer.module";
import { AiDecisionModule } from "./ai-decision/ai-decision.module";
import { TradeExecutorModule } from "./trade-executor/trade-executor.module";
import { TelegramBotModule } from "./telegram-bot/telegram-bot.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { AnalysisModule } from "./analysis/analysis.module";
import { HealthModule } from "./health/health.module";

import { PriceSnapshot } from "./database/entities/price-snapshot.entity";
import { NoghreseaPrice } from "./database/entities/noghresea-price.entity";
import { PatternEvent } from "./database/entities/pattern-event.entity";
import { TradeHistory } from "./database/entities/trade-history.entity";
import { WalletSnapshot } from "./database/entities/wallet-snapshot.entity";
import { AppSettings } from "./database/entities/app-settings.entity";
import { AuthState } from "./database/entities/auth-state.entity";
import { AiDecision } from "./database/entities/ai-decision.entity";
import { DailySummary } from "./database/entities/daily-summary.entity";
import { Transaction } from "./database/entities/transaction.entity";
import { validate } from "./common/env.validation";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      validate,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        host: configService.get("DB_HOST", "localhost"),
        port: configService.get("DB_PORT", 5432),
        username: configService.get("DB_USERNAME", "postgres"),
        password: configService.get("DB_PASSWORD", "postgres"),
        database: configService.get("DB_NAME", "silver_predictor"),
        entities: [
          PriceSnapshot,
          NoghreseaPrice,
          PatternEvent,
          TradeHistory,
          WalletSnapshot,
          AppSettings,
          AuthState,
          AiDecision,
          DailySummary,
          Transaction,
        ],
        // WARNING: synchronize should be false in production!
        // Use migrations instead: npm run migration:generate -- -n MigrationName
        synchronize: process.env.NODE_ENV !== "production",
        logging: process.env.DB_LOGGING === "true",
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    NoghreseaModule,
    PriceFetcherModule,
    PatternAnalyzerModule,
    AiDecisionModule,
    TradeExecutorModule,
    TelegramBotModule,
    SchedulerModule,
    AnalysisModule,
    HealthModule,
  ],
})
export class AppModule {}
