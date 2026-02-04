import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { NoghreseaAuthService } from "./noghresea-auth.service";
import { BrowserSessionService } from "./browser-session.service";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";
import { TelegramBotService } from "../telegram-bot/telegram-bot.service";

export interface SilverPriceResponse {
  price: string;
  minOrderValue: number;
  minSellOrderValue: number;
  maxOrderValue: number;
  fee: { buy: number; sell: number };
  change24h: string;
}

export interface WalletResponse {
  totalDeposit: number;
  totalDepositGiftCard: number;
  totalWithdraw: number;
  totalWithdrawSilverenValue: number;
  totalWithdrawGiftCardValue: number;
}

export interface InventoryResponse {
  silverBalance: number; // Silver in grams (balance/1000)
  tomanBalance: number; // Toman balance
  silverBlocked: number; // Silver blocked in orders
  tomanBlocked: number; // Toman blocked in orders
}

export interface BalanceItem {
  _id?: string;
  asset: string;
  balance: number;
  blocked: number;
  loans?: any[];
}

export interface OrderHistoryItem {
  id: string;
  type: "buy" | "sell";
  price: number;
  volume: number;
  status: string;
  createdAt: string;
}

export interface UserDataResponse {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  fee: { buy: number; sell: number };
  verificationStatus: number;
}

export interface OrderResponse {
  message: string;
  orderId: string;
}

export interface HistoricalPrice {
  price: number;
  time: string;
  date: string;
  fullData: string;
  createdAt: string;
}

@Injectable()
export class NoghreseaApiService {
  private readonly logger = new Logger(NoghreseaApiService.name);
  private readonly baseUrl = "https://api.noghresea.ir";
  private readonly publicBaseUrl = "https://noghresea.ir";
  private lastPrice: number | null = null;
  private lastPriceTime: Date | null = null;

  constructor(
    private authService: NoghreseaAuthService,
    private browserSession: BrowserSessionService,
    @InjectRepository(NoghreseaPrice)
    private noghreseaPriceRepo: Repository<NoghreseaPrice>,
    @Inject(forwardRef(() => TelegramBotService))
    private telegramBot: TelegramBotService,
  ) {}

  private async handleAuthError() {
    await this.authService.invalidateToken();
    await this.telegramBot.sendAuthRequired();
  }

