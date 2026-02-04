import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum PriceSource {
  SILVER_OUNCE = "SILVER_OUNCE",
  GOLD_OUNCE = "GOLD_OUNCE",
  USDT_TOMAN = "USDT_TOMAN",
}

@Entity("price_snapshots")
@Index(["source", "fetchedAt"])
export class PriceSnapshot {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "enum", enum: PriceSource })
  source: PriceSource;

  @Column({ type: "decimal", precision: 20, scale: 6 })
  price: number;

  @Column({ length: 10 })
  currency: string;

  @Column({ type: "timestamp", name: "fetched_at" })
  fetchedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
