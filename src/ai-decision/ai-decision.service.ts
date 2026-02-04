import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { PromptBuilderService } from "./prompt-builder.service";
import { AllPrices } from "../price-fetcher/price-fetcher.service";
import { PatternAnalysis } from "../pattern-analyzer/pattern-analyzer.service";

export interface AiDecision {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  volumePercent: number;
  reasoning: string;
  expectedOutcome: string;
  rawResponse?: string;
}

@Injectable()
export class AiDecisionService {
  private readonly logger = new Logger(AiDecisionService.name);
  private openai: OpenAI;

  constructor(
    private configService: ConfigService,
    private promptBuilder: PromptBuilderService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get("OPENAI_API_KEY"),
    });
  }

  async getDecision(
    prices: AllPrices,
    analysis: PatternAnalysis,
    wallet: { tomanBalance: number; silverBalance: number },
  ): Promise<AiDecision> {
    try {
      const prompt = await this.promptBuilder.buildPrompt(
        prices,
        analysis,
        wallet,
      );

      const response = await this.openai.chat.completions.create({
        model: this.configService.get("OPENAI_MODEL", "gpt-4.1"),
        messages: [
          {
            role: "system",
            content:
              "You are a precise trading AI. Always respond with valid JSON only. No markdown, no explanations outside JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || "";
      this.logger.debug(`AI Response: ${content}`);

      // Parse JSON response
      const parsed = this.parseAiResponse(content);

      return {
        action: parsed.action || "HOLD",
        confidence: parsed.confidence || 0,
        volumePercent: parsed.volume_percent || 1,
        reasoning: parsed.reasoning || "No reasoning provided",
        expectedOutcome: parsed.expected_outcome || "Unknown",
        rawResponse: content,
      };
    } catch (error) {
      this.logger.error("AI decision failed", error.message);

      // Fallback to pattern analyzer suggestion
      return {
        action: analysis.suggestion,
        confidence: analysis.overallConfidence * 0.8, // Reduce confidence for fallback
        volumePercent: 1,
        reasoning: `AI unavailable. Fallback to pattern analysis: ${analysis.patterns.map((p) => p.description).join("; ")}`,
        expectedOutcome: "Based on pattern analysis only",
      };
    }
  }

  private parseAiResponse(content: string): any {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return {};
    } catch (error) {
      this.logger.warn("Failed to parse AI response as JSON");
      return {};
    }
  }
}
