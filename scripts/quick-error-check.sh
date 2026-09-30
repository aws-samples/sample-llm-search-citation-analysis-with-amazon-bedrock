#!/bin/bash

# Quick check for provider API retries and failures in CloudWatch Logs
# Usage: ./scripts/quick-error-check.sh [minutes-ago]
#
# The search step runs one Lambda per provider, CitationAnalysis-Search-<provider id>.
# Every one of those log groups is read, plus the legacy single CitationAnalysis-Search
# group; groups that do not exist (yet, or any more) are skipped.
#
# Tags counted are the ones the clients log (lambda/shared/ai_clients.py, lambda/shared/serpapi.py):
#   retries:  [<P>_RETRY] [<P>_TIMEOUT] [<P>_REQUEST_ERROR]
#   failures: [<P>_FAILED] [<P>_EXHAUSTED] [<P>_TIMEOUT_FAILED] [<P>_REQUEST_FAILED]

MINUTES_AGO=${1:-60}
START_TIME=$(($(date +%s) - (MINUTES_AGO * 60)))000
LOG_GROUP_BASE="/aws/lambda/CitationAnalysis-Search"
PROVIDER_IDS=(openai perplexity gemini claude brave tavily exa serpapi firecrawl)
PROVIDER_LABELS=(OpenAI Perplexity Gemini Claude Brave Tavily Exa SerpAPI Firecrawl)

# Log groups that exist, among the base group and the per-provider groups.
EXISTING=$(aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP_BASE" \
  --query 'logGroups[].logGroupName' --output text 2>/dev/null | tr '\t' '\n')
LOG_GROUPS=()
for candidate in "$LOG_GROUP_BASE" "${PROVIDER_IDS[@]/#/$LOG_GROUP_BASE-}"; do
    if printf '%s\n' "$EXISTING" | grep -qxF -- "$candidate"; then
        LOG_GROUPS+=("$candidate")
    fi
done

# Sum of events matching filter pattern $1 over every existing log group.
count_events() {
    local total=0 group count
    for group in "${LOG_GROUPS[@]}"; do
        # One number per result page: sum them (joining them read "60" + "0" as 600).
        count=$(aws logs filter-log-events --log-group-name "$group" --start-time "$START_TIME" \
          --filter-pattern "$1" --query 'length(events)' --output text 2>/dev/null | awk '{ sum += $1 } END { print sum + 0 }')
        [[ "$count" =~ ^[0-9]+$ ]] || count=0
        total=$((total + count))
    done
    echo "$total"
}

# Filter pattern matching any of the given tags for provider tag $1 (quoted: the tags contain brackets).
tags_pattern() {
    local tag=$1 suffix pattern=""
    shift
    for suffix in "$@"; do
        pattern+="?\"[${tag}_${suffix}]\" "
    done
    echo "${pattern% }"
}

echo ""
echo "========================================="
echo "API Error Check (Last $MINUTES_AGO minutes)"
echo "========================================="
echo ""

if [ ${#LOG_GROUPS[@]} -eq 0 ]; then
    echo "No search log groups found under $LOG_GROUP_BASE (not deployed, or no credentials)."
    echo ""
    exit 0
fi
echo "📂 Reading ${#LOG_GROUPS[@]} log group(s):"
printf '  %s\n' "${LOG_GROUPS[@]}"

echo ""
echo "🔄 Counting retries and failures..."
RETRIES=()
FAILURES=()
TOTAL_RETRIES=0
TOTAL_FAILURES=0
for index in "${!PROVIDER_IDS[@]}"; do
    tag=$(echo "${PROVIDER_IDS[$index]}" | tr '[:lower:]' '[:upper:]')
    RETRIES[index]=$(count_events "$(tags_pattern "$tag" RETRY TIMEOUT REQUEST_ERROR)")
    FAILURES[index]=$(count_events "$(tags_pattern "$tag" FAILED EXHAUSTED TIMEOUT_FAILED REQUEST_FAILED)")
    TOTAL_RETRIES=$((TOTAL_RETRIES + RETRIES[index]))
    TOTAL_FAILURES=$((TOTAL_FAILURES + FAILURES[index]))
done

echo ""
echo "📊 SUMMARY (retries / failures):"
for index in "${!PROVIDER_IDS[@]}"; do
    printf '  %-11s : %5s retries  %5s failures\n' "${PROVIDER_LABELS[$index]}" "${RETRIES[$index]}" "${FAILURES[$index]}"
done
echo "  ─────────────────────────────────────────"
printf '  %-11s : %5s retries  %5s failures\n' "TOTAL" "$TOTAL_RETRIES" "$TOTAL_FAILURES"

# Recommendations
echo ""
echo "💡 RECOMMENDATION:"
echo "─────────────────────────"

if [ "$TOTAL_FAILURES" -gt 0 ]; then
    echo "  🔴 $TOTAL_FAILURES provider calls failed after all retries"
    echo "  🔴 Lower that provider's cap (context providerConcurrency) or raise"
    echo "     PROVIDER_THROTTLE_EXTRA_ATTEMPTS on its search Lambda"
elif [ "$TOTAL_RETRIES" -gt 50 ]; then
    echo "  🟡 $TOTAL_RETRIES retry attempts, no failures"
    echo "  🟡 Calls succeed but wait; consider a lower providerConcurrency for the busiest provider"
else
    echo "  ✅ No failures, $TOTAL_RETRIES retries - providers are keeping up"
fi

echo ""
echo "========================================="
echo ""

# Show sample errors if any
if [ "$TOTAL_FAILURES" -gt 0 ]; then
    echo "📋 Sample failure messages:"
    echo "─────────────────────────"
    for group in "${LOG_GROUPS[@]}"; do
        aws logs filter-log-events \
          --log-group-name "$group" \
          --start-time "$START_TIME" \
          --filter-pattern '?"_FAILED]" ?"_EXHAUSTED]"' \
          --query 'events[0:3].message' \
          --output text 2>/dev/null
    done
    echo ""
fi
