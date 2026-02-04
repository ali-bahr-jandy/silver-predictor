# Silver Predictor - Complete Logic Flow

## 📊 Data Sources & How They're Used

### 1. Noghresea Silver Price (Primary)

**Source:** `https://api.noghresea.ir/api/market/getSilverPrice`
**File:** [noghresea-api.service.ts](../src/noghresea/noghresea-api.service.ts)

```
Response: { price: "702.32", change24h: "-3.5", fee: {...} }
```

**Stored Data (noghresea_prices table):**
| Field | Calculation |
|-------|-------------|
| `price` | Direct from API (e.g., 702.32) - Toman per 0.1 gram |
| `change24h` | Direct from API (e.g., -3.5%) |
| `changeFromPrev` | `currentPrice - lastPrice` (e.g., +0.05 or -1.20) |
| `changePercent` | `(changeFromPrev / lastPrice) * 100` (e.g., 0.007% or -0.17%) |
| `secondsSinceLast` | Time since previous record |

---

### 2. International Silver Price (XAG)

**Source:** `https://api.gold-api.com/price/XAG` (primary) or `https://api.metals.live/v1/spot` (fallback)
**File:** [metals.service.ts](../src/price-fetcher/sources/metals.service.ts)

```
Response: { price: 102.01, ... }  // USD per troy ounce
```

**Constants Used:**

```typescript
GRAMS_PER_OUNCE = 31.1035; // 1 troy ounce = 31.1035 grams
GRAMS_PER_MESGHAL = 4.6083; // 1 mesghal (Iranian unit) = 4.6083 grams
```

**Fallback Calculation (if API fails):**

```typescript
// If no international price available, estimate from Noghresea + USDT rate
pricePerMesghalToman = noghreseaPrice * 1000; // thousand Tomans
pricePerGramToman = pricePerMesghalToman / 4.6083;
pricePerGramUsd = pricePerGramToman / usdtToman;
pricePerOunceUsd = pricePerGramUsd * 31.1035;
estimatedInternational = pricePerOunceUsd / 1.25; // Remove ~25% Iranian markup
```

---

### 3. International Gold Price (XAU)

**Source:** `https://api.gold-api.com/price/XAU`
**File:** [metals.service.ts](../src/price-fetcher/sources/metals.service.ts)

```
Response: { price: 2890.50, ... }  // USD per troy ounce
```

Used for context only - not directly in pattern detection.

---

### 4. USDT/Toman Rate

**Source:** `https://api.wallex.ir/v1/markets` (Wallex exchange)
**File:** [wallex.service.ts](../src/price-fetcher/sources/wallex.service.ts)

```
Response: { USDTTMN: { stats: { lastPrice: "162000" } } }
```

**Usage:**

- Convert between USD and Toman prices
- Detect currency-based price movements vs actual silver movements

---

## 🔍 Pattern Detection Logic

**File:** [pattern-analyzer.service.ts](../src/pattern-analyzer/pattern-analyzer.service.ts)

### Input Data

```typescript
recentPrices = await noghreseaApi.getRecentPrices(10); // Last 10 minutes
```

### Pattern 1: MULTI_BEARISH

**Trigger:** 2+ consecutive price drops

```typescript
// Check last 5 price records
for (each price in recentChanges) {
  if (changeFromPrev < 0) {
    consecutiveDrops++;
    totalDrop += Math.abs(change);
  } else {
    break;  // Stop at first rise
  }
}

if (consecutiveDrops >= 2) {
  confidence = min(40 + consecutiveDrops * 15 + totalDrop * 5, 95);
  // Example: 3 drops, total -2.5 = 40 + 45 + 12.5 = 97.5 → capped at 95%
}
```

**Confidence Formula:**

```
MULTI_BEARISH confidence = min(40 + (drops × 15) + (totalDrop × 5), 95)

Example: 3 consecutive drops totaling -1.5:
= 40 + (3 × 15) + (1.5 × 5)
= 40 + 45 + 7.5
= 92.5%
```

---

### Pattern 2: MULTI_BULLISH

**Trigger:** 2+ consecutive price rises

```typescript
if (consecutiveRises >= 2) {
  confidence = min(40 + consecutiveRises * 15 + totalRise * 5, 95);
}
```

**Confidence Formula:**