  /**
   * Make an authenticated API request with automatic auth error handling
   */
  private async makeAuthenticatedRequest<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: any,
  ): Promise<T | null> {
    if (!this.authService.isAuthenticated()) {
      this.logger.warn(`${endpoint}: Not authenticated`);
      return null;
    }

    const token = this.authService.getToken();

    try {
      const response = await this.browserSession.makeRequest(
        `${this.baseUrl}${endpoint}`,
        method,
        body,
        token || undefined,
      );

      // Check for auth error response
      if (
        response &&
        !Array.isArray(response) &&
        typeof response === "object" &&
        response.message
      ) {
        const msg = response.message as string;
        if (
          msg.includes("وارد پلتفرم") ||
          msg.includes("احراز هویت") ||
          msg.includes("login")
        ) {
          this.logger.warn(
            "🔐 Token rejected by API, requesting re-authentication...",
          );
          await this.handleAuthError();
          return null;
        }
      }

      return response;
    } catch (error: any) {
      this.logger.error(`Request failed for ${endpoint}: ${error.message}`);
      return null;
    }
  }

  async getSilverPrice(): Promise<SilverPriceResponse | null> {
    try {
      const response = await this.browserSession.makeRequest(
        `${this.baseUrl}/api/market/getSilverPrice`,
        "GET",
      );
      return response;
    } catch (error: any) {
      this.logger.error("Failed to get silver price", error.message);
      return null;
    }
  }

  async getWallet(): Promise<WalletResponse | null> {
    return this.makeAuthenticatedRequest<WalletResponse>(
      "/api/account/getWallet",
    );
  }

  async getInventory(): Promise<InventoryResponse | null> {
    const response = await this.makeAuthenticatedRequest<BalanceItem[]>(
      "/api/account/getBalances",
    );

    if (response && Array.isArray(response)) {
      // Find IRT (Toman) and SILVER balances
      const irtBalance = response.find(
        (item: BalanceItem) => item.asset === "IRT",
      );
      const silverBalance = response.find(
        (item: BalanceItem) => item.asset === "SILVER",
      );

      // Silver balance is in milligrams (divide by 1000 to get grams)
      const silverGrams = (silverBalance?.balance || 0) / 1000;
      const silverBlocked = (silverBalance?.blocked || 0) / 1000;

      this.logger.log(
        `💰 Balances: Toman=${irtBalance?.balance?.toLocaleString()}, Silver=${silverGrams.toFixed(2)}g`,
      );

      return {
        tomanBalance: irtBalance?.balance || 0,
        tomanBlocked: irtBalance?.blocked || 0,
        silverBalance: silverGrams,
        silverBlocked: silverBlocked,
      };
    }

    if (response) {
      this.logger.warn(`getBalances returned non-array: ${typeof response}`);
    }
    return null;
  }

  async getOrderHistory(limit: number = 20): Promise<OrderHistoryItem[]> {
    const response = await this.makeAuthenticatedRequest<
      { orders?: OrderHistoryItem[] } | OrderHistoryItem[]
    >(`/api/order/getOrders?limit=${limit}`);
    if (Array.isArray(response)) return response;
    return response?.orders || [];
  }

  async getUserData(): Promise<UserDataResponse | null> {
    return this.makeAuthenticatedRequest<UserDataResponse>(
      "/api/account/getUserData",
    );
  }

  async getHistoricalPrices(
    period: "day" | "week" | "month",
  ): Promise<HistoricalPrice[]> {
    try {
      const response = await this.browserSession.makeRequest(
        `${this.publicBaseUrl}/api/silverPrice/${period}`,
        "GET",
      );
      return response || [];
    } catch (error: any) {
      this.logger.error(`Failed to get ${period} prices`, error.message);
      return [];
    }
  }

  async createBuyOrder(
    price: number,
    volume: number,
  ): Promise<OrderResponse | null> {
    if (!this.authService.isAuthenticated()) {
      await this.telegramBot.sendAuthRequired();
      return null;
    }
    const token = this.authService.getToken();
    try {
      const response = await this.browserSession.makeRequest(
        `${this.baseUrl}/api/order/createOrder`,
        "POST",
        { price, type: "buy", volume, hasInsurance: true },
        token || undefined,
      );
      this.logger.log(`✅ BUY order created: ${volume}g @ ${price}`);
      return response;
    } catch (error: any) {
      this.logger.error("Failed to create buy order", error.message);
      return null;
    }
  }

  async createSellOrder(
    price: number,
    volume: number,
  ): Promise<OrderResponse | null> {
    if (!this.authService.isAuthenticated()) {
      await this.telegramBot.sendAuthRequired();
      return null;
    }
    const token = this.authService.getToken();
    try {
      const response = await this.browserSession.makeRequest(
        `${this.baseUrl}/api/order/createOrder`,
        "POST",
        { price, type: "sell", volume },
        token || undefined,
      );
      this.logger.log(`✅ SELL order created: ${volume}g @ ${price}`);
      return response;
    } catch (error: any) {
      this.logger.error("Failed to create sell order", error.message);
      return null;
    }
  }

  async fetchAndStorePriceSnapshot(): Promise<NoghreseaPrice | null> {
    const priceData = await this.getSilverPrice();
    if (!priceData) return null;

    const currentPrice = parseFloat(priceData.price);
    const now = new Date();

    let changeFromPrev = 0;
    let changePercent = 0;
    let secondsSinceLast = 0;

    if (this.lastPrice && this.lastPriceTime) {
      changeFromPrev = currentPrice - this.lastPrice;
      changePercent = (changeFromPrev / this.lastPrice) * 100;
      secondsSinceLast = Math.floor(
        (now.getTime() - this.lastPriceTime.getTime()) / 1000,
      );
    }

    const priceRecord = this.noghreseaPriceRepo.create({
      price: currentPrice,
      change24h: parseFloat(priceData.change24h) || 0,
      changeFromPrev,
      changePercent,
      secondsSinceLast,
      recordedAt: now,
    });

    await this.noghreseaPriceRepo.save(priceRecord);

    this.lastPrice = currentPrice;
    this.lastPriceTime = now;

    return priceRecord;
  }

  async getRecentPrices(minutes: number = 30): Promise<NoghreseaPrice[]> {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    return this.noghreseaPriceRepo
      .createQueryBuilder("p")
      .where("p.recordedAt >= :since", { since })
      .orderBy("p.recordedAt", "DESC")
      .getMany();
  }
}
