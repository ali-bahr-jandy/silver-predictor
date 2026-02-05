import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum TradeSource {
  AI = "AI", // Automated by AI
  MANUAL = "MANUAL", // User executed manually via Telegram
  API = "API", // User executed via external API
}

export enum TradeStatus {
  PENDING = "PENDING",
  EXECUTED = "EXECUTED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

/**
 * User Trade History - Per-user trade records
 * Stores all buy/sell transactions for each user (AI or manual)
 */
@Entity("user_trade_history")
@Index(["telegramChatId", "executedAt"])
@Index(["phoneNumber"])
@Index(["source"])
@Index(["sessionId"])
export class UserTradeHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // User identification
  @Column({ name: "telegram_chat_id" })
  telegramChatId!: string;

  @Column({ name: "phone_number", nullable: true })
  phoneNumber!: string;

  // Trade details
  @Column({ type: "varchar", length: 10 })
  action!: "BUY" | "SELL";

  @Column({ type: "decimal", precision: 12, scale: 4, name: "silver_amount" })
  silverAmount!: number;

  @Column({ type: "decimal", precision: 12, scale: 2, name: "price_per_gram" })
  pricePerGram!: number;

  @Column({ type: "decimal", precision: 20, scale: 2, name: "total_toman" })
  totalToman!: number;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 4,
    name: "fee_percent",
    default: 0,
  })
  feePercent!: number;

  @Column({
    type: "decimal",
    precision: 20,
    scale: 2,
    name: "fee_amount",
    default: 0,
  })
  feeAmount!: number;

  // Source and status
  @Column({ type: "enum", enum: TradeSource })
  source!: TradeSource;

  @Column({ type: "enum", enum: TradeStatus, default: TradeStatus.PENDING })
  status!: TradeStatus;

  // Noghresea order reference
  @Column({ name: "noghresea_order_id", nullable: true })
  noghreseaOrderId!: string;

  // AI-specific fields (only when source = AI)
  @Column({ name: "ai_prediction_id", nullable: true })
  aiPredictionId!: string;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "ai_confidence",
    nullable: true,
  })
  aiConfidence!: number;

  @Column({ type: "text", name: "ai_reasoning", nullable: true })
  aiReasoning!: string;

  // Session tracking - links trades in a sequence
  @Column({ name: "session_id", nullable: true })
  sessionId!: string;

  @Column({ name: "session_sequence", nullable: true })
  sessionSequence!: number; // 1, 2, 3... in this session

  // Balances after trade
  @Column({
    type: "decimal",
    precision: 12,
    scale: 4,
    name: "silver_balance_after",
    nullable: true,
  })
  silverBalanceAfter!: number;

  @Column({
    type: "decimal",
    precision: 20,
    scale: 2,
    name: "toman_balance_after",
    nullable: true,
  })
  tomanBalanceAfter!: number;

  // Profit/Loss calculation
  @Column({
    type: "decimal",
    precision: 20,
    scale: 2,
    name: "profit_loss_toman",
    nullable: true,
  })
  profitLossToman!: number;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "profit_loss_percent",
    nullable: true,
  })
  profitLossPercent!: number;

  // Market state at trade time
  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    name: "silver_ounce_at_trade",
    nullable: true,
  })
  silverOunceAtTrade!: number;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    name: "gold_ounce_at_trade",
    nullable: true,
  })
  goldOunceAtTrade!: number;

  @Column({
    type: "decimal",
    precision: 12,
    scale: 0,
    name: "usdt_toman_at_trade",
    nullable: true,
  })
  usdtTomanAtTrade!: number;

  @Column({ type: "text", nullable: true })
  notes!: string;

  @Column({ type: "timestamp", name: "executed_at" })
  executedAt!: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
