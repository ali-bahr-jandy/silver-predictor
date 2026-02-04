import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PriceFetcherService } from "./price-fetcher.service";
import { WallexService } from "./sources/wallex.service";
import { MetalsService } from "./sources/metals.service";
import { PriceSnapshot } from "../database/entities/price-snapshot.entity";
import { NoghreseaModule } from "../noghresea/noghresea.module";

@Module({
  imports: [TypeOrmModule.forFeature([PriceSnapshot]), NoghreseaModule],
  providers: [PriceFetcherService, WallexService, MetalsService],
  exports: [PriceFetcherService, WallexService, MetalsService],
})
export class PriceFetcherModule {}
