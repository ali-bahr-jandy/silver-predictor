import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { PatternEvent } from "./pattern-event.entity";

export enum TradeAction {
  BUY = "BUY",
  SELL = "SELL",
}

@Entity("trade_history")
export class TradeHistory {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "order_id", nullable: true })
  orderId: string;

  @Column({ type: "enum", enum: TradeAction })
  action: TradeAction;

  @Column({ type: "decimal", precision: 20, scale: 4 })
  volume: number;

  @Column({ type: "decimal", precision: 10, scale: 4 })
  price: number;

  @Column({ type: "decimal", precision: 20, scale: 2, name: "total_value" })
  totalValue: number;

  @Column({ type: "decimal", precision: 5, scale: 4, name: "fee_percent" })
  feePercent: number;

  @Column({ type: "decimal", precision: 5, scale: 2, name: "ai_confidence" })
  aiConfidence: number;

  @Column({ type: "text", name: "ai_reasoning", nullable: true })
  aiReasoning: string;

  @Column({ name: "pattern_id", nullable: true })
  patternId: string;

  @ManyToOne(() => PatternEvent, { nullable: true })
  @JoinColumn({ name: "pattern_id" })
  pattern: PatternEvent;

  @Column({ type: "timestamp", name: "executed_at" })
  executedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