```
MULTI_BULLISH confidence = min(40 + (rises × 15) + (totalRise × 5), 95)
```

---

### Pattern 3: SUDDEN_DROP / SUDDEN_SPIKE

**Trigger:** Single tick change > 0.2%

```typescript
changePercent = Math.abs(latest.changePercent);

if (changePercent > 0.2) {
  // 0.2% threshold
  confidence = min(40 + changePercent * 30, 95);
  type = change < 0 ? SUDDEN_DROP : SUDDEN_SPIKE;
}
```

**Confidence Formula:**

```
SUDDEN_CHANGE confidence = min(40 + (changePercent × 30), 95)

Example: 0.5% change = 40 + (0.5 × 30) = 55%
Example: 1.0% change = 40 + (1.0 × 30) = 70%
```

---

### Pattern 4: MANIPULATION

**Trigger:** Noghresea moved significantly while international market stayed stable

```typescript
// Get price changes over last 5 minutes
ounceChange = ((latestOunce - earliestOunce) / earliestOunce) * 100;
noghreseaChange =
  ((latestNoghresea - earliestNoghresea) / earliestNoghresea) * 100;

marketStable = Math.abs(ounceChange) < 0.15; // International moved < 0.15%
noghreseaMoved = Math.abs(noghreseaChange) > 0.25; // Noghresea moved > 0.25%

if (marketStable && noghreseaMoved) {
  type = MANIPULATION;
  confidence = min(60 + noghreseaChange * 10, 95);
}
```

**Confidence Formula:**

```
MANIPULATION confidence = min(60 + (|noghreseaChange| × 10), 95)

Example: Noghresea moved 0.5%, market stable = 60 + 5 = 65%
Example: Noghresea moved 1.0%, market stable = 60 + 10 = 70%
```

---

### Pattern 5: MARKET_DRIVEN

**Trigger:** Noghresea follows international price movement

```typescript
if (
  Math.abs(ounceChange) > 0.15 && // Market moved
  Math.sign(ounceChange) === Math.sign(noghreseaChange)
) {
  // Same direction
  type = MARKET_DRIVEN;
  confidence = 60; // Fixed confidence
}
```

---

### Pattern 6: RECOVERY

**Trigger:** Price recovering after a drop (drop-drop-rise-rise pattern)

```typescript
// Check prices: p0 (latest), p1, p2, p3 (older)
if (p3 > p2 && p2 < p1 && p1 < p0) {
  // drop-drop-rise-rise
  recoveryAmount = p0 - p2;
  dropAmount = p3 - p2;
  recoveryPercent = (recoveryAmount / dropAmount) * 100;

  if (recoveryPercent > 50) {
    confidence = min(50 + recoveryPercent * 0.3, 85);
  }
}
```

**Confidence Formula:**

```
RECOVERY confidence = min(50 + (recoveryPercent × 0.3), 85)

Example: 70% recovery = 50 + 21 = 71%
Example: 100% recovery = 50 + 30 = 80%
```

---

## 📈 Overall Confidence Calculation

```typescript
if (patterns.length === 0) {
  // Baseline confidence based on data quality
  overallConfidence = min(dataPoints × 3, 25);  // Max 25%
} else {
  maxConfidence = max(all pattern confidences);
  avgConfidence = average(all pattern confidences);

  // Weighted: 70% max, 30% average
  overallConfidence = maxConfidence × 0.7 + avgConfidence × 0.3;
}
```

**Example:**

```
Patterns detected:
- MULTI_BULLISH: 70%
- MARKET_DRIVEN: 60%

maxConfidence = 70
avgConfidence = (70 + 60) / 2 = 65

overallConfidence = 70 × 0.7 + 65 × 0.3
                  = 49 + 19.5
                  = 68.5%
```

---

## 🤖 AI Decision Flow

**When AI is called:** Only when `overallConfidence >= 85%`

### Prompt Structure Sent to GPT-4.1:

