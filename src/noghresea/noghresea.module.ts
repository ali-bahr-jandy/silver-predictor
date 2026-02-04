import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NoghreseaApiService } from "./noghresea-api.service";
import { NoghreseaAuthService } from "./noghresea-auth.service";
import { BrowserSessionService } from "./browser-session.service";
import { AuthState } from "../database/entities/auth-state.entity";
import { NoghreseaPrice } from "../database/entities/noghresea-price.entity";
import { TelegramBotModule } from "../telegram-bot/telegram-bot.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthState, NoghreseaPrice]),
    forwardRef(() => TelegramBotModule),
  ],
  providers: [NoghreseaApiService, NoghreseaAuthService, BrowserSessionService],
  exports: [NoghreseaApiService, NoghreseaAuthService, BrowserSessionService],
})
export class NoghreseaModule {}
