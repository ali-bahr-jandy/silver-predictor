import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum PredictionAction {
  BUY = "BUY",
  SELL = "SELL",
  HOLD = "HOLD",
}

/**
 * AI Predictions Table - General access for all users
 * Stores all OpenAI predictions with 30-day retention
 */
@Entity("ai_predictions")
@Index(["createdAt"])
@Index(["action"])
export class AiPrediction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // AI Decision
  @Column({ type: "enum", enum: PredictionAction })
  action!: PredictionAction;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  confidence!: number;

  @Column({ type: "decimal", precision: 5, scale: 2, name: "volume_percent" })
  volumePercent!: number;

  @Column({ type: "text" })
  reasoning!: string;

  @Column({ type: "text", name: "expected_outcome" })
  expectedOutcome!: string;

  @Column({ type: "text", name: "raw_response", nullable: true })
  rawResponse!: string;

  // Market State at prediction time
  @Column({
    type: "decimal",
    precision: 12,
    scale: 2,
    name: "noghresea_price",
  })
  noghreseaPrice!: number;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    name: "silver_ounce_price",
    nullable: true,
  })
  silverOuncePrice!: number;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    name: "gold_ounce_price",
    nullable: true,
  })
  goldOuncePrice!: number;

  @Column({
    type: "decimal",
    precision: 12,
    scale: 0,
    name: "usdt_toman_price",
    nullable: true,
  })
  usdtTomanPrice!: number;

  // Pattern Analysis at prediction time
  @Column({ type: "jsonb", name: "detected_patterns", nullable: true })
  detectedPatterns!: object;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "pattern_confidence",
  })
  patternConfidence!: number;

  @Column({ type: "varchar", length: 10, name: "pattern_suggestion" })
  patternSuggestion!: string;

  // Multi-factor Analysis Scores
  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "silver_correlation_score",
    nullable: true,
  })
  silverCorrelationScore!: number;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "gold_correlation_score",
    nullable: true,
  })
  goldCorrelationScore!: number;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "usdt_impact_score",
    nullable: true,
  })
  usdtImpactScore!: number;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "manipulation_score",
    nullable: true,
  })
  manipulationScore!: number;

  // Outcome tracking (updated later when we know the result)
  @Column({
    type: "decimal",
    precision: 12,
    scale: 2,
    name: "actual_price_after_5min",
    nullable: true,
  })
  actualPriceAfter5min!: number;

  @Column({
    type: "decimal",
    precision: 12,
    scale: 2,
    name: "actual_price_after_10min",
    nullable: true,
  })
  actualPriceAfter10min!: number;

  @Column({ name: "was_prediction_correct", nullable: true })
  wasPredictionCorrect!: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  // Auto-delete after 30 days (handled by cleanup job)
  @Column({
    type: "timestamp",
    name: "expires_at",
    default: () => "NOW() + INTERVAL '30 days'",
  })
  expiresAt!: Date;
}
