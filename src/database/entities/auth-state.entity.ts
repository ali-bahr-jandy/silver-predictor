import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("auth_state")
@Index(["phoneNumber"], { unique: true })
export class AuthState {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "telegram_chat_id", nullable: true })
  telegramChatId: string;

  @Column({ name: "phone_number", unique: true })
  phoneNumber: string;

  @Column({ type: "text", name: "access_token", nullable: true })
  accessToken: string;

  @Column({ type: "timestamp", name: "token_expires_at", nullable: true })
  tokenExpiresAt: Date;

  @Column({ name: "is_valid", default: false })
  isValid: boolean;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
