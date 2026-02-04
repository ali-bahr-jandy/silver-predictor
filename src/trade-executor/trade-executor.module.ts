import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TradeExecutorService } from "./trade-executor.service";
import { TransactionService } from "./transaction.service";
import { TradeHistory } from "../database/entities/trade-history.entity";
import { WalletSnapshot } from "../database/entities/wallet-snapshot.entity";
import { AppSettings } from "../database/entities/app-settings.entity";
import { Transaction } from "../database/entities/transaction.entity";
import { NoghreseaModule } from "../noghresea/noghresea.module";
import { TelegramBotModule } from "../telegram-bot/telegram-bot.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradeHistory,
      WalletSnapshot,
      AppSettings,
      Transaction,
    ]),
    NoghreseaModule,
    forwardRef(() => TelegramBotModule),
  ],
  providers: [TradeExecutorService, TransactionService],
  exports: [TradeExecutorService, TransactionService],
})
export class TradeExecutorModule {}
