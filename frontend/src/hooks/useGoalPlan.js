import { useGoals } from './useGoals';
import { useProjection } from './useProjection';
import { FORECAST_DAYS } from '../utils/forecast';
import { monthlyRoom, goalPlan } from '../utils/goals';
import { todayISO } from '../utils/dates';

// Everything the Budgeting page shows about goals (Phase F, F2b/F2c): the goals (useGoals), the
// room each month (from the next 90 days' projection and `transactions`, across every account),
// each goal's plan (utils/goals.js goalPlan), and the changes (add, edit, remove, reorder). Errors
// go to onError, which must be stable (the hooks refetch when it changes).
export function useGoalPlan({ accounts, transactions, recurring, onError }) {
  const { goals, addGoal, editGoal, removeGoal, reorder } = useGoals(onError, accounts);
  const occurrences = useProjection(FORECAST_DAYS, onError);
  const today = todayISO();
  const room = monthlyRoom(transactions, recurring, occurrences, accounts.map(a => a.id), today);
  const plans = goals ? goalPlan(goals, { roomCents: room, accounts, recurring, today }) : [];
  return { goals, plans, room, addGoal, editGoal, removeGoal, reorder };
}
