import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiDecisionService } from "./ai-decision.service";
import { PromptBuilderService } from "./prompt-builder.service";
import { TradeHistory } from "../database/entities/trade-history.entity";
import { PatternEvent } from "../database/entities/pattern-event.entity";
import { WalletSnapshot } from "../database/entities/wallet-snapshot.entity";
import { NoghreseaModule } from "../noghresea/noghresea.module";
import { PatternAnalyzerModule } from "../pattern-analyzer/pattern-analyzer.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeHistory, PatternEvent, WalletSnapshot]),
    NoghreseaModule,
    PatternAnalyzerModule,
  ],
  providers: [AiDecisionService, PromptBuilderService],
  exports: [AiDecisionService],
})
export class AiDecisionModule {}
