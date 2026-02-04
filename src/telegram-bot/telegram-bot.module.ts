import { Module, forwardRef } from "@nestjs/common";
import { TelegramBotService } from "./telegram-bot.service";
import { NoghreseaModule } from "../noghresea/noghresea.module";

@Module({
  imports: [forwardRef(() => NoghreseaModule)],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
