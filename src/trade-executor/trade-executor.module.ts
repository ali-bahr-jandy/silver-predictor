import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TradeExecutorService } from "./trade-executor.service";
import { TransactionService } from "./transaction.service";
import { UserTradingService } from "./user-trading.service";
import { TradeHistory } from "../database/entities/trade-history.entity";
import { WalletSnapshot } from "../database/entities/wallet-snapshot.entity";
import { AppSettings } from "../database/entities/app-settings.entity";
import { Transaction } from "../database/entities/transaction.entity";
import { UserTradingSettings } from "../database/entities/user-trading-settings.entity";
import { UserTradeHistory } from "../database/entities/user-trade-history.entity";
import { NoghreseaModule } from "../noghresea/noghresea.module";
import { TelegramBotModule } from "../telegram-bot/telegram-bot.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradeHistory,
      WalletSnapshot,
      AppSettings,
      Transaction,
      UserTradingSettings,
      UserTradeHistory,
    ]),
    NoghreseaModule,
    forwardRef(() => TelegramBotModule),
  ],
  providers: [TradeExecutorService, TransactionService, UserTradingService],
  exports: [TradeExecutorService, TransactionService, UserTradingService],
})
export class TradeExecutorModule {}
