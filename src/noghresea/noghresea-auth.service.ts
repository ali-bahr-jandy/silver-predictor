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

// Per-user auth state (in-memory)
interface UserAuthState {
  accessToken: string | null;
  phoneNumber: string | null;
  awaitingPhone: boolean;
  awaitingOtp: boolean;
}

@Injectable()
export class NoghreseaAuthService implements OnModuleInit {
  private readonly logger = new Logger(NoghreseaAuthService.name);
  private readonly baseUrl = "https://api.noghresea.ir";

  // Per-user authentication state
  private userStates: Map<string, UserAuthState> = new Map();

  constructor(
    @InjectRepository(AuthState)
    private authStateRepo: Repository<AuthState>,
    @Inject(forwardRef(() => BrowserSessionService))
    private browserSession: BrowserSessionService,
  ) {}

  async onModuleInit() {
    // No longer load global token - each user manages their own
    this.logger.log("NoghreseaAuthService initialized - per-user auth enabled");
  }

  private getUserState(chatId: string): UserAuthState {
    if (!this.userStates.has(chatId)) {
      this.userStates.set(chatId, {
        accessToken: null,
        phoneNumber: null,
        awaitingPhone: false,
        awaitingOtp: false,
      });
    }
    return this.userStates.get(chatId)!;
  }

  async loadUserAuth(chatId: string): Promise<void> {
    try {
      // First try to find by chat ID
      let auth = await this.authStateRepo.findOne({
        where: { telegramChatId: chatId, isValid: true },
      });

      // If not found by chat ID, try to find any valid auth (for backward compatibility)
      if (!auth) {
        auth = await this.authStateRepo.findOne({
          where: { isValid: true },
          order: { updatedAt: "DESC" },
        });
        if (auth) {
          this.logger.log(
            `📱 Found valid auth for phone ${auth.phoneNumber}, linking to chat ${chatId}`,
          );
          // Update the telegram chat ID to current one
          auth.telegramChatId = chatId;
          await this.authStateRepo.save(auth);
        }
      }

      const state = this.getUserState(chatId);
      if (auth && auth.isValid && auth.accessToken) {
        state.accessToken = auth.accessToken;
        state.phoneNumber = auth.phoneNumber;
        this.logger.log(`✅ Loaded auth for chat ${chatId}`);
      }
    } catch (e) {
      this.logger.warn(`Could not load auth for chat ${chatId}`);
    }
  }

  // State management for awaiting input
  setAwaitingPhone(chatId: string, value: boolean) {
    const state = this.getUserState(chatId);
    state.awaitingPhone = value;
    if (value) state.awaitingOtp = false;
  }

  setAwaitingOtp(chatId: string, value: boolean) {
    const state = this.getUserState(chatId);
    state.awaitingOtp = value;
    if (value) state.awaitingPhone = false;
  }

  isAwaitingPhone(chatId: string): boolean {
    return this.getUserState(chatId).awaitingPhone;
  }

  isAwaitingOtp(chatId: string): boolean {
    return this.getUserState(chatId).awaitingOtp;
  }

  setPhoneNumber(chatId: string, phoneNumber: string) {
    this.getUserState(chatId).phoneNumber = phoneNumber;
  }

  getPhoneNumber(chatId?: string): string | null {
    if (!chatId) return null;
    return this.getUserState(chatId).phoneNumber;
  }

  async sendOtp(chatId: string, phoneNumber?: string): Promise<boolean> {
    const state = this.getUserState(chatId);
    const phone = phoneNumber || state.phoneNumber;

    if (!phone) {
      this.logger.error(`No phone number provided for OTP (chat: ${chatId})`);
      return false;
    }

    state.phoneNumber = phone;

    try {
      this.logger.log(`Sending OTP request to ${phone} for chat ${chatId}...`);

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

  async verifyOtp(chatId: string, otp: string): Promise<boolean> {
    const state = this.getUserState(chatId);
    const phoneNumber = state.phoneNumber;

    if (!phoneNumber) {
      this.logger.error(
        `No phone number set for OTP verification (chat: ${chatId})`,
      );
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
        state.accessToken = response.accessToken;

        // Decode JWT to get expiry
        const payload = JSON.parse(
          Buffer.from(response.accessToken.split(".")[1], "base64").toString(),
        );
        const expiresAt = new Date(payload.exp * 1000);

        // Save to DB - use phone number as primary identifier
        let auth = await this.authStateRepo.findOne({
          where: { phoneNumber },
        });

        if (!auth) {
          // Create new auth record
          auth = this.authStateRepo.create({
            telegramChatId: chatId,
            phoneNumber,
          });
          this.logger.log(
            `🆕 Creating new auth record for phone ${phoneNumber}`,
          );
        } else {
          // Update existing auth record with new chat ID (device switch)
          this.logger.log(
            `🔄 Updating existing auth for phone ${phoneNumber} from chat ${auth.telegramChatId} to ${chatId}`,
          );
          auth.telegramChatId = chatId;
        }

        auth.accessToken = state.accessToken!;
        auth.tokenExpiresAt = expiresAt;
        auth.isValid = true;
        await this.authStateRepo.save(auth);

        this.logger.log(
          `✅ Authentication successful for chat ${chatId}, expires: ${expiresAt.toISOString()}`,
        );
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(
        `Failed to verify OTP for chat ${chatId}`,
        error.message,
      );
      return false;
    }
  }

  getToken(chatId?: string): string | null {
    if (!chatId) return null;
    return this.getUserState(chatId).accessToken;
  }

  isAuthenticated(chatId?: string): boolean {
    if (!chatId) return false;
    const state = this.getUserState(chatId);
    return !!state.accessToken;
  }

  async isPhoneNumberAuthorized(phoneNumber: string): Promise<boolean> {
    try {
      const auth = await this.authStateRepo.findOne({
        where: { phoneNumber, isValid: true },
      });
      return !!auth && !!auth.accessToken;
    } catch (e) {
      return false;
    }
  }

  async getAuthByPhoneNumber(phoneNumber: string): Promise<AuthState | null> {
    try {
      return await this.authStateRepo.findOne({
        where: { phoneNumber, isValid: true },
      });
    } catch (e) {
      return null;
    }
  }

  async invalidateToken(chatId: string) {
    const state = this.getUserState(chatId);
    const phoneNumber = state.phoneNumber;

    state.accessToken = null;
    state.phoneNumber = null;
    state.awaitingOtp = false;
    state.awaitingPhone = false;

    // Invalidate by phone number (primary identifier)
    if (phoneNumber) {
      await this.authStateRepo.update({ phoneNumber }, { isValid: false });
      this.logger.warn(
        `Token invalidated for phone ${phoneNumber} (chat ${chatId})`,
      );
    } else {
      // Fallback to chat ID if phone number not available
      await this.authStateRepo.update(
        { telegramChatId: chatId },
        { isValid: false },
      );
      this.logger.warn(`Token invalidated for chat ${chatId}`);
    }
  }
}
