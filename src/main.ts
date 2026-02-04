import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger("Bootstrap");

  const port = process.env.PORT || 3000;
  await app.listen(port);

  const url = await app.getUrl();
  logger.log(`🚀 Silver Predictor running on: ${url}`);
  logger.log(
    `📊 Polling interval: ${process.env.POLLING_INTERVAL_MS || 10000}ms`,
  );
  logger.log(
    `🎯 Confidence threshold: ${process.env.CONFIDENCE_THRESHOLD || 70}%`,
  );
}
bootstrap();
