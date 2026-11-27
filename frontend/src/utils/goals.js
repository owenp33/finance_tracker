import { shiftDays, shiftPeriod } from './dates';
import { FORECAST_DAYS, INTEREST_MONTHS, forecastInputs, forecastFor } from './forecast';
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

// Past this many months, a loan's payoff chart that never reaches its goal stops (10 years)
export const PAYOFF_SHOWN_MONTHS = 120;

// A loan walked month by month from next month, as the server books it: interest on the 1st of each
// of its periods (the rate's share of what's owed), then its regular payments, plus `extraCents` from
// month `startsIn + 1` (never when `startsIn` is null) through month `extraUntil` (to the end when
// null). Each month's {month ('YYYY-MM'), cents (the balance at its end, negative while owed),
// interest}, for `months` months or until the balance reaches `stopAt`.
const loanWalk = ({ startCents, account, regular, extraCents, startsIn, extraUntil = null, today, months, stopAt = null }) => {
  const bps = account?.apr != null ? Math.round(account.apr * 100) : 0;
  const period = INTEREST_MONTHS[account?.interest_frequency ?? 'monthly'];
  const thisMonth = today.slice(0, 7);
  const calendarNow = Number(today.slice(5, 7));
  const path = [];
  let cents = startCents;
  for (let m = 1; m <= months; m += 1) {
    const calendarMonth = ((calendarNow - 1 + m) % 12) + 1;
    const interest = bps && (calendarMonth - 1) % period === 0
      ? Math.floor((Math.max(-cents, 0) * bps * period + 60000) / 120000)
      : 0;
    const extra = startsIn !== null && m > startsIn && (extraUntil === null || m <= extraUntil);
    cents += regular - interest + (extra ? extraCents : 0);
    path.push({ month: shiftPeriod(thisMonth, m), cents, interest });
    if (stopAt !== null && cents >= stopAt) break;
  }
  return path;
};

