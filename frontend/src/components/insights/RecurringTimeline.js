import { useState } from 'react';
import RecurringTimelineChart, { TimelineLegend } from './charts/RecurringTimelineChart';
import ViewAsTable from '../ViewAsTable';
import { formatDate } from '../transactions/utils';
import { useProjection } from '../../hooks/useProjection';
import { todayISO, shiftPeriod, daysInMonth, dayNumber, monthRangeLabel } from '../../utils/dates';
import { seriesTimeline } from '../../utils/recurring';
import { cashFlowByMonth } from '../../utils/moneyRules';

// How far ahead the timeline shows what's still scheduled: through the end of the third month after this one
const MONTHS_AHEAD = 3;

const SHOW = [['active', 'Active'], ['ended', 'Ended'], ['all', 'All']];
const EMPTY = { active: 'No active series.', ended: 'No ended series.', all: 'No recurring series yet.' };

const TABLE_COLUMNS = [
  'Series', 'Account', 'First payment', 'Last payment', 'Payments', 'Amount changes', 'Still scheduled',
];

// A stable stand-in when no one listens for errors (useProjection refetches when it changes)
const IGNORE_ERROR = () => {};

// What's still scheduled, in words
const scheduledLabel = (row) => {
  if (!row.active) return row.ended ? `Ended ${monthRangeLabel(row.ended, row.ended)}` : 'Ended';
  if (row.continues) return 'Ongoing';
  return row.scheduled ? `Through ${formatDate(row.scheduled.to, true)}` : '—';
};

// Insights → Recurring's timeline (Phase V, V3b): each series from its first payment to its last,
// then what's still scheduled, with an Active / Ended / All choice. `accountName(id)` names an
// account; `onError` reports a failed projection.
function RecurringTimeline({ recurring, transactions, accountName, onError = IGNORE_ERROR }) {
  const [show, setShow] = useState('active');
  const today = todayISO();
  const endPeriod = shiftPeriod(today.slice(0, 7), MONTHS_AHEAD);
  const windowEnd = `${endPeriod}-${String(daysInMonth(endPeriod)).padStart(2, '0')}`;
  const occurrences = useProjection(dayNumber(windowEnd) - dayNumber(today), onError);

  const rows = seriesTimeline(recurring, transactions, occurrences, today, windowEnd)
    .filter(row => show === 'all' || (show === 'active') === row.active)
    .map(row => {
      const account = accountName(row.template.account_id);
      const ended = row.ended ? `ended ${monthRangeLabel(row.ended, row.ended)}` : 'ended';
      return {
        ...row,
        account,
        name:           [row.template.vendor, account, row.kind === 'income' && 'income', !row.active && ended].filter(Boolean).join(' · '),
        changes:        row.payments.filter(p => p.changed).length,
        scheduledLabel: scheduledLabel(row),
      };
    });

  return (
    <section className="chart-container recurring-timeline">
      <div className="recurring-timeline-header">
        <h3>Timeline</h3>
        <div className="timeline-toggle" role="group" aria-label="Series to show">
          {SHOW.map(([key, label]) => (
            <button
              key={key} type="button" aria-pressed={show === key}
              className={`timeline-toggle-btn${show === key ? ' active' : ''}`} onClick={() => setShow(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.length > 0 ? (
        <>
          <RecurringTimelineChart rows={rows} today={today} windowEnd={windowEnd} byMonth={cashFlowByMonth(transactions)} />
          <TimelineLegend />
          <ViewAsTable
            caption="Recurring series timeline"
            columns={TABLE_COLUMNS}
            rows={rows.map(row => [
              row.kind === 'income' ? `${row.template.vendor} (income)` : row.template.vendor,
              row.account,
              row.posted ? formatDate(row.posted.from, true) : '—',
              row.posted ? formatDate(row.posted.to, true) : '—',
              row.payments.length, row.changes, row.scheduledLabel,
            ])}
          />
        </>
      ) : (
        <p className="no-data">{EMPTY[show]}</p>
      )}
    </section>
  );
}

export default RecurringTimeline;
