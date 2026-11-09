import { ReportSection } from '../../layout';
import { NoDataYet } from '../../../ui/NoDataYet';

interface Props {readonly keyword: string;}

/**
 * The whole report for a keyword no AI engine has answered yet: one notice
 * with what to do next, instead of a stack of empty and failed sections.
 */
export function NoAnswersNotice({ keyword }: Props) {
  return (
    <ReportSection title="No AI answers yet">
      <NoDataYet keyword={keyword}>
        No AI engine has answered for &ldquo;{keyword}&rdquo; yet, so this report has nothing to show.
        Pick another keyword above, or run an analysis that includes this one.
      </NoDataYet>
    </ReportSection>
  );
}