// A loan goal's months from now until reached (loanWalk), with `monthlyCents` once its turn starts
// (`startsIn`); null when it isn't paid down at this pace
const loanMonths = (goal, monthlyCents, startsIn, account, regular, today) => {
  const path = loanWalk({ startCents: goal.balance_cents, account, regular, extraCents: monthlyCents, startsIn, today,
                          months: GOAL_MONTHS_CAP, stopAt: goal.target_cents });
  return path.length > 0 && path[path.length - 1].cents >= goal.target_cents ? path.length : null;
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

// A loan goal's payoff (F2g), for its chart: what's owed each month from now (cents, never below 0;
// the first is now) with the goal's monthly amount on top of its regular payments once its turn
// starts (`withExtra`) and with the regular payments only (`without`), through the month the plan
// reaches it, else PAYOFF_SHOWN_MONTHS; the interest each path is charged over those months; the
// month the regular payments alone would reach it (null when not within GOAL_MONTHS_CAP); and whether
// what's owed without the extra ends higher than now (`growing`). `plan` is the goal's goalPlan row:
// nothing extra goes toward it when its turn never comes (`startsIn` null).
export const loanPayoff = (goal, plan, { accounts, recurring, today }) => {
  const account = accounts.find(a => a.id === goal.account_id);
  const regular = regularPayments(goal.account_id, recurring);
  const extraCents = plan.startsIn === null ? 0 : plan.monthlyCents;
  const walk = { startCents: goal.balance_cents, account, regular, startsIn: plan.startsIn, today,
                 months: plan.months ?? PAYOFF_SHOWN_MONTHS };
  const withExtra = loanWalk({ ...walk, extraCents });
  const without = loanWalk({ ...walk, extraCents: 0 });
  const owed = (cents) => Math.max(-cents, 0);
  const interest = (path) => path.reduce((sum, point) => sum + point.interest, 0);
  const thisMonth = today.slice(0, 7);
  const withoutMonths = loanMonths(goal, 0, 0, account, regular, today);
  return {
    regularCents: regular,
    extraCents,
    extraFrom: extraCents > 0 ? shiftPeriod(thisMonth, plan.startsIn + 1) : null,
    months: [
      { month: thisMonth, withExtra: owed(goal.balance_cents), without: owed(goal.balance_cents) },
      ...withExtra.map((point, i) => ({ month: point.month, withExtra: owed(point.cents), without: owed(without[i].cents) })),
    ],
    interestWith: interest(withExtra),
    interestWithout: interest(without),
    reachMonth: plan.reachMonth,
    withoutReachMonth: withoutMonths === null ? null : shiftPeriod(thisMonth, withoutMonths),
    growing: without.length > 0 && owed(without[without.length - 1].cents) > owed(goal.balance_cents),
  };
};

// The goals' plan as the Budgeting page and Insights → Accounts both show it: the room each month
// (monthlyRoom, over every account in `accounts`), each goal's plan (goalPlan) and each loan goal's
// payoff (loanPayoff; null for any other goal and for a loan goal already reached). Before the goals
// load (`goals` null), the room alone.
export const planGoals = ({ goals, accounts, transactions, recurring, occurrences, today }) => {
  const room = monthlyRoom(transactions, recurring, occurrences, accounts.map(a => a.id), today);
  if (!goals) return { room, plans: [], payoffs: [] };
  const plans = goalPlan(goals, { roomCents: room, accounts, recurring, today });
  const payoffs = goals.map((goal, i) => (goal.account_kind === 'loan' && plans[i].status !== 'held'
    ? loanPayoff(goal, plans[i], { accounts, recurring, today })
    : null));
  return { room, plans, payoffs };
};

// The plan over time, for Insights → Accounts' goal plan chart. `plans` are goalPlan's, in the goals'
// order. Returns:
// - `months` ('YYYY-MM'): this month through the month the last goal is reached, or at least
//   PAYOFF_SHOWN_MONTHS on when one isn't reached at this pace; none when every goal is reached
// - `funding`: per month, the goal the monthly amount goes to and how much ({id, cents}); null this
//   month (the plan starts next month) and when nothing goes toward one
// - `goals`: each goal's {id, goal, owed (a loan, drawn as what's owed), target, path (cents per
//   month; null for a reached goal)}. A savings-like goal holds until its turn, then gains its
//   monthly amount up to its target, where it stays; a loan is walked as on its payoff chart, its own
//   amount stopping once it's reached while its regular payments go on
// - `handoffs`: the months a goal is reached and the next takes over ({month, from, to})
export const goalTimeline = (goals, plans, { accounts, recurring, today }) => {
  const thisMonth = today.slice(0, 7);
  const open = plans.filter(plan => plan.status !== 'held');
  const known = open.filter(plan => plan.months !== null).map(plan => plan.months);
  const last = open.length === 0 ? null : Math.max(...known, known.length < open.length ? PAYOFF_SHOWN_MONTHS : 0);
  const months = last === null ? [] : Array.from({ length: last + 1 }, (_, m) => shiftPeriod(thisMonth, m));

  const lines = goals.map((goal, i) => {
    const plan = plans[i];
    const owed = goal.account_kind === 'loan';
    const line = { id: goal.id, goal, owed, target: owed ? Math.max(-goal.target_cents, 0) : goal.target_cents, path: null };
    if (plan.status === 'held' || months.length === 0) return line;
    if (!owed) {
      const gain = (m) => (plan.startsIn === null ? 0 : plan.monthlyCents * Math.max(m - plan.startsIn, 0));
      return { ...line, path: months.map((_, m) => Math.min(goal.balance_cents + gain(m), goal.target_cents)) };
    }
    const walk = loanWalk({
      startCents: goal.balance_cents, account: accounts.find(a => a.id === goal.account_id),
      regular: regularPayments(goal.account_id, recurring), extraCents: plan.monthlyCents, startsIn: plan.startsIn,
      extraUntil: plan.months, today, months: months.length - 1,
    });
    return { ...line, path: [goal.balance_cents, ...walk.map(point => point.cents)].map(cents => Math.max(-cents, 0)) };
  });

  const funding = months.map((_, m) => {
    const plan = m > 0 && open.find(p => p.startsIn !== null && m > p.startsIn && (p.months === null || m <= p.months));
    return plan && plan.monthlyCents > 0 ? { id: plan.id, cents: plan.monthlyCents } : null;
  });
  const handoffs = open.slice(0, -1).flatMap((plan, i) => (plan.reachMonth
    ? [{ month: plan.reachMonth, from: plan.id, to: open[i + 1].id }]
    : []));
  return { months, funding, goals: lines, handoffs };
};

// The active goal (the first not reached) with its plan, or null when there's none
export const activeSaving = (goals, plans) => {
  const index = (plans ?? []).findIndex(plan => plan.status === 'active');
  return goals && index >= 0 ? { goal: goals[index], plan: plans[index] } : null;
};

// How far an account's balance moved in a month ('YYYY-MM'): its transactions dated then, transfers
// included, and its interest hits and a loan's payments when given utils/balanceMoves.js
// balanceMoves (what went toward a goal on it so far)
export const movedThisMonth = (transactions, accountId, period) => transactions
  .filter(t => t.account_id === accountId && t.date.startsWith(period))
  .reduce((sum, t) => sum + t.amount_cents, 0);

// Where a balance forecast (utils/forecast.js forecastPoints) takes a goal: for a goal not reached
// yet, the first forecast day at or past its target (`reachesOn`); for one reached and held, the
// first forecast day under it (`dipsOn`); null when that doesn't happen within the forecast
export const forecastAgainstGoal = (goal, forecast) => {
  const days = forecast.filter(point => point.kind === 'forecast');
  if (goal.reached) {
    return { reachesOn: null, dipsOn: days.find(point => point.cents < goal.target_cents)?.date ?? null };
  }
  return { reachesOn: days.find(point => point.cents >= goal.target_cents)?.date ?? null, dipsOn: null };
};

// Each reached (held) goal whose account's forecast falls under its target within the next 90 days
// (forecastFor over that account alone, from its balance in `accounts`), as {goal, dipsOn}, in the
// goals' order; the Dashboard's goal card warns of each
export const goalDips = (goals, { accounts, transactions, recurring, occurrences, today }) => {
  const startOf = (account) => Math.round(account.balance * 100);
  return (goals ?? []).filter(goal => goal.reached).flatMap(goal => {
    const account = accounts.find(a => a.id === goal.account_id);
    if (!account) return [];
    const { points } = forecastFor({ accounts, accountIds: [account.id], startCents: startOf(account), startOf,
                                     transactions, recurring, occurrences, today });
    const { dipsOn } = forecastAgainstGoal(goal, points);
    return dipsOn ? [{ goal, dipsOn }] : [];
  });
};
