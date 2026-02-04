import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("noghresea_prices")
@Index(["recordedAt"])
export class NoghreseaPrice {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "decimal", precision: 10, scale: 4 })
  price: number;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    name: "change_24h",
    nullable: true,
  })
  change24h: number;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 4,
    name: "change_from_prev",
    nullable: true,
  })
  changeFromPrev: number;

  @Column({
    type: "decimal",
    precision: 8,
    scale: 6,
    name: "change_percent",
    nullable: true,
  })
  changePercent: number;

  @Column({ type: "integer", name: "seconds_since_last", nullable: true })
  secondsSinceLast: number;

  @Column({ type: "timestamp", name: "recorded_at" })
  recordedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
