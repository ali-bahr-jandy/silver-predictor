import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuthState } from "../database/entities/auth-state.entity";
import { BrowserSessionService } from "./browser-session.service";

@Injectable()
export class NoghreseaAuthService implements OnModuleInit {
  private readonly logger = new Logger(NoghreseaAuthService.name);
  private readonly baseUrl = "https://api.noghresea.ir";
  private accessToken: string | null = null;
  private currentPhoneNumber: string | null = null;

  constructor(
    @InjectRepository(AuthState)
    private authStateRepo: Repository<AuthState>,
    @Inject(forwardRef(() => BrowserSessionService))
    private browserSession: BrowserSessionService,
  ) {}

  async onModuleInit() {
    await this.loadTokenFromDb();
  }

  private async loadTokenFromDb() {
    try {
      // Try to load any valid token
      const auth = await this.authStateRepo.findOne({
        where: { isValid: true },
        order: { tokenExpiresAt: "DESC" },
      });
      if (auth && auth.isValid && auth.accessToken) {
        this.accessToken = auth.accessToken;
        this.currentPhoneNumber = auth.phoneNumber;
        this.logger.log("✅ Loaded existing auth token from DB");
      } else {
        this.logger.log("ℹ️ No valid auth token found in DB");
      }
    } catch (e) {
      this.logger.warn("Could not load auth from DB");
    }
  }

  setPhoneNumber(phoneNumber: string) {
    this.currentPhoneNumber = phoneNumber;
  }

  getPhoneNumber(): string | null {
    return this.currentPhoneNumber;
  }

  async sendOtp(phoneNumber?: string): Promise<boolean> {
    const phone = phoneNumber || this.currentPhoneNumber;
    if (!phone) {
      this.logger.error("No phone number provided for OTP");
      return false;
    }

    this.currentPhoneNumber = phone;

    try {
      this.logger.log(`Sending OTP request to ${phone}...`);

      // Use browser session to bypass ArvanCloud protection
      const response = await this.browserSession.makeRequest(
        `${this.baseUrl}/api/auth/sentOTP`,
        "POST",
        { phoneNumber: phone },
      );

      this.logger.log(`OTP response: ${JSON.stringify(response)}`);

      // Response format: {"success":true,"message":"رمز یکبار مصرف ارسال شد."}
      if (response.success === true) {
        this.logger.log(`✅ OTP sent successfully to ${phone}`);
        return true;
      } else {
        this.logger.warn(`OTP request returned: ${JSON.stringify(response)}`);
        return false;
      }
    } catch (error: any) {
      this.logger.error(`Failed to send OTP: ${error.message}`);
      return false;
    }
  }

  async verifyOtp(otp: string): Promise<boolean> {
    const phoneNumber = this.currentPhoneNumber;
    if (!phoneNumber) {
      this.logger.error("No phone number set for OTP verification");
      return false;
    }

    try {
      // Use browser session to bypass ArvanCloud protection
      const response = await this.browserSession.makeRequest(
        `${this.baseUrl}/api/auth/verifyOTP`,
        "POST",
        { otp, phoneNumber, source: "" },
      );

      if (response.accessToken) {
        this.accessToken = response.accessToken;

        // Decode JWT to get expiry
        const payload = JSON.parse(
          Buffer.from(response.accessToken.split(".")[1], "base64").toString(),
        );
        const expiresAt = new Date(payload.exp * 1000);

        // Save to DB
        let auth = await this.authStateRepo.findOne({ where: { phoneNumber } });
        if (!auth) {
          auth = this.authStateRepo.create({ phoneNumber });
        }
        auth.accessToken = this.accessToken!;
        auth.tokenExpiresAt = expiresAt;
        auth.isValid = true;
        await this.authStateRepo.save(auth);

        this.logger.log(
          `✅ Authentication successful, expires: ${expiresAt.toISOString()}`,
        );
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error("Failed to verify OTP", error.message);
      return false;
    }
  }

  getToken(): string | null {
    return this.accessToken;
  }

  isAuthenticated(): boolean {
    if (!this.accessToken) return false;

    // Check if token is expired by checking DB
    return true; // Token exists, let API validate it
  }

  async invalidateToken() {
    this.accessToken = null;
    const phoneNumber = this.currentPhoneNumber;
    if (phoneNumber) {
      await this.authStateRepo.update({ phoneNumber }, { isValid: false });
    }
    this.currentPhoneNumber = null;
    this.logger.warn("Token invalidated");
  }
}
