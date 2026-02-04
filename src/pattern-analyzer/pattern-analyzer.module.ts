import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PatternAnalyzerService } from "./pattern-analyzer.service";
import { PatternEvent } from "../database/entities/pattern-event.entity";
import { NoghreseaModule } from "../noghresea/noghresea.module";
import { PriceFetcherModule } from "../price-fetcher/price-fetcher.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([PatternEvent]),
    NoghreseaModule,
    PriceFetcherModule,
  ],
  providers: [PatternAnalyzerService],
  exports: [PatternAnalyzerService],
})
export class PatternAnalyzerModule {}
