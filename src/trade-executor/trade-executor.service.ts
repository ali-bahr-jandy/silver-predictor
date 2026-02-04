import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { NoghreseaApiService } from "../noghresea/noghresea-api.service";
import {
  TradeHistory,
  TradeAction,
} from "../database/entities/trade-history.entity";
import { WalletSnapshot } from "../database/entities/wallet-snapshot.entity";
import { AppSettings } from "../database/entities/app-settings.entity";
import { AiDecision } from "../ai-decision/ai-decision.service";
import { TelegramBotService } from "../telegram-bot/telegram-bot.service";

export interface WalletState {
  tomanBalance: number;
  silverBalance: number;
  totalDeposit: number;
  totalWithdraw: number;
}

@Injectable()
export class TradeExecutorService implements OnModuleInit {
  private readonly logger = new Logger(TradeExecutorService.name);
  private tradingEnabled = false; // Default to false until loaded from DB
  private settingsLoaded = false;
  private pausedUntil: Date | null = null;

  constructor(
    private configService: ConfigService,
    private noghreseaApi: NoghreseaApiService,
    @InjectRepository(TradeHistory)
    private tradeHistoryRepo: Repository<TradeHistory>,
    @InjectRepository(WalletSnapshot)
    private walletSnapshotRepo: Repository<WalletSnapshot>,
    @InjectRepository(AppSettings)
    private appSettingsRepo: Repository<AppSettings>,
    @Inject(forwardRef(() => TelegramBotService))
    private telegramBot: TelegramBotService,
  ) {}

  async onModuleInit() {
    await this.loadSettings();
  }

  private async loadSettings() {
    try {
      const setting = await this.appSettingsRepo.findOne({
        where: { settingKey: "trading_enabled" },
      });
      if (setting) {
        this.tradingEnabled =
          setting.settingValue === true || setting.settingValue === "true";
        this.logger.log(`📊 Loaded trading_enabled: ${this.tradingEnabled}`);
      } else {
        // No setting found, default to disabled for safety
        this.tradingEnabled = false;
        this.logger.log(
          "📊 No trading_enabled setting found, defaulting to DISABLED",
        );
      }
      this.settingsLoaded = true;
    } catch (e) {
      this.logger.warn("Could not load settings from DB");
      this.settingsLoaded = true;
    }
  }

  async getWalletState(): Promise<WalletState> {
    // Get actual balances from Noghresea
    const inventory = await this.noghreseaApi.getInventory();
    const wallet = await this.noghreseaApi.getWallet();

    const result = {
      tomanBalance: inventory?.tomanBalance || 0,
      silverBalance: inventory?.silverBalance || 0,
      totalDeposit: wallet?.totalDeposit || 0,
      totalWithdraw: wallet?.totalWithdraw || 0,
    };

    // Save snapshot
    try {
      const snapshot = this.walletSnapshotRepo.create({
        totalDeposit: result.totalDeposit,
        totalWithdraw: result.totalWithdraw,
        silverBalance: result.silverBalance,
        tomanBalance: result.tomanBalance,
        recordedAt: new Date(),
      });
      await this.walletSnapshotRepo.save(snapshot);
    } catch (e) {
      // Ignore snapshot errors
    }

    return result;
  }

