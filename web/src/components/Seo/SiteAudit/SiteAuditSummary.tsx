/**
 * Health score, issue counts by severity and by group, and the AI-readiness panel of a finished audit (its AI
 * crawler table exports to Excel).
 */
import type {
  AiReadiness, AuditSummary, BotAccess, SiteAudit
} from '../../../types/api/seoAudits';
import {
  ACCESS_BADGES,
  ACCESS_LABELS,
  BOT_CLASS_LABELS,
  GROUP_LABELS,
  GROUP_ORDER,
  LLMS_TXT_LABELS,
  SEVERITY_BADGES,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  formatAuditDate,
  stopReasonText,
} from './siteAuditFormat';
import { exportAiCrawlersExcel } from './siteAuditExcel';
import { ExportExcelButton } from '../../ui/ExportExcelButton';

const CARD = 'bg-white rounded-lg border border-gray-200 p-4';

function ScoreCard({
  audit, summary
}: {
  readonly audit: SiteAudit;
  readonly summary: AuditSummary 
}) {
  return (
    <div className={CARD}>
      <p className="text-sm text-gray-500">Health score</p>
      <p className="text-3xl font-semibold text-gray-900">{summary.score}</p>
      <p className="text-xs text-gray-500">
        {audit.pages_crawled.toLocaleString()} pages · finished {formatAuditDate(audit.completed_at)}
      </p>
    </div>
  );
}

function SeverityCards({ summary }: { readonly summary: AuditSummary }) {
  return (
    <>
      {SEVERITY_ORDER.map((severity) => (
        <div key={severity} className={`rounded-lg border p-4 ${SEVERITY_BADGES[severity]}`}>
          <p className="text-sm">{SEVERITY_LABELS[severity]}</p>
          <p className="text-3xl font-semibold" aria-label={`${SEVERITY_LABELS[severity]} issue count`}>
            {summary.counts_by_severity[severity].toLocaleString()}
          </p>
        </div>
      ))}
    </>
  );
}

function BotRow({ bot }: { readonly bot: BotAccess }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-2 pr-3 font-mono text-xs">{bot.token}</td>
      <td className="py-2 pr-3">{bot.vendor}</td>
      <td className="py-2 pr-3">{BOT_CLASS_LABELS[bot.bot_class]}</td>
      <td className="py-2 pr-3">
        <span className={`rounded-sm border px-2 py-0.5 text-xs ${ACCESS_BADGES[bot.access]}`}>{ACCESS_LABELS[bot.access]}</span>
      </td>
      <td className="py-2 font-mono text-xs text-gray-500">{bot.rule ? `${bot.rule} (line ${bot.line ?? '?'})` : '-'}</td>
    </tr>
  );
}

function AiReadinessPanel({
  readiness, issues, startUrl
}: {
  readonly readiness: AiReadiness;
  readonly issues: number;
  readonly startUrl: string;
}) {
  const unreachable = readiness.robots_kind === 'disallow_all';
  return (
    <section aria-label="AI readiness" className={`${CARD} space-y-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">AI readiness</h3>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-500">{issues.toLocaleString()} AI-readiness issues</p>
          {!unreachable && (
            <ExportExcelButton onExport={() => exportAiCrawlersExcel(readiness.bots, startUrl)}
              failureLabel="[seo] Site audit AI crawlers Excel export failed:" disabled={readiness.bots.length === 0}
              title="Each AI crawler with its robots.txt access" />
          )}
        </div>
      </div>
      <p className="text-sm text-gray-600">
        Whether answer engines can crawl, read and quote the site: robots.txt access for each AI crawler, snippet
        directives, structured data and llms.txt.
      </p>
      {unreachable
        ? <p className="text-sm text-red-700">robots.txt did not answer (status {readiness.robots_status}): crawlers treat the whole site as disallowed.</p>
        : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">AI crawler access in robots.txt</caption>
            <thead className="text-xs uppercase text-gray-500">
              <tr><th className="py-1 pr-3">Crawler</th><th className="py-1 pr-3">Operator</th><th className="py-1 pr-3">Use</th><th className="py-1 pr-3">Access</th><th className="py-1">Rule on /</th></tr>
            </thead>
            <tbody>{readiness.bots.map((bot) => <BotRow key={bot.token} bot={bot} />)}</tbody>
          </table>
        )}
      <p className="text-sm text-gray-600">llms.txt: {LLMS_TXT_LABELS[readiness.llms_txt]}</p>
    </section>
  );
}

interface SiteAuditSummaryProps {
  readonly audit: SiteAudit;
  readonly summary: AuditSummary;
  readonly readiness: AiReadiness | null;
}

export function SiteAuditSummary({
  audit, summary, readiness
}: SiteAuditSummaryProps) {
  const stopped = stopReasonText(audit);
  return (
    <div className="space-y-4">
      {stopped !== null && <output className="block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{stopped}</output>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ScoreCard audit={audit} summary={summary} />
        <SeverityCards summary={summary} />
      </div>
      <p className="text-sm text-gray-600">
        {GROUP_ORDER.map((group) => `${GROUP_LABELS[group]}: ${summary.counts_by_group[group]}`).join(' · ')}
      </p>
      {readiness !== null && <AiReadinessPanel readiness={readiness} issues={summary.counts_by_group.ai_readiness} startUrl={audit.start_url} />}
    </div>
  );
}
