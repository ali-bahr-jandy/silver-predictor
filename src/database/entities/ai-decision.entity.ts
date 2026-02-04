import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("ai_decisions")
@Index(["createdAt"])
export class AiDecision {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    type: "varchar",
    length: 10,
  })
  action: "buy" | "sell" | "hold";

  @Column({ type: "decimal", precision: 5, scale: 2 })
  confidence: number;

  @Column({ type: "decimal", precision: 12, scale: 4 })
  priceAtDecision: number;

  @Column({ type: "text", nullable: true })
  reasoning: string;

  @Column({ type: "text", nullable: true })
  marketContext: string;

  @Column({ type: "boolean", default: false })
  executed: boolean;

  @Column({ type: "uuid", nullable: true })
  tradeId: string;

  @CreateDateColumn()
  createdAt: Date;
}