```markdown
## CURRENT MARKET STATE

- Noghresea Silver Price: 702.32 Toman/gram
- 24h Change: -3.5%
- International Silver (XAG): $102.01/oz
- International Gold (XAU): $2890.50/oz
- USDT/Toman: 162,000

## WALLET STATUS

- Toman Balance: 199,142 Toman
- Silver Balance: 171.62 grams
- Available for trade (5%): 9,957 Toman

## DETECTED PATTERNS

- MULTI_BEARISH (85%): 3 consecutive drops detected (total: -1.50)
- MANIPULATION (70%): Platform moved -0.8% while market stable (0.05%)
- Pattern Analyzer Suggestion: HOLD
- Overall Confidence: 87.5%

## RECENT PRICE MOVEMENTS (Last 30 min)

14:46:10: 702.32 (+0.05)
14:45:40: 702.27 (-0.50)
14:45:10: 702.77 (-0.60)
14:44:40: 703.37 (-0.40)
...

## RECENT TRADES

Jan 30, 14:20: BUY 10g @ 700.50 (confidence: 88%)

## HISTORICAL SIMILAR PATTERNS

Jan 29, 18:45: MULTI_BEARISH (82%) → HOLD
Jan 28, 09:30: MULTI_BEARISH (79%) → HOLD
...

## CONTEXT ABOUT THE PLATFORM

The price changer on noghresea.ir is known to:

1. Make sudden bearish moves (2-3 drops in 1-2 minutes) to create panic
2. Sometimes these drops are manipulation (not following international market)
3. Sometimes drops follow the actual silver ounce price
4. After manipulation drops, price often recovers within 5-10 minutes
```

### AI Response Expected:

```json
{
  "action": "HOLD",
  "confidence": 75,
  "volume_percent": 1,
  "reasoning": "Multi-bearish with manipulation detected. Wait for recovery.",
  "expected_outcome": "Price likely to recover in 5-10 minutes."
}
```

---

## 🎯 Trade Execution Thresholds

```typescript
// 1. Pattern must be detected with >= 85% confidence to call AI
if (analysis.overallConfidence >= 85) {
  callAI();
}

// 2. AI confidence must meet threshold to execute trade
const threshold = 85; // From .env CONFIDENCE_THRESHOLD
if (decision.confidence >= threshold) {
  executeTrade();
}

// 3. Trade volume limited
const maxPercent = 5; // From .env MAX_TRADE_PERCENT
volume = min(decision.volumePercent, maxPercent);
```

---

## 📊 Decision Logic Summary

| Patterns                      | Suggestion                    |
| ----------------------------- | ----------------------------- |
| MULTI_BEARISH + MANIPULATION  | HOLD (wait for recovery)      |
| MULTI_BEARISH (market-driven) | SELL                          |
| RECOVERY                      | BUY                           |
| MULTI_BULLISH                 | HOLD (wait for confirmation)  |
| SUDDEN_DROP + MANIPULATION    | HOLD (buy opportunity coming) |
| SUDDEN_SPIKE                  | SELL                          |
| No patterns                   | HOLD                          |

---

## 🔄 Cycle Flow

```
Every 10 seconds:
┌─────────────────────────────────────────────────────────────┐
│ 1. Check if trading enabled                                │
│    └─ If disabled → skip cycle                             │
├─────────────────────────────────────────────────────────────┤
│ 2. Check authentication                                    │
│    └─ If not authenticated → send Telegram alert           │
├─────────────────────────────────────────────────────────────┤
│ 3. Fetch all prices in parallel:                           │
│    • Noghresea silver price                                │
│    • International silver/gold (XAG/XAU)                   │
│    • USDT/Toman rate                                       │
├─────────────────────────────────────────────────────────────┤
│ 4. Store prices in database                                │
│    • Calculate changeFromPrev, changePercent               │
├─────────────────────────────────────────────────────────────┤
│ 5. Analyze patterns:                                       │
│    • Get last 10 minutes of Noghresea prices               │
│    • Check each pattern type                               │
│    • Calculate overall confidence                          │
├─────────────────────────────────────────────────────────────┤
│ 6. If confidence >= 85%:                                   │
│    • Build prompt with all context                         │
│    • Send to GPT-4.1                                       │
│    • Parse AI decision                                     │
├─────────────────────────────────────────────────────────────┤
│ 7. If AI says BUY/SELL with confidence >= 85%:             │
│    • Calculate trade volume (max 5% of balance)            │
│    • Execute order on Noghresea                            │
│    • Record trade in database                              │
│    • Send Telegram notification                            │
├─────────────────────────────────────────────────────────────┤
│ 8. Every 5 minutes: Send full status to Telegram           │
└─────────────────────────────────────────────────────────────┘
```
