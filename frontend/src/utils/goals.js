import { shiftDays, shiftPeriod } from './dates';
import { FORECAST_DAYS, INTEREST_MONTHS, forecastInputs } from './forecast';
import { isFinished, monthlyEquivalent } from './recurring';

// Goals (Phase F, F2), in cents: how much to put toward them each month, and when each is reached.
// Goals run in order (GET /api/goals): a reached goal is held and needs nothing; the first one not
// reached is active and gets the month's room, the user's own monthly amount if the goal has one;
// each goal after it starts when the one before is reached.

// Past this many months a goal isn't reached "at this pace"
export const GOAL_MONTHS_CAP = 600;

// The money left each month after spending, for goals: over the next 90 days in the accounts
// `accountIds`, the scheduled income less the scheduled charges and the average spending the
// forecast counts (utils/forecast.js forecastInputs), divided by 3. Negative when spending outruns
// income.
export const monthlyRoom = (transactions, recurring, occurrences, accountIds, today) => {
  const { occurrences: kept, averages } = forecastInputs(transactions, recurring, occurrences, accountIds, today);
  const end = shiftDays(today, FORECAST_DAYS);
  const scheduled = kept
    .filter(o => o.date >= today && o.date <= end)
    .reduce((sum, o) => sum + Math.round(o.amount * 100), 0);
  const averaged = Object.values(averages).reduce((sum, cents) => sum + cents, 0);
  return Math.round(((scheduled - averaged) * 30) / FORECAST_DAYS);
};

// What a loan account is paid each month by the active series that pay it down (their templates'
// loan_account_id), as a positive amount
export const regularPayments = (loanAccountId, recurring) => recurring
  .filter(template => template.loan_account_id === loanAccountId && !isFinished(template))
  .reduce((sum, template) => sum - monthlyEquivalent(template), 0);

// A savings-like goal's months from now until reached: its turn starts `startsIn` months from now,
// then `monthlyCents` a month toward what's left; null when nothing goes toward it, or past the cap
const bankMonths = (goal, monthlyCents, startsIn) => {
  const left = goal.target_cents - goal.balance_cents;
  if (left <= 0) return startsIn;
  if (monthlyCents <= 0) return null;
  const months = startsIn + Math.ceil(left / monthlyCents);
  return months > GOAL_MONTHS_CAP ? null : months;
};

// A loan goal's months from now until reached, month by month as the server books it: interest on
// the 1st of each of its periods (the rate's share of what's owed), then its regular payments, plus
// `monthlyCents` once its turn starts (`startsIn`). Null when it isn't paid down at this pace.
const loanMonths = (goal, monthlyCents, startsIn, account, regular, today) => {
  const bps = account?.apr != null ? Math.round(account.apr * 100) : 0;
  const months = INTEREST_MONTHS[account?.interest_frequency ?? 'monthly'];
  const thisMonth = Number(today.slice(5, 7));
  let owed = goal.balance_cents;
  for (let m = 1; m <= GOAL_MONTHS_CAP; m += 1) {
    const calendarMonth = ((thisMonth - 1 + m) % 12) + 1;
    if (bps && (calendarMonth - 1) % months === 0) {
      owed -= Math.floor((Math.max(-owed, 0) * bps * months + 60000) / 120000);
    }
    owed += regular + (m > startsIn ? monthlyCents : 0);
    if (owed >= goal.target_cents) return m;
  }
  return null;
};

// Each goal's plan, in order: {id, status ('held' | 'active' | 'waiting'), monthlyCents (what goes
// toward it each month in its turn: its own amount, else the suggestion; 0 when held), suggestedCents
// (the room, never below 0), own (it has its own amount), startsIn (months from now its turn starts;
// null when a goal before it isn't reached at this pace, or it's held), months (months from now
// until reached; 0 when held, null when not at this pace), reachMonth ('YYYY-MM', or null)}.
// `accounts` (GET /api/accounts) give a loan's rate and frequency; `recurring` its regular payments.
export const goalPlan = (goals, { roomCents, accounts, recurring, today }) => {
  const suggestedCents = Math.max(roomCents, 0);
  const thisMonth = today.slice(0, 7);
  let startsIn = 0;
  let activeFound = false;
  return goals.map(goal => {
    if (goal.reached) {
      return { id: goal.id, status: 'held', monthlyCents: 0, suggestedCents, own: false, startsIn: null, months: 0, reachMonth: null };
    }
    const own = goal.monthly_cents != null;
    const monthlyCents = own ? goal.monthly_cents : suggestedCents;
    const status = activeFound ? 'waiting' : 'active';
    activeFound = true;
    let months = null;
    if (startsIn !== null) {
      months = goal.account_kind === 'loan'
        ? loanMonths(goal, monthlyCents, startsIn, accounts.find(a => a.id === goal.account_id),
                     regularPayments(goal.account_id, recurring), today)
        : bankMonths(goal, monthlyCents, startsIn);
    }
    const row = { id: goal.id, status, monthlyCents, suggestedCents, own, startsIn, months,
                  reachMonth: months === null ? null : shiftPeriod(thisMonth, months) };
    startsIn = months;
    return row;
  });
};

// The active goal (the first not reached) with its plan, or null when there's none
export const activeSaving = (goals, plans) => {
  const index = (plans ?? []).findIndex(plan => plan.status === 'active');
  return goals && index >= 0 ? { goal: goals[index], plan: plans[index] } : null;
};

// How far an account's balance moved in a month ('YYYY-MM'): its transactions dated then, transfers,
// loan entries and interest included (what went toward a goal on it so far)
export const movedThisMonth = (transactions, accountId, period) => transactions
  .filter(t => t.account_id === accountId && t.date.startsWith(period))
  .reduce((sum, t) => sum + t.amount_cents, 0);
