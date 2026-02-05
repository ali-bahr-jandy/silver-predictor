import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { WallexService } from "./sources/wallex.service";
import { MetalsService } from "./sources/metals.service";
import { NoghreseaApiService } from "../noghresea/noghresea-api.service";
import {
  PriceSnapshot,
  PriceSource,
} from "../database/entities/price-snapshot.entity";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";

export interface AllPrices {
  noghresea: NoghreseaPrice | null;
  silverOunce: number | null;
  goldOunce: number | null;
  usdtToman: number | null;
  fetchedAt: Date;
}

@Injectable()
export class PriceFetcherService {
  private readonly logger = new Logger(PriceFetcherService.name);
  private lastPrices: AllPrices | null = null;

  constructor(
    private wallexService: WallexService,
    private metalsService: MetalsService,
    private noghreseaApi: NoghreseaApiService,
    @InjectRepository(PriceSnapshot)
    private priceSnapshotRepo: Repository<PriceSnapshot>,
  ) {}

  async fetchAllPrices(): Promise<AllPrices> {
    const fetchedAt = new Date();

    // Fetch all prices in parallel
    const [noghresea, metals, wallex] = await Promise.all([
      this.noghreseaApi.fetchAndStorePriceSnapshot(),
      this.metalsService.getMetalPrices(),
      this.wallexService.getUsdtTomanPrice(),
    ]);

    // Store external prices in snapshots
    const snapshots: PriceSnapshot[] = [];

    if (metals?.silverOunce) {
      snapshots.push(
        this.priceSnapshotRepo.create({
          source: PriceSource.SILVER_OUNCE,
          price: metals.silverOunce,
          currency: "USD",
          fetchedAt,
        }),
      );
    }

    if (metals?.goldOunce) {
      snapshots.push(
        this.priceSnapshotRepo.create({
          source: PriceSource.GOLD_OUNCE,
          price: metals.goldOunce,
          currency: "USD",
          fetchedAt,
        }),
      );
    }

    if (wallex?.usdtToman) {
      snapshots.push(
        this.priceSnapshotRepo.create({
          source: PriceSource.USDT_TOMAN,
          price: wallex.usdtToman,
          currency: "TOMAN",
          fetchedAt,
        }),
      );
    }

    if (snapshots.length > 0) {
      await this.priceSnapshotRepo.save(snapshots);
    }

    // If we have Noghresea price and USDT but no international silver,
    // calculate an estimated international price for reference
    let silverOunce = metals?.silverOunce || null;
    let silverIsEstimated = metals?.isEstimated || false;

    // Always calculate from Noghresea if we don't have a real price
    if (
      (!silverOunce || silverIsEstimated) &&
      noghresea?.price &&
      wallex?.usdtToman
    ) {
      const calculatedSilver =
        this.metalsService.calculateInternationalSilverFromNoghresea(
          noghresea.price,
          wallex.usdtToman,
        );

      // Use calculated price if we don't have one, or if it's more recent
      if (!silverOunce) {
        silverOunce = calculatedSilver;
        silverIsEstimated = true;
      }
    }

    this.lastPrices = {
      noghresea,
      silverOunce,
      goldOunce: metals?.goldOunce || null,
      usdtToman: wallex?.usdtToman || null,
      fetchedAt,
    };

    const silverSource = silverIsEstimated ? "(est)" : "";
    this.logger.log(
      `💰 Prices: Noghresea=${noghresea?.price?.toFixed(2)}, Silver=$${silverOunce?.toFixed(2)}${silverSource}, Gold=$${this.lastPrices.goldOunce?.toFixed(2) || "N/A"}, USDT=${wallex?.usdtToman}`,
    );

    return this.lastPrices;
  }

  getLastPrices(): AllPrices | null {
    return this.lastPrices;
  }

  async getRecentSnapshots(
    source: PriceSource,
    minutes: number = 30,
  ): Promise<PriceSnapshot[]> {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    return this.priceSnapshotRepo
      .createQueryBuilder("p")
      .where("p.source = :source", { source })
      .andWhere("p.fetchedAt >= :since", { since })
      .orderBy("p.fetchedAt", "DESC")
      .getMany();
  }
}
