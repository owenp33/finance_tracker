"""
recurring_service.py - Recurring Transaction Business Logic

Templates (create, update, delete) and generating their due occurrences. Transactions are
created through AccountService.add_transaction, so balances and budget flags stay in one place.
"""
from datetime import date
from extensions import db
from models.transaction import TransactionModel
from models.recurring import RecurringModel, FREQUENCY_UNITS
from services.account_service import AccountService
from services.db_service import DbService

db_service = DbService()
account_service = AccountService()


def _check_schedule(frequency, unit):
    """Raise ValueError unless a recurring template repeats every whole number (≥ 1) of days or months."""
    if unit not in FREQUENCY_UNITS:
        raise ValueError(f"Frequency unit must be {' or '.join(repr(u) for u in FREQUENCY_UNITS)}.")
    # 0 would never advance the next date, so generation would loop forever
    if isinstance(frequency, bool) or not isinstance(frequency, int) or frequency < 1:
        raise ValueError('Frequency must be a whole number of at least 1.')


class RecurringService:

    # TEMPLATES =================================================================

    def add_recurring(self, account_id, start_date, vendor, category, amount,
                      next_date, frequency, number=-1, notes="", frequency_unit='days', skip_past=False):
        """
        Create a recurring template and commit. It repeats every `frequency` days, or every
        `frequency` calendar months on the day of next_date (the last day in shorter months).
        With skip_past, occurrences before today are skipped so history isn't generated again:
        the template starts at its first occurrence on or after today, keeping its rhythm.
        """
        _check_schedule(frequency, frequency_unit)
        if number == 0:
            raise ValueError('Number of occurrences must be -1 (infinite) or at least 1')
        rec = RecurringModel(
            account_id=account_id,
            start_date=start_date,
            vendor=vendor,
            category=category,
            amount=amount,
            next_date=next_date,
            frequency=frequency,
            frequency_unit=frequency_unit,
            day_of_month=next_date.day if frequency_unit == 'months' else None,
            number=number,
            notes=notes,
            idx=1,
        )
        if skip_past:
            while rec.next_date < date.today():
                rec.next_date = rec.advance_to_next
            rec.start_date = rec.next_date
        db.session.add(rec)
        db.session.commit()
        return rec

    def update_recurring(self, recurring_id, **kwargs):
        """
        Update a recurring transaction template.
        The occurrence limit (number) cannot be reduced below the count of
        transactions already generated for this recurring item. A template that becomes
        monthly, or whose next date moves, falls on the day of its (new) next date from then on.
        """
        rec = db_service.get_recurring(recurring_id)
        if not rec:
            return False

        if 'frequency' in kwargs or 'frequency_unit' in kwargs:
            _check_schedule(kwargs.get('frequency', rec.frequency), kwargs.get('frequency_unit', rec.frequency_unit))
        if 'number' in kwargs:
            new_number = kwargs['number']
            if new_number == 0:
                raise ValueError('Number of occurrences must be -1 (infinite) or at least 1')
            if new_number != -1:
                generated_count = TransactionModel.query.filter_by(recurring_id=recurring_id).count()
                if new_number < generated_count:
                    raise ValueError(
                        f'Number of occurrences cannot be less than the {generated_count} transaction(s) already generated'
                    )

        old_next_date, old_unit = rec.next_date, rec.frequency_unit
        updatable_fields = ['start_date', 'vendor', 'category', 'amount', 'notes', 'next_date',
                            'frequency', 'frequency_unit', 'number']
        for field in updatable_fields:
            if field in kwargs:
                if field == 'amount':
                    rec.amount = kwargs[field]  # Property converts dollars to cents
                else:
                    setattr(rec, field, kwargs[field])

        # Re-saving an unchanged next date keeps the anchor, so a 31st template clamped to
        # Feb 28 still returns to Mar 31
        if rec.frequency_unit != 'months':
            rec.day_of_month = None
        elif old_unit != 'months' or rec.next_date != old_next_date:
            rec.day_of_month = rec.next_date.day

        db.session.commit()
        return rec

    def delete_recurring(self, recurring_id, delete_generated=False):
        """
        Delete a recurring transaction template.
        If delete_generated=True, also deletes all auto-generated transactions
        from this recurring and reverses their effect on the account balance.
        Otherwise, those transactions are kept but unlinked from the recurring.
        """
        rec = db_service.get_recurring(recurring_id)
        if not rec:
            return False

        if delete_generated:
            transactions = TransactionModel.query.filter_by(recurring_id=recurring_id).all()
            for trans in transactions:
                account = db_service.get_account(trans.account_id)
                if account:
                    account.balance_cents -= trans.amount_cents
                db.session.delete(trans)
        else:
            TransactionModel.query.filter_by(recurring_id=recurring_id).update({'recurring_id': None})

        db.session.delete(rec)
        db.session.commit()
        return True

    # GENERATION ================================================================

    def process_due_recurring(self, account_id):
        """
        Generate transactions for all due recurring items. Intended to be called
        on user login. Returns the number of transactions created.
        """
        recurring_list = db_service.get_account_recurring(account_id)
        transactions_created = 0
        today = date.today()

        for rec in recurring_list:
            while rec.next_date <= today and (rec.number == -1 or rec.idx <= rec.number):
                account_service.add_transaction(
                    account_id=account_id,
                    date_obj=rec.next_date,
                    vendor=rec.vendor,
                    category=rec.category,
                    amount=rec.amount,
                    notes=rec.notes or '',
                    recurring_id=rec.id,
                    recurring_index=rec.idx,
                )

                rec.next_date = rec.advance_to_next
                rec.idx += 1
                transactions_created += 1

                if rec.number != -1 and rec.idx > rec.number:
                    break

        db.session.commit()   # persist rec.next_date updates
        return transactions_created
