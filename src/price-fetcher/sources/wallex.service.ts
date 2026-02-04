import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

export interface WallexPrice {
  usdtToman: number;
  timestamp: Date;
}

@Injectable()
export class WallexService {
  private readonly logger = new Logger(WallexService.name);
  private readonly baseUrl = "https://api.wallex.ir/v1";

  async getUsdtTomanPrice(): Promise<WallexPrice | null> {
    try {
      // Wallex API for USDT/TMN market
      const response = await axios.get(`${this.baseUrl}/markets`, {
        timeout: 5000,
      });

      const markets = response.data?.result?.symbols;
      if (markets && markets.USDTTMN) {
        const usdtMarket = markets.USDTTMN;
        const price = parseFloat(
          usdtMarket.stats?.lastPrice || usdtMarket.stats?.bidPrice,
        );

        if (price) {
          return {
            usdtToman: price,
            timestamp: new Date(),
          };
        }
      }

      // Fallback: try different endpoint
      const tickerResponse = await axios.get(
        `${this.baseUrl}/ticker/24hr?symbol=USDTTMN`,
      );
      if (tickerResponse.data?.result?.lastPrice) {
        return {
          usdtToman: parseFloat(tickerResponse.data.result.lastPrice),
          timestamp: new Date(),
        };
      }

      return null;
    } catch (error) {
      this.logger.error("Failed to get USDT/Toman from Wallex", error.message);
      return null;
    }
  }
}
