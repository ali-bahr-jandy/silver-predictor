import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum TransactionType {
  DEPOSIT = "DEPOSIT",
  WITHDRAW = "WITHDRAW",
}

export enum TransactionStatus {
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

@Entity("transactions")
@Index(["createdAt"])
@Index(["type"])
@Index(["status"])
export class Transaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    type: "varchar",
    length: 20,
  })
  type: TransactionType;

  @Column({
    type: "varchar",
    length: 20,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: "decimal", precision: 15, scale: 2 })
  amount: number;

  @Column({ type: "varchar", length: 10, default: "TOMAN" })
  currency: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  externalId?: string; // ID from Noghresea

  @Column({ type: "varchar", length: 100, nullable: true })
  referenceCode?: string;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "text", nullable: true })
  metadata?: string; // JSON for extra data

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  balanceBefore?: number;

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  balanceAfter?: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: "timestamp", nullable: true })
  completedAt: Date;
}
