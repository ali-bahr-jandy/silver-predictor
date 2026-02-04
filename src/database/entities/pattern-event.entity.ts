import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

export enum PatternType {
  MARKET_DRIVEN = "MARKET_DRIVEN",
  MANIPULATION = "MANIPULATION",
  MULTI_BEARISH = "MULTI_BEARISH",
  MULTI_BULLISH = "MULTI_BULLISH",
  RECOVERY = "RECOVERY",
  SUDDEN_DROP = "SUDDEN_DROP",
  SUDDEN_SPIKE = "SUDDEN_SPIKE",
  DROP_BOTTOM = "DROP_BOTTOM", // First rise after multiple drops - BUY signal
}

@Entity("pattern_events")
export class PatternEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "enum", enum: PatternType, name: "pattern_type" })
  patternType: PatternType;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  confidence: number;

  @Column({ type: "decimal", precision: 10, scale: 4, name: "noghresea_price" })
  noghreseaPrice: number;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 4,
    name: "silver_ounce_price",
    nullable: true,
  })
  silverOuncePrice: number;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 4,
    name: "gold_ounce_price",
    nullable: true,
  })
  goldOuncePrice: number;

  @Column({
    type: "decimal",
    precision: 20,
    scale: 2,
    name: "usdt_toman_price",
    nullable: true,
  })
  usdtTomanPrice: number;

  @Column({ type: "jsonb", name: "context_data", nullable: true })
  contextData: any;

  @Column({ type: "timestamp", name: "detected_at" })
  detectedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
