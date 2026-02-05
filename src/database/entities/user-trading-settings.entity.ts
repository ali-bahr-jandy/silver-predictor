import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * User Trading Settings - Per-user trading configuration
 * Stores user's trade amount preferences and active trading session
 */
@Entity("user_trading_settings")
@Index(["telegramChatId"], { unique: true })
export class UserTradingSettings {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "telegram_chat_id" })
  telegramChatId!: string;

  @Column({ name: "phone_number", nullable: true })
  phoneNumber!: string;

  // Trading Mode: "percentage" or "fixed_amount"
  @Column({
    type: "varchar",
    length: 20,
    name: "trade_mode",
    default: "percentage",
  })
  tradeMode!: "percentage" | "fixed_amount";

  // For percentage mode: % of total balance to trade
  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "trade_percent",
    default: 5,
  })
  tradePercent!: number;

  // For fixed_amount mode: Fixed silver grams to trade
  @Column({
    type: "decimal",
    precision: 12,
    scale: 4,
    name: "fixed_silver_grams",
    nullable: true,
  })
  fixedSilverGrams!: number;

  // Active Trading Session
  @Column({ name: "has_active_session", default: false })
  hasActiveSession!: boolean;

  // Session tracking - the amount we're working with in current sequence
  @Column({
    type: "decimal",
    precision: 12,
    scale: 4,
    name: "session_silver_amount",
    nullable: true,
  })
  sessionSilverAmount!: number; // Silver grams in current session

  @Column({
    type: "decimal",
    precision: 20,
    scale: 2,
    name: "session_toman_amount",
    nullable: true,
  })
  sessionTomanAmount!: number; // Toman in current session (after selling)

  // Track current position: "silver" or "toman"
  @Column({
    type: "varchar",
    length: 10,
    name: "current_position",
    default: "silver",
  })
  currentPosition!: "silver" | "toman";

  // Session statistics
  @Column({ name: "session_trade_count", default: 0 })
  sessionTradeCount!: number;

  @Column({
    type: "decimal",
    precision: 12,
    scale: 4,
    name: "session_initial_silver",
    nullable: true,
  })
  sessionInitialSilver!: number;

  @Column({
    type: "decimal",
    precision: 20,
    scale: 2,
    name: "session_initial_toman_value",
    nullable: true,
  })
  sessionInitialTomanValue!: number;

  @Column({ type: "timestamp", name: "session_started_at", nullable: true })
  sessionStartedAt!: Date;

  // Loss protection: If session loses more than X%, stop trading
  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "max_loss_percent",
    default: 10,
  })
  maxLossPercent!: number;

  // Auto trading enabled
  @Column({ name: "auto_trading_enabled", default: true })
  autoTradingEnabled!: boolean;

  // Minimum confidence required to execute trade
  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "min_confidence",
    default: 70,
  })
  minConfidence!: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
