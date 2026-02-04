import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("daily_summaries")
@Index(["date"], { unique: true })
export class DailySummary {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "date" })
  date: string; // YYYY-MM-DD format

  // Price Data
  @Column({ type: "decimal", precision: 12, scale: 4 })
  openPrice: number;

  @Column({ type: "decimal", precision: 12, scale: 4 })
  closePrice: number;

  @Column({ type: "decimal", precision: 12, scale: 4 })
  highPrice: number;

  @Column({ type: "decimal", precision: 12, scale: 4 })
  lowPrice: number;

  @Column({ type: "decimal", precision: 8, scale: 4 })
  priceChange: number; // Absolute change

  @Column({ type: "decimal", precision: 8, scale: 4 })
  priceChangePercent: number;

  // Volatility Metrics
  @Column({ type: "decimal", precision: 8, scale: 4 })
  volatility: number; // Standard deviation of price changes

  @Column({ type: "decimal", precision: 8, scale: 4 })
  range: number; // High - Low

  @Column({ type: "decimal", precision: 8, scale: 4 })
  rangePercent: number; // Range as % of open

  // International Silver Reference
  @Column({ type: "decimal", precision: 10, scale: 4, nullable: true })
  internationalSilverOpen: number;

  @Column({ type: "decimal", precision: 10, scale: 4, nullable: true })
  internationalSilverClose: number;

  @Column({ type: "decimal", precision: 8, scale: 4, nullable: true })
  internationalChangePercent: number;

  // Premium/Discount Analysis
  @Column({ type: "decimal", precision: 8, scale: 4, nullable: true })
  premiumToInternational: number; // How much above/below intl price (%)

  @Column({ type: "decimal", precision: 8, scale: 4, nullable: true })
  premiumChange: number; // Change in premium from previous day

  // Pattern Detection
  @Column({ type: "int", default: 0 })
  manipulationSignals: number; // Count of manipulation patterns detected

  @Column({ type: "simple-array", nullable: true })
  detectedPatterns: string[]; // ['sudden_spike', 'volume_anomaly', etc.]

  // Market Sentiment Indicators
  @Column({
    type: "varchar",
    length: 20,
    default: "neutral",
  })
  sentiment: "bullish" | "bearish" | "neutral" | "volatile";

  @Column({ type: "int", default: 0 })
  trendStrength: number; // 0-100, how strong is the current trend

  @Column({
    type: "varchar",
    length: 20,
    default: "sideways",
  })
  trendDirection: "up" | "down" | "sideways";

  // Trading Activity
  @Column({ type: "int", default: 0 })
  priceUpdates: number; // How many price changes during the day

  @Column({ type: "int", default: 0 })
  significantMoves: number; // Moves > 0.5%

  // Time-based Analysis
  @Column({ type: "varchar", length: 10, nullable: true })
  mostActiveHour: string; // HH:MM format

  @Column({ type: "decimal", precision: 8, scale: 4, nullable: true })
  morningChange: number; // 00:00-12:00 change %

  @Column({ type: "decimal", precision: 8, scale: 4, nullable: true })
  afternoonChange: number; // 12:00-18:00 change %

  @Column({ type: "decimal", precision: 8, scale: 4, nullable: true })
  eveningChange: number; // 18:00-24:00 change %

  // USDT/Toman Rate
  @Column({ type: "decimal", precision: 12, scale: 2, nullable: true })
  usdtOpen: number;

  @Column({ type: "decimal", precision: 12, scale: 2, nullable: true })
  usdtClose: number;

  @Column({ type: "decimal", precision: 8, scale: 4, nullable: true })
  usdtChangePercent: number;

  // AI Decision Summary
  @Column({ type: "int", default: 0 })
  aiDecisions: number; // Total AI decisions made

  @Column({ type: "int", default: 0 })
  buySignals: number;

  @Column({ type: "int", default: 0 })
  sellSignals: number;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  avgConfidence: number;

  // Raw data for GPT analysis
  @Column({ type: "text", nullable: true })
  gptPromptData: string; // JSON with all relevant data for GPT

  @Column({ type: "text", nullable: true })
  notes: string; // Human-readable summary

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: "timestamp", nullable: true })
  updatedAt: Date;
}