  async executeTrade(
    decision: AiDecision,
    currentPrice: number,
    patternId?: string,
  ): Promise<TradeHistory | null> {
    // Check if trading is enabled
    if (!this.isTradingEnabled()) {
      this.logger.warn("Trading is disabled");
      return null;
    }

    // Check confidence threshold
    const threshold = parseInt(
      this.configService.get("CONFIDENCE_THRESHOLD", "70"),
    );
    if (decision.confidence < threshold) {
      this.logger.log(
        `Confidence ${decision.confidence}% below threshold ${threshold}%`,
      );

      // Notify if approaching threshold
      if (decision.confidence >= 80) {
        await this.telegramBot.sendApproachingThreshold(decision);
      }
      return null;
    }

    // Get wallet state
    const wallet = await this.getWalletState();

    // Calculate trade volume
    const maxTradePercent = parseInt(
      this.configService.get("MAX_TRADE_PERCENT", "5"),
    );
    const volumePercent = Math.min(decision.volumePercent, maxTradePercent);

    let volume: number;
    let totalValue: number;

    if (decision.action === "BUY") {
      // Calculate how much silver we can buy
      totalValue = wallet.tomanBalance * (volumePercent / 100);
      volume = totalValue / currentPrice;
    } else if (decision.action === "SELL") {
      // Calculate how much silver to sell
      volume = wallet.silverBalance * (volumePercent / 100);
      totalValue = volume * currentPrice;
    } else {
      return null; // HOLD
    }

    // Minimum order check
    if (totalValue < 100000) {
      this.logger.warn(`Trade value ${totalValue} below minimum 100000`);
      return null;
    }

    // Execute the order
    const fee = 0.01; // 1% fee
    let orderId: string | null = null;

    if (decision.action === "BUY") {
      const result = await this.noghreseaApi.createBuyOrder(
        currentPrice,
        Math.floor(volume),
      );
      orderId = result?.orderId || null;
    } else {
      const result = await this.noghreseaApi.createSellOrder(
        currentPrice,
        Math.floor(volume),
      );
      orderId = result?.orderId || null;
    }

    if (!orderId) {
      this.logger.error("Failed to execute order");
      await this.telegramBot.sendTradeError(decision, "Order execution failed");
      return null;
    }

    // Record trade
    const trade = this.tradeHistoryRepo.create({
      orderId,
      action: decision.action as TradeAction,
      volume: Math.floor(volume),
      price: currentPrice,
      totalValue,
      feePercent: fee,
      aiConfidence: decision.confidence,
      aiReasoning: decision.reasoning,
      patternId,
      executedAt: new Date(),
    });

    await this.tradeHistoryRepo.save(trade);

    // Notify via Telegram
    await this.telegramBot.sendTradeExecuted(trade, decision);

    this.logger.log(
      `✅ Trade executed: ${decision.action} ${volume}g @ ${currentPrice} (${orderId})`,
    );

    return trade;
  }

  isTradingEnabled(): boolean {
    // Don't allow trading until settings are loaded
    if (!this.settingsLoaded) return false;
    if (!this.tradingEnabled) return false;
    if (this.pausedUntil && new Date() < this.pausedUntil) return false;
    return true;
  }

  async enableTrading(): Promise<void> {
    this.tradingEnabled = true;
    this.pausedUntil = null;
    await this.saveSetting("trading_enabled", true);
    this.logger.log("Trading ENABLED");
  }

  async disableTrading(): Promise<void> {
    this.tradingEnabled = false;
    await this.saveSetting("trading_enabled", false);
    this.logger.log("Trading DISABLED");
  }

  async pauseTrading(minutes: number): Promise<void> {
    this.pausedUntil = new Date(Date.now() + minutes * 60 * 1000);
    this.logger.log(`Trading PAUSED until ${this.pausedUntil.toISOString()}`);
  }

  private async saveSetting(key: string, value: any): Promise<void> {
    let setting = await this.appSettingsRepo.findOne({
      where: { settingKey: key },
    });
    if (!setting) {
      setting = this.appSettingsRepo.create({ settingKey: key });
    }
    setting.settingValue = value;
    await this.appSettingsRepo.save(setting);
  }

  async getRecentTrades(limit: number = 10): Promise<TradeHistory[]> {
    return this.tradeHistoryRepo
      .createQueryBuilder("t")
      .orderBy("t.executedAt", "DESC")
      .limit(limit)
      .getMany();
  }

  getTradingStatus(): { enabled: boolean; pausedUntil: Date | null } {
    return {
      enabled: this.tradingEnabled,
      pausedUntil: this.pausedUntil,
    };
  }
}
