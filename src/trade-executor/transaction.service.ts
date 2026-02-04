import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import {
  Transaction,
  TransactionType,
  TransactionStatus,
} from "../database/entities/transaction.entity";

export interface TransactionStats {
  totalDeposits: number;
  successfulDeposits: number;
  failedDeposits: number;
  depositSuccessRate: number;
  totalDepositAmount: number;

  totalWithdrawals: number;
  successfulWithdrawals: number;
  failedWithdrawals: number;
  withdrawalSuccessRate: number;
  totalWithdrawalAmount: number;

  netFlow: number; // Deposits - Withdrawals
  pendingTransactions: number;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
  ) {}

  /**
   * Record a new deposit
   */
  async recordDeposit(
    amount: number,
    externalId?: string,
    balanceBefore?: number,
  ): Promise<Transaction> {
    const transaction = this.transactionRepo.create({
      type: TransactionType.DEPOSIT,
      status: TransactionStatus.PENDING,
      amount,
      externalId,
      balanceBefore,
      currency: "TOMAN",
    });

    const saved = await this.transactionRepo.save(transaction);
    this.logger.log(`📥 Deposit recorded: ${amount} TOMAN (${saved.id})`);
    return saved;
  }

  /**
   * Record a new withdrawal
   */
  async recordWithdrawal(
    amount: number,
    externalId?: string,
    balanceBefore?: number,
  ): Promise<Transaction> {
    const transaction = this.transactionRepo.create({
      type: TransactionType.WITHDRAW,
      status: TransactionStatus.PENDING,
      amount,
      externalId,
      balanceBefore,
      currency: "TOMAN",
    });

    const saved = await this.transactionRepo.save(transaction);
    this.logger.log(`📤 Withdrawal recorded: ${amount} TOMAN (${saved.id})`);
    return saved;
  }

  /**
   * Mark transaction as successful
   */
  async markSuccess(
    transactionId: string,
    balanceAfter?: number,
    referenceCode?: string,
  ): Promise<Transaction> {
    const transaction = await this.transactionRepo.findOne({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    transaction.status = TransactionStatus.SUCCESS;
    transaction.completedAt = new Date();
    transaction.balanceAfter = balanceAfter;
    transaction.referenceCode = referenceCode;

    const saved = await this.transactionRepo.save(transaction);
    this.logger.log(`✅ Transaction ${transactionId} marked as SUCCESS`);
    return saved;
  }

  /**
   * Mark transaction as failed
   */
  async markFailed(
    transactionId: string,
    errorMessage: string,
  ): Promise<Transaction> {
    const transaction = await this.transactionRepo.findOne({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    transaction.status = TransactionStatus.FAILED;
    transaction.completedAt = new Date();
    transaction.errorMessage = errorMessage;

    const saved = await this.transactionRepo.save(transaction);
    this.logger.log(
      `❌ Transaction ${transactionId} marked as FAILED: ${errorMessage}`,
    );
    return saved;
  }

  /**
   * Get transaction statistics
   */
  async getStats(days?: number): Promise<TransactionStats> {
    let whereClause = {};

    if (days) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      whereClause = { createdAt: Between(since, new Date()) };
    }

    const deposits = await this.transactionRepo.find({
      where: { ...whereClause, type: TransactionType.DEPOSIT },
    });

    const withdrawals = await this.transactionRepo.find({
      where: { ...whereClause, type: TransactionType.WITHDRAW },
    });

    const successfulDeposits = deposits.filter(
      (d) => d.status === TransactionStatus.SUCCESS,
    );
    const failedDeposits = deposits.filter(
      (d) => d.status === TransactionStatus.FAILED,
    );
    const successfulWithdrawals = withdrawals.filter(
      (w) => w.status === TransactionStatus.SUCCESS,
    );
    const failedWithdrawals = withdrawals.filter(
      (w) => w.status === TransactionStatus.FAILED,
    );

    const totalDepositAmount = successfulDeposits.reduce(
      (sum, d) => sum + Number(d.amount),
      0,
    );
    const totalWithdrawalAmount = successfulWithdrawals.reduce(
      (sum, w) => sum + Number(w.amount),
      0,
    );

    const pendingTransactions = [...deposits, ...withdrawals].filter(
      (t) => t.status === TransactionStatus.PENDING,
    ).length;

    return {
      totalDeposits: deposits.length,
      successfulDeposits: successfulDeposits.length,
      failedDeposits: failedDeposits.length,
      depositSuccessRate:
        deposits.length > 0
          ? (successfulDeposits.length / deposits.length) * 100
          : 0,
      totalDepositAmount,

      totalWithdrawals: withdrawals.length,
      successfulWithdrawals: successfulWithdrawals.length,
      failedWithdrawals: failedWithdrawals.length,
      withdrawalSuccessRate:
        withdrawals.length > 0
          ? (successfulWithdrawals.length / withdrawals.length) * 100
          : 0,
      totalWithdrawalAmount,

      netFlow: totalDepositAmount - totalWithdrawalAmount,
      pendingTransactions,
    };
  }

  /**
   * Get recent transactions
   */
  async getRecentTransactions(limit: number = 10): Promise<Transaction[]> {
    return this.transactionRepo.find({
      order: { createdAt: "DESC" },
      take: limit,
    });
  }

  /**
   * Get human-readable stats summary
   */
  async getStatsSummary(days?: number): Promise<string> {
    const stats = await this.getStats(days);
    const period = days ? `Last ${days} days` : "All time";

    return `📊 *Transaction Statistics* (${period})
━━━━━━━━━━━━━━━━━━━━━━━━

📥 *Deposits:*
├── Total: ${stats.totalDeposits}
├── ✅ Success: ${stats.successfulDeposits}
├── ❌ Failed: ${stats.failedDeposits}
├── Rate: ${stats.depositSuccessRate.toFixed(1)}%
└── Amount: ${stats.totalDepositAmount.toLocaleString()} T

📤 *Withdrawals:*
├── Total: ${stats.totalWithdrawals}
├── ✅ Success: ${stats.successfulWithdrawals}
├── ❌ Failed: ${stats.failedWithdrawals}
├── Rate: ${stats.withdrawalSuccessRate.toFixed(1)}%
└── Amount: ${stats.totalWithdrawalAmount.toLocaleString()} T

💰 *Net Flow:* ${stats.netFlow >= 0 ? "+" : ""}${stats.netFlow.toLocaleString()} T
⏳ *Pending:* ${stats.pendingTransactions}`;
  }

  /**
   * Get GPT-ready transaction data
   */
  async getGptData(days: number = 30): Promise<string> {
    const stats = await this.getStats(days);
    const transactions = await this.getRecentTransactions(50);

    const data = {
      period_days: days,
      statistics: stats,
      recent_transactions: transactions.map((t) => ({
        type: t.type,
        status: t.status,
        amount: Number(t.amount),
        created_at: t.createdAt,
        completed_at: t.completedAt,
        error: t.errorMessage,
      })),
      analysis_goals: [
        "Identify patterns in deposit/withdrawal timing",
        "Analyze success/failure rates",
        "Detect any anomalies in transaction patterns",
        "Suggest optimal deposit/withdrawal timing",
      ],
    };

    return JSON.stringify(data, null, 2);
  }
}
