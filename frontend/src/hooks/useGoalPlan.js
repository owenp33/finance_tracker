import { useGoals } from './useGoals';
import { useProjection } from './useProjection';
import { FORECAST_DAYS } from '../utils/forecast';
import { planGoals } from '../utils/goals';
import { todayISO } from '../utils/dates';

// Everything the Budgeting page shows about goals (Phase F, F2b/F2c): the goals (useGoals), the
// room each month, each goal's plan and each loan goal's payoff (utils/goals.js planGoals, from the
// next 90 days' projection and `transactions`, across every account), the next 90 days' projection
// (`occurrences`, for the Dashboard's 90-day projection too), and the changes (add, edit, remove,
// reorder). Errors go to onError, which must be stable (the hooks refetch when it changes).
export function useGoalPlan({ accounts, transactions, recurring, onError }) {
  const { goals, addGoal, editGoal, removeGoal, reorder } = useGoals(onError, accounts);
  const occurrences = useProjection(FORECAST_DAYS, onError);
  const { room, plans, payoffs } = planGoals({ goals, accounts, transactions, recurring, occurrences, today: todayISO() });
  return { goals, plans, room, payoffs, occurrences, addGoal, editGoal, removeGoal, reorder };
}
