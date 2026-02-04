import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import puppeteer, { Browser, Page } from "puppeteer";

@Injectable()
export class BrowserSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserSessionService.name);
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private requestQueue: Promise<any> = Promise.resolve();
  private initPromise: Promise<boolean> | null = null;

  async onModuleDestroy() {
    await this.closeBrowser();
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async initBrowser(): Promise<boolean> {
    // If already initialized, return true
    if (this.isInitialized && this.browser && this.page) {
      return true;
    }

    // If currently initializing, wait for that to complete
    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = this.doInitBrowser();

    try {
      const result = await this.initPromise;
      return result;
    } finally {
      this.isInitializing = false;
      this.initPromise = null;
    }
  }

  private async doInitBrowser(): Promise<boolean> {
    try {
      // Close any existing browser first
      await this.closeBrowser();

      this.logger.log("🌐 Launching browser for ArvanCloud bypass...");

      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
        ],
      });

      this.page = await this.browser.newPage();

      // Set a realistic user agent
      await this.page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

      // Navigate to noghresea to get cookies
      this.logger.log("🔐 Solving ArvanCloud challenge...");
      await this.page.goto("https://noghresea.ir", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // Wait for the challenge to be solved (page reloads)
      await this.page
        .waitForFunction(() => !document.body.innerHTML.includes("__arcsjs"), {
          timeout: 15000,
        })
        .catch(() => {
          // Challenge might already be solved
        });

      // Wait a bit more for cookies to be set
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Get all cookies (needed for ArvanCloud bypass)
      const cookies = await this.page.cookies();

      this.logger.log(
        `✅ ArvanCloud bypass successful! Got ${cookies.length} cookies`,
      );
      this.isInitialized = true;

      return true;
    } catch (error: any) {
      this.logger.error(`Failed to initialize browser: ${error.message}`);
      await this.closeBrowser();
      return false;
    }
  }

  async makeRequest(
    url: string,
    method: "GET" | "POST" = "GET",
    body?: any,
    authToken?: string,
  ): Promise<any> {
    // Queue requests to prevent concurrent browser access
    return new Promise((resolve, reject) => {
      this.requestQueue = this.requestQueue
        .then(() => this.doMakeRequest(url, method, body, authToken))
        .then(resolve)
        .catch(reject);
    });
  }

  private async doMakeRequest(
    url: string,
    method: "GET" | "POST" = "GET",
    body?: any,
    authToken?: string,
  ): Promise<any> {
    if (!this.isInitialized || !this.page) {
      const initialized = await this.initBrowser();
      if (!initialized) {
        throw new Error("Failed to initialize browser");
      }
    }

    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    try {
      // Set auth token as cookie if provided (noghresea uses cookie-based auth)
      if (authToken && this.page) {
        await this.page.setCookie({
          name: "accessToken",
          value: authToken,
          domain: "api.noghresea.ir",
          path: "/",
          httpOnly: false,
          secure: true,
        });
        // Also try setting on noghresea.ir domain
        await this.page.setCookie({
          name: "accessToken",
          value: authToken,
          domain: ".noghresea.ir",
          path: "/",
          httpOnly: false,
          secure: true,
        });
      }

      // Use page.evaluate to make fetch request with cookies and auth token
      const result = await this.page.evaluate(
        async (
          url: string,
          method: string,
          body: any,
          token: string | null,
        ) => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };

          // Add authorization header if token provided (without Bearer prefix - noghresea API expects raw token)
          if (token) {
            headers["Authorization"] = token;
          }

          const options: RequestInit = {
            method,
            headers,
            credentials: "include",
          };

          if (body && method === "POST") {
            options.body = JSON.stringify(body);
          }

          const response = await fetch(url, options);
          const text = await response.text();

          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        },
        url,
        method,
        body,
        authToken || null,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`Request failed: ${error.message}`);

      // Try to reinitialize if session expired
      this.isInitialized = false;
      await this.closeBrowser();

      throw error;
    }
  }
}
