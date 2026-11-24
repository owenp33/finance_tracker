"""
scheduler.py - Background scheduler for recurring transaction processing.

Runs process_due_recurring, and the interest due (InterestService.accrue), for every account on
startup (catch-up for any days the server was offline) and then once per day at 00:05, so
recurring transactions and interest are booked even when no user is logged in.
"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


def _process_all(app):
    """
    Generate all due recurring transactions, and book the interest due, across every account.
    Must be called with an app reference so it can push its own app context —
    APScheduler jobs run in a background thread with no active context.
    """
    with app.app_context():
        from services.db_service import DbService
        from services.interest_service import InterestService
        from services.recurring_service import RecurringService

        db_svc = DbService()
        interest_svc = InterestService()
        recurring_svc = RecurringService()

        total = 0
        for account in db_svc.get_all_accounts():
            try:
                total += recurring_svc.process_due_recurring(account.id)
            except Exception:
                logger.exception(
                    "Scheduler: failed to process recurring for account %s", account.id
                )
            try:
                interest_svc.accrue(account.id)
            except Exception:
                logger.exception("Scheduler: failed to book interest for account %s", account.id)

        if total:
            logger.info("Scheduler: generated %d recurring transaction(s)", total)


def init_scheduler(app):
    """
    Run an immediate catch-up pass then start a daily background job.
    Call once from create_app(), after db.create_all().
    Returns the running scheduler so the caller can shut it down if needed.
    """
    # Catch up on any transactions missed while the server was offline
    _process_all(app)

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(
        _process_all,
        CronTrigger(hour=0, minute=5),  # 00:05 every day
        args=[app],
        id='process_recurring',
        replace_existing=True,
        misfire_grace_time=3600,        # tolerate up to 1 h of server downtime
    )
    scheduler.start()
    logger.info("Recurring transaction scheduler started (daily at 00:05)")
    return scheduler
