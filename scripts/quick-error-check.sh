#!/bin/bash

# Quick check for API errors in CloudWatch Logs
# Usage: ./scripts/quick-error-check.sh [minutes-ago]

MINUTES_AGO=${1:-60}
START_TIME=$(($(date +%s) - (MINUTES_AGO * 60)))000
LOG_GROUP="/aws/lambda/CitationAnalysis-Search"

echo ""
echo "========================================="
echo "API Error Check (Last $MINUTES_AGO minutes)"
echo "========================================="
echo ""

# Count retries
echo "🔄 Counting retries..."
OPENAI_RETRIES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[OPENAI_RETRY]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")
PERPLEXITY_RETRIES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[PERPLEXITY_RETRY]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")
GEMINI_RETRIES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[GEMINI_RETRY]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")
CLAUDE_RETRIES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[CLAUDE_RETRY]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")

# Ensure we have valid numbers
OPENAI_RETRIES=${OPENAI_RETRIES:-0}
PERPLEXITY_RETRIES=${PERPLEXITY_RETRIES:-0}
GEMINI_RETRIES=${GEMINI_RETRIES:-0}
CLAUDE_RETRIES=${CLAUDE_RETRIES:-0}

TOTAL_RETRIES=$((OPENAI_RETRIES + PERPLEXITY_RETRIES + GEMINI_RETRIES + CLAUDE_RETRIES))

echo ""
echo "📊 RETRY SUMMARY:"
echo "  OpenAI      : $OPENAI_RETRIES retries"
echo "  Perplexity  : $PERPLEXITY_RETRIES retries"
echo "  Gemini      : $GEMINI_RETRIES retries"
echo "  Claude      : $CLAUDE_RETRIES retries"
echo "  ─────────────────────────"
echo "  TOTAL       : $TOTAL_RETRIES retries"

# Count failures
echo ""
echo "❌ Counting failures..."
OPENAI_FAILURES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[OPENAI_FAILED] OR [OPENAI_EXHAUSTED]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")
PERPLEXITY_FAILURES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[PERPLEXITY_FAILED] OR [PERPLEXITY_EXHAUSTED]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")
GEMINI_FAILURES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[GEMINI_FAILED] OR [GEMINI_EXHAUSTED]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")
CLAUDE_FAILURES=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_TIME" --filter-pattern "[CLAUDE_FAILED] OR [CLAUDE_EXHAUSTED]" --query 'length(events)' --output text 2>/dev/null | tr -d '\n' || echo "0")

# Ensure we have valid numbers
OPENAI_FAILURES=${OPENAI_FAILURES:-0}
PERPLEXITY_FAILURES=${PERPLEXITY_FAILURES:-0}
GEMINI_FAILURES=${GEMINI_FAILURES:-0}
CLAUDE_FAILURES=${CLAUDE_FAILURES:-0}

TOTAL_FAILURES=$((OPENAI_FAILURES + PERPLEXITY_FAILURES + GEMINI_FAILURES + CLAUDE_FAILURES))

echo ""
echo "❌ FAILURE SUMMARY:"
echo "  OpenAI      : $OPENAI_FAILURES failures"
echo "  Perplexity  : $PERPLEXITY_FAILURES failures"
echo "  Gemini      : $GEMINI_FAILURES failures"
echo "  Claude      : $CLAUDE_FAILURES failures"
echo "  ─────────────────────────"
echo "  TOTAL       : $TOTAL_FAILURES failures"

# Recommendations
echo ""
echo "💡 RECOMMENDATION:"
echo "─────────────────────────"

if [ "$TOTAL_RETRIES" -eq 0 ] && [ "$TOTAL_FAILURES" -eq 0 ]; then
    echo "  ✅ No API errors detected - system is running smoothly!"
    echo "  ✅ Current concurrency (5) appears to be fine."
elif [ "$TOTAL_FAILURES" -gt 10 ]; then
    echo "  🔴 $TOTAL_FAILURES requests failed after all retries"
    echo "  🔴 REDUCE maxConcurrency from 5 to 2 or 3"
elif [ "$TOTAL_FAILURES" -gt 0 ]; then
    echo "  🟡 $TOTAL_FAILURES requests failed after all retries"
    echo "  🟡 Monitor closely, consider reducing concurrency"
elif [ "$TOTAL_RETRIES" -gt 50 ]; then
    echo "  🟡 $TOTAL_RETRIES retry attempts detected"
    echo "  🟡 Consider reducing maxConcurrency from 5 to 3"
elif [ "$TOTAL_RETRIES" -gt 20 ]; then
    echo "  ℹ️  $TOTAL_RETRIES retry attempts detected"
    echo "  ✅ Current concurrency (5) is acceptable"
else
    echo "  ✅ Minimal retries ($TOTAL_RETRIES) - system is healthy"
    echo "  ✅ Current concurrency (5) is fine"
fi

echo ""
echo "========================================="
echo ""

# Show sample errors if any
if [ "$TOTAL_FAILURES" -gt 0 ]; then
    echo "📋 Sample failure messages:"
    echo "─────────────────────────"
    aws logs filter-log-events \
      --log-group-name "$LOG_GROUP" \
      --start-time "$START_TIME" \
      --filter-pattern "[FAILED] OR [EXHAUSTED]" \
      --query 'events[0:5].message' \
      --output text 2>/dev/null
    echo ""
fi
