import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from "typeorm";

@Entity("app_settings")
export class AppSettings {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "setting_key", unique: true })
  settingKey: string;

  @Column({ type: "jsonb", name: "setting_value" })
  settingValue: any;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
