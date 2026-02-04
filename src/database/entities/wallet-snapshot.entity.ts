import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("wallet_snapshots")
export class WalletSnapshot {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "decimal", precision: 20, scale: 2, name: "total_deposit" })
  totalDeposit: number;

  @Column({ type: "decimal", precision: 20, scale: 2, name: "total_withdraw" })
  totalWithdraw: number;

  @Column({ type: "decimal", precision: 20, scale: 4, name: "silver_balance" })
  silverBalance: number;

  @Column({ type: "decimal", precision: 20, scale: 2, name: "toman_balance" })
  tomanBalance: number;

  @Column({ type: "timestamp", name: "recorded_at" })
  recordedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
