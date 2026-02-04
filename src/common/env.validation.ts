import { plainToInstance } from "class-transformer";
import {
  IsString,
  IsOptional,
  IsNumber,
  validateSync,
  IsIn,
} from "class-validator";

class EnvironmentVariables {
  @IsString()
  TELEGRAM_BOT_TOKEN: string;

  @IsString()
  @IsOptional()
  TELEGRAM_CHAT_ID?: string;

  @IsString()
  OPENAI_API_KEY: string;

  @IsString()
  @IsOptional()
  OPENAI_MODEL?: string;

  @IsString()
  @IsOptional()
  DB_HOST?: string;

  @IsNumber()
  @IsOptional()
  DB_PORT?: number;

  @IsString()
  @IsOptional()
  DB_USERNAME?: string;

  @IsString()
  @IsOptional()
  DB_PASSWORD?: string;

  @IsString()
  @IsOptional()
  DB_NAME?: string;

  @IsString()
  @IsOptional()
  @IsIn(["development", "production", "test"])
  NODE_ENV?: string;

  @IsString()
  @IsOptional()
  GOLD_API_KEY?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((error) => {
        const constraints = error.constraints
          ? Object.values(error.constraints).join(", ")
          : "Unknown error";
        return `${error.property}: ${constraints}`;
      })
      .join("\n");

    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  return validatedConfig;
}
