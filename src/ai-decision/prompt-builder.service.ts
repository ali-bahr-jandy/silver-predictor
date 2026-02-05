import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AllPrices } from "../price-fetcher/price-fetcher.service";
import { PatternAnalysis } from "../pattern-analyzer/pattern-analyzer.service";
import { TradeHistory } from "../database/entities/trade-history.entity";
import { PatternEvent } from "../database/entities/pattern-event.entity";
import { NoghreseaApiService } from "../noghresea/noghresea-api.service";

@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  constructor(
    @InjectRepository(TradeHistory)
    private tradeHistoryRepo: Repository<TradeHistory>,
    @InjectRepository(PatternEvent)
    private patternEventRepo: Repository<PatternEvent>,
    private noghreseaApi: NoghreseaApiService,
  ) {}

  async buildPrompt(
    prices: AllPrices,
    analysis: PatternAnalysis,
    wallet: { tomanBalance: number; silverBalance: number },
  ): Promise<string> {
    // Get recent price history
    const recentPrices = await this.noghreseaApi.getRecentPrices(30);

    // Get recent trades
    const recentTrades = await this.tradeHistoryRepo
      .createQueryBuilder("t")
      .orderBy("t.executedAt", "DESC")
      .limit(10)
      .getMany();

    // Get similar patterns from history
    const similarPatterns = await this.getSimilarPatterns(analysis);

    const prompt = `You are a silver trading AI for the Iranian platform noghresea.ir. 
Your goal is to maximize profit by detecting price manipulation and market movements.

## CURRENT MARKET STATE
- **Noghresea Silver Price**: ${prices.noghresea?.price || "N/A"} Toman/gram
- **24h Change**: ${prices.noghresea?.change24h || "N/A"}%
- **International Silver (XAG)**: $${prices.silverOunce?.toFixed(2) || "N/A"}/oz
- **International Gold (XAU)**: $${prices.goldOunce?.toFixed(2) || "N/A"}/oz  
- **USDT/Toman**: ${prices.usdtToman?.toLocaleString() || "N/A"}

## WALLET STATUS
- **Toman Balance**: ${wallet.tomanBalance.toLocaleString()} Toman
- **Silver Balance**: ${wallet.silverBalance.toFixed(2)} grams
- **Available for trade (5%)**: ${(wallet.tomanBalance * 0.05).toLocaleString()} Toman

## DETECTED PATTERNS
${analysis.patterns.map((p) => `- **${p.type}** (${p.confidence.toFixed(0)}%): ${p.description}`).join("\n")}
- **Pattern Analyzer Suggestion**: ${analysis.suggestion}
- **Overall Confidence**: ${analysis.overallConfidence.toFixed(1)}%

## RECENT PRICE MOVEMENTS (Last 30 min)
${this.formatPriceHistory(recentPrices.slice(0, 20))}

## RECENT TRADES
${this.formatTradeHistory(recentTrades)}

## HISTORICAL SIMILAR PATTERNS
${this.formatSimilarPatterns(similarPatterns)}

## TRADING FEE CONSIDERATION
- **Fee per transaction**: 1% of transaction value
- **Round-trip fee (BUY + SELL)**: 2% total
- **CRITICAL**: Only recommend trading if expected profit > 2% to cover fees
- If expected price movement is < 2%, suggest HOLD to avoid losing money on fees

## CRITICAL: MANIPULATION DETECTION STRATEGY
The price changer on noghresea.ir has a PREDICTABLE pattern:

**MANIPULATION DROP SEQUENCE:**
1. He starts with a large drop (30,000-50,000 Toman suddenly)
2. Followed by 3-5 more consecutive smaller drops
3. The international silver price (XAG) stays STABLE during this
4. After the last drop, he makes ONE small rise - THIS IS THE BOTTOM
5. Price then recovers back up over 5-10 minutes

**HOW TO TRADE THIS:**
- During drops: If international silver is stable → HOLD (it's manipulation)
- During drops: If international silver is also dropping → SELL (market-driven)
- **FIRST RISE AFTER 3+ DROPS = BUY IMMEDIATELY** (this is DROP_BOTTOM pattern)
- After buying: Wait for recovery, then SELL at peak

**KEY SIGNALS:**
- DROP_BOTTOM pattern = STRONG BUY (first rise after multiple drops)
- MULTI_BEARISH + MANIPULATION = HOLD (wait for bottom)
- MULTI_BEARISH without manipulation = SELL (market is falling)
- RECOVERY pattern = BUY (confirming bottom)

**CURRENT PATTERN ANALYZER SUGGESTION: ${analysis.suggestion}**
If the suggestion is BUY, you should almost always agree unless you see a strong reason not to.

## YOUR TASK
Analyze the current situation and decide:
1. **action**: "BUY", "SELL", or "HOLD"
2. **confidence**: 0-100 (how confident are you)
3. **volume_percent**: 1-5 (what % of available balance to use, use 3-5 for DROP_BOTTOM)
4. **reasoning**: Brief explanation of your decision (include fee consideration!)
5. **expected_outcome**: What you expect to happen next (indicate expected % gain)

**REMEMBER**: Each trade costs 1% fee. Round-trip (BUY→SELL) costs 2%. Only trade if you expect >2% profit!

Respond in JSON format only:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": number,
  "volume_percent": number,
  "reasoning": "string",
  "expected_outcome": "string"
}`;

    return prompt;
  }

  private formatPriceHistory(prices: any[]): string {
    if (prices.length === 0) return "No data available";

    return prices
      .slice(0, 15)
      .map((p, i) => {
        const change = Number(p.changeFromPrev) || 0;
        const changeSign = change >= 0 ? "+" : "";
        const time = new Date(p.recordedAt).toLocaleTimeString("en-US", {
          hour12: false,
        });
        return `${time}: ${Number(p.price).toFixed(2)} (${changeSign}${change.toFixed(2)})`;
      })
      .join("\n");
  }

  private formatTradeHistory(trades: TradeHistory[]): string {
    if (trades.length === 0) return "No recent trades";

    return trades
      .slice(0, 5)
      .map((t) => {
        const time = new Date(t.executedAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return `${time}: ${t.action} ${t.volume}g @ ${t.price} (confidence: ${t.aiConfidence}%)`;
      })
      .join("\n");
  }

  private formatSimilarPatterns(patterns: PatternEvent[]): string {
    if (patterns.length === 0) return "No similar patterns found";

    return patterns
      .slice(0, 5)
      .map((p) => {
        const time = new Date(p.detectedAt).toLocaleString("en-US");
        const context = p.contextData as any;
        return `${time}: ${p.patternType} (${p.confidence}%) → ${context?.suggestion || "N/A"}`;
      })
      .join("\n");
  }

  private async getSimilarPatterns(
    analysis: PatternAnalysis,
  ): Promise<PatternEvent[]> {
    if (analysis.patterns.length === 0) return [];

    const mainType = analysis.patterns[0].type;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    return this.patternEventRepo
      .createQueryBuilder("p")
      .where("p.patternType = :type", { type: mainType })
      .andWhere("p.detectedAt >= :since", { since })
      .orderBy("p.detectedAt", "DESC")
      .limit(10)
      .getMany();
  }
}
