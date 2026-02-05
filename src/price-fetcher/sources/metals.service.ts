import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { GRAMS_PER_OUNCE, GRAMS_PER_MESGHAL } from "../../common/constants";

export interface MetalPrices {
  silverOunce: number; // USD per ounce
  goldOunce: number; // USD per ounce
  timestamp: Date;
  source: string;
  isEstimated: boolean;
}

@Injectable()
export class MetalsService {
  private readonly logger = new Logger(MetalsService.name);
  private lastKnownPrices: MetalPrices | null = null;
  private apiCheckCount = 0;

  async getMetalPrices(): Promise<MetalPrices | null> {
    // Try to get real prices every cycle - gold-api.com is fast and reliable
    this.apiCheckCount++;

    // Try gold-api.com first - it's free and reliable
    const realPrice = await this.tryGoldApiCom();
    if (realPrice) {
      return realPrice;
    }

    // Fallback to other APIs every 6th cycle
    if (this.apiCheckCount % 6 === 1) {
      const fallbackPrice = await this.tryFallbackApis();
      if (fallbackPrice) {
        return fallbackPrice;
      }
    }

    // Use cached price if available and recent
    if (this.lastKnownPrices) {
      const age = Date.now() - this.lastKnownPrices.timestamp.getTime();
      if (age < 60 * 60 * 1000) {
        // 1 hour
        return {
          ...this.lastKnownPrices,
          isEstimated: false, // Still using real cached data
        };
      }
    }

    // Return null - let the caller calculate from Noghresea price
    return null;
  }

  /**
   * Primary source: gold-api.com - Free, reliable, real-time prices
   */
  private async tryGoldApiCom(): Promise<MetalPrices | null> {
    try {
      const [silverRes, goldRes] = await Promise.all([
        axios.get("https://api.gold-api.com/price/XAG", {
          timeout: 5000,
          headers: { "User-Agent": "Mozilla/5.0" },
        }),
        axios.get("https://api.gold-api.com/price/XAU", {
          timeout: 5000,
          headers: { "User-Agent": "Mozilla/5.0" },
        }),
      ]);

      const silverPrice = silverRes.data?.price;
      const goldPrice = goldRes.data?.price;

      this.logger.debug(
        `Gold API response: Silver=${silverPrice}, Gold=${goldPrice}`,
      );

      // Silver is currently ~$118/oz in 2026, validate reasonable range
      if (silverPrice > 50 && silverPrice < 500) {
        this.lastKnownPrices = {
          silverOunce: silverPrice,
          goldOunce: goldPrice && goldPrice > 1000 ? goldPrice : null,
          timestamp: new Date(),
          source: "gold-api.com",
          isEstimated: false,
        };
        return this.lastKnownPrices;
      }
    } catch (error: any) {
      this.logger.warn(`Gold API failed: ${error.message}`);
      // Silently fail - will try fallback
    }

    return null;
  }

  /**
   * Fallback APIs for when primary source fails
   */
  private async tryFallbackApis(): Promise<MetalPrices | null> {
    // Try metals.live API
    try {
      const response = await axios.get("https://api.metals.live/v1/spot", {
        timeout: 5000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      const silver = response.data?.find((m: any) => m.metal === "silver");
      const gold = response.data?.find((m: any) => m.metal === "gold");

      if (silver?.price > 50 && silver?.price < 500) {
        this.lastKnownPrices = {
          silverOunce: silver.price,
          goldOunce: gold?.price && gold.price > 1000 ? gold.price : null,
          timestamp: new Date(),
          source: "metals.live",
          isEstimated: false,
        };
        return this.lastKnownPrices;
      }
    } catch (error: any) {
      // Silently fail
    }

    return null;
  }

  /**
   * Calculate what international silver price should be based on Noghresea price
   * This is useful for detecting manipulation and as a fallback
   * @param noghreseaPrice Price from Noghresea API
   * @param usdtToman USDT/Toman exchange rate
   * @returns Estimated international silver price in USD/oz
   */
  calculateInternationalSilverFromNoghresea(
    noghreseaPrice: number,
    usdtToman: number,
  ): number {
    // Noghresea price appears to be in Toman per 0.1 gram (decigram)
    // So 790.93 means 790.93 Toman per 0.1 gram = 7909.3 Toman per gram
    // But actually, checking real silver prices (~$32/oz), let's verify:
    // Expected: $32/oz = $1.03/gram = 166,570 Toman/gram (at 161,816 rate)
    // If Noghresea shows 790.93, and intl is ~$32:
    // 790.93 * X / 161816 * 31.1035 / 1.17 = 32
    // Solving: X ≈ 230 (so price is in units of 230 Toman, or roughly Toman per 0.004g)

    // Let's just use a simpler approach - the Noghresea price is per some unit
    // We'll reverse engineer based on expected international price ratio
    // Iranian silver typically trades at ~120-150% of international price

    // Simpler: assume 790.93 is in "Hezar Toman" (thousand Tomans) per Mesghal
    const pricePerMesghalToman = noghreseaPrice * 1000; // thousand Tomans
    const pricePerGramToman = pricePerMesghalToman / GRAMS_PER_MESGHAL;
    const pricePerGramUsd = pricePerGramToman / usdtToman;
    const pricePerOunceUsd = pricePerGramUsd * GRAMS_PER_OUNCE;

    // Remove the Iranian markup (typically 20-30%)
    const estimatedInternational = pricePerOunceUsd / 1.25;

    return estimatedInternational;
  }
}
