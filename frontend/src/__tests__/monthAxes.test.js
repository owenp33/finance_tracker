import { render } from '@testing-library/react';
import BalanceChart from '../components/insights/charts/BalanceChart';
import RecurringTimelineChart from '../components/insights/charts/RecurringTimelineChart';
import ProjectionChart from '../components/dashboard/ProjectionChart';
import LoanPayoffChart from '../components/goals/LoanPayoffChart';
import { monthsFrom } from '../utils/dates';

// jsdom has no layout, so each chart gets `mockWidth` and is told it as Recharts tells it (onResize)
let mockWidth = 800;
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  const { cloneElement, useEffect } = jest.requireActual('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children, height, onResize }) => {
      useEffect(() => { onResize?.(mockWidth, height); }, [onResize, height]);
      return cloneElement(children, { width: mockWidth, height });
    },
  };
});

// Recharts draws an axis's labels in a layer of their own, apart from the axis
const xLabels = (container) => [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')]
  .map(t => t.textContent);
const YEARS = (from, to, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => String(from + i * step));

beforeEach(() => { mockWidth = 800; });

describe('the balance chart', () => {
  const chart = (from, to) => {
    const points = monthsFrom(from, to).map((month, i) => ({ date: `${month}-01`, cents: i * 10000, kind: i === 0 ? 'start' : 'day' }));
    return render(<BalanceChart points={points} today="2026-11-20" transactions={[]} accountIds={[1]} />).container;
  };

  test('a few months are each named', () => {
    expect(xLabels(chart('2026-08', '2026-11'))).toEqual(['Sep 2026', 'Oct', 'Nov']);
  });

  test('ten years are labelled by year, evenly', () => {
    // 728px for the axis: years alone, every January from Feb 2017's first
    expect(xLabels(chart('2017-01', '2026-11'))).toEqual(YEARS(2018, 2026));
  });
});

test('the recurring timeline labels ten years by year, evenly', () => {
  const payments = monthsFrom('2017-01', '2026-11').map(month => ({ date: `${month}-01`, amount_cents: -120000, changed: false }));
  const row = {
    template: { id: 1, vendor: 'Rent Co' }, kind: 'cost', active: true, ended: null, name: 'Rent Co · Checking',
    payments, posted: { from: '2017-01-01', to: '2026-11-01' }, scheduled: null,
  };
  const { container } = render(<RecurringTimelineChart rows={[row]} today="2026-11-20" windowEnd="2027-02-28" byMonth={{}} />);
  expect(xLabels(container)).toEqual(YEARS(2017, 2027));
});

describe("the Dashboard's 90-day projection", () => {
  const chart = () => render(
    <ProjectionChart start={{ date: '2026-11-20', cents: 100 }} points={[{ date: '2026-12-01', cents: 200 }, { date: '2027-02-18', cents: 300 }]} />
  ).container;

  test('names each month that starts in the next 90 days', () => {
    mockWidth = 300;
    expect(xLabels(chart())).toEqual(['Dec 2026', 'Jan 2027', 'Feb']);
  });

  test('on a narrow card, only as many as fit', () => {
    mockWidth = 150;
    expect(xLabels(chart())).toEqual(['Jan 2027']);
  });
});

describe("a loan's payoff chart", () => {
  const LABELS = { extra: 'With the extra', regular: 'Current payments only' };
  const chart = (from, to) => render(
    <LoanPayoffChart months={monthsFrom(from, to).map(month => ({ month, withExtra: 0, without: 7521700 }))} labels={LABELS} targetOwed={0} />
  ).container;

  test('a short run names every month', () => {
    mockWidth = 600;
    expect(xLabels(chart('2026-11', '2027-04'))).toEqual(['Nov 2026', 'Dec', 'Jan 2027', 'Feb', 'Mar', 'Apr']);
  });

  test('ten years are labelled every other year, evenly', () => {
    mockWidth = 400;
    expect(xLabels(chart('2026-11', '2036-10'))).toEqual(YEARS(2028, 2036, 2));
  });
});
