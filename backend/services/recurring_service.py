"""
recurring_service.py - Recurring Transaction Business Logic

Templates (create, update, delete), generating their due occurrences, and which existing
transactions belong to a series. Transactions are created through AccountService.add_transaction,
so balances and budget flags stay in one place.
"""
from datetime import date, timedelta
from extensions import db
from models.transaction import TransactionModel
from models.recurring import RecurringModel, FREQUENCY_UNITS
from models.recurring_dismissal import RecurringDismissalModel
from models.recurring_alias import RecurringAliasModel
from services.account_service import AccountService
from services.db_service import DbService
from services.vendor_match import clean_vendor

db_service = DbService()
account_service = AccountService()

# A transaction up to this many days from an occurrence still counts as that occurrence
MATCH_WINDOW_DAYS = 3

ALIAS_LENGTH = RecurringAliasModel.alias.type.length

# Looking for history before a series started stops after this many occurrences in a row
# without a matching transaction
HISTORY_MISSES_TO_STOP = 2


def _check_schedule(frequency, unit):
    """Raise ValueError unless a recurring template repeats every whole number (≥ 1) of days or months."""
    if unit not in FREQUENCY_UNITS:
        raise ValueError(f"Frequency unit must be {' or '.join(repr(u) for u in FREQUENCY_UNITS)}.")
    # 0 would never advance the next date, so generation would loop forever
    if isinstance(frequency, bool) or not isinstance(frequency, int) or frequency < 1:
        raise ValueError('Frequency must be a whole number of at least 1.')


def _renumber(rec):
    """Number a series' transactions 1, 2, ... by date, and point idx at the next occurrence."""
    db.session.flush()
    db.session.expire(rec, ['generated_transactions'])   # reload: membership just changed
    occurrences = sorted(rec.generated_transactions, key=lambda t: (t.date, t.id))
    for index, transaction in enumerate(occurrences, start=1):
        transaction.recurring_index = index
    rec.idx = len(occurrences) + 1


def _apply_to_series(rec, changes):
    """
    Give every transaction in the series the template's new vendor and/or category (nothing
    else); a transfer's peer follows, as when a transaction is edited. (Over-budget flags are
    computed when transactions are read, so they follow a category change on their own.)
    """
    for t in rec.generated_transactions:
        for field, value in changes.items():
            setattr(t, field, value)
            if t.is_transfer and t.transfer_peer:
                setattr(t.transfer_peer, field, value)


def _series_and_transaction(recurring_id, transaction_id):
    """The template and the transaction; raises ValueError when either doesn't exist."""
    rec = db_service.get_recurring(recurring_id)
    if not rec:
        raise ValueError('Recurring transaction not found.')
    tx = db_service.get_transaction(transaction_id)
    if not tx:
        raise ValueError('Transaction not found.')
    return rec, tx


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
        A changed vendor and/or category is applied to every transaction in the series too.
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
        # The edit form sends every field on each save, so only real changes reach the series
        series_changes = {field: kwargs[field] for field in ('vendor', 'category')
                          if field in kwargs and kwargs[field] != getattr(rec, field)}
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

        if series_changes:
            _apply_to_series(rec, series_changes)

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
                db_service.adjust_balance(trans.account_id, -trans.amount_cents)
                db.session.delete(trans)
        else:
            TransactionModel.query.filter_by(recurring_id=recurring_id).update({'recurring_id': None})

        db.session.delete(rec)
        db.session.commit()
        return True

    # SERIES MEMBERSHIP =========================================================

    def match_candidates(self, rec, occurrence_date):
        """
        Transactions in no series that are rec's occurrence on occurrence_date by the strict rule
        used for linking without asking: same account, vendor and amount, within
        ±MATCH_WINDOW_DAYS, and not dismissed for this series. Nearest first. (Suggestions use a
        looser rule; see suggest_matches.)
        """
        dismissed = db_service.get_dismissed_transaction_ids(rec.id)
        found = db_service.find_recurring_candidates(
            rec.account_id, rec.vendor, rec.amount_cents, occurrence_date, MATCH_WINDOW_DAYS
        )
        return [t for t in found if t.id not in dismissed]

    def link_transaction(self, recurring_id, transaction_id):
        """
        Make an existing transaction an occurrence of a series, leaving its fields and the balance
        alone (a manual link needn't match). It must be on the series' account, in no other
        series, and dated no later than the next occurrence plus the match window. Near the next
        occurrence, it fills it and the next date moves on; older, it joins the history (a limited
        series' total grows by one so its remaining occurrences stay the same, and the start date
        moves back if needed). Occurrence numbers follow date order. A transaction marked
        unrelated to the series loses that mark. Raises ValueError otherwise.
        """
        rec, tx = _series_and_transaction(recurring_id, transaction_id)
        if tx.account_id != rec.account_id:
            raise ValueError('A transaction can only join a recurring series on its own account.')
        if tx.recurring_id is not None:
            raise ValueError('That transaction is already part of a recurring series.')
        window = timedelta(days=MATCH_WINDOW_DAYS)
        if tx.date > rec.next_date + window:
            next_label = f'{rec.next_date:%b} {rec.next_date.day}, {rec.next_date.year}'
            raise ValueError(f"That transaction is dated after the series' next occurrence ({next_label}).")

        is_active = rec.number == -1 or rec.idx <= rec.number
        if is_active and tx.date >= rec.next_date - window:
            rec.next_date = rec.advance_to_next
        elif rec.number != -1:
            rec.number += 1
        rec.start_date = min(rec.start_date, tx.date)

        dismissal = db_service.get_dismissal(rec.id, tx.id)
        if dismissal:
            db.session.delete(dismissal)
        tx.recurring_id = rec.id
        _renumber(rec)
        db.session.commit()
        return rec

    def unlink_transaction(self, recurring_id, transaction_id):
        """
        Take a transaction out of its series, keeping the transaction. Like deleting a generated
        transaction, this shrinks the series: later occurrences renumber and a limited series'
        total drops by one. Raises ValueError when it isn't in this series.
        """
        rec, tx = _series_and_transaction(recurring_id, transaction_id)
        if tx.recurring_id != rec.id:
            raise ValueError("That transaction isn't part of this recurring series.")

        tx.recurring_id = None
        tx.recurring_index = None
        if rec.number > 0:
            rec.number -= 1
        _renumber(rec)
        db.session.commit()
        return rec

    def replace_occurrence(self, transaction_id, date_obj, amount_cents, notes=''):
        """
        Give a series transaction the real charge's date and amount (an imported bank row
        replacing the generated or linked copy), moving the balance by the difference. Its vendor
        and category stay the series'; its notes change only when notes are given. A transfer's
        peer follows, as when a transaction is edited. Occurrence numbers follow date order and
        the start date moves back if needed; the template's own amount doesn't change. Raises
        ValueError for a transaction in no series.
        """
        tx = db_service.get_transaction(transaction_id)
        if not tx or tx.recurring_id is None:
            raise ValueError("That transaction isn't part of a recurring series.")

        db_service.adjust_balance(tx.account_id, amount_cents - tx.amount_cents)
        tx.date, tx.amount_cents = date_obj, amount_cents
        if notes:
            tx.notes = notes
        peer = tx.transfer_peer if tx.is_transfer else None
        if peer:
            db_service.adjust_balance(peer.account_id, -amount_cents - peer.amount_cents)
            peer.date, peer.amount_cents = date_obj, -amount_cents
            if notes:
                peer.notes = notes

        rec = tx.recurring_source
        rec.start_date = min(rec.start_date, date_obj)
        _renumber(rec)
        db.session.commit()
        return tx

    def remember_alias(self, recurring_id, vendor):
        """
        Remember a vendor's cleaned spelling (vendor_match.clean_vendor) as another name of the
        series, which the import preview then treats as exact. Harmless when it's already
        remembered or nothing is left after cleaning.
        """
        alias = clean_vendor(vendor)[:ALIAS_LENGTH].strip()
        if alias and not db_service.get_alias(recurring_id, alias):
            db.session.add(RecurringAliasModel(recurring_id=recurring_id, alias=alias))
            db.session.commit()

    def suggest_matches(self, recurring_id):
        """
        Transactions that may belong to a series, for the user to confirm; nothing is linked.
        Candidates share the series' account and vendor and move money the same way, with either
        the same category (any amount) or the exact same amount (any category). Each
        occurrence owns the days from MATCH_WINDOW_DAYS after the previous occurrence up to
        MATCH_WINDOW_DAYS after itself, so a payment up to a full period early counts, a few days
        late counts for the occurrence before, and every transaction falls to exactly one.
        Walking the schedule back from the next occurrence, an occurrence with candidates becomes
        a suggestion of one kind:
          'missing'   since the series started, with no transaction of the series in its window
          'duplicate' already covered by the series: the same charge twice, or an extra
                      payment that belongs to the series too (the user decides)
          'history'   before the series started; the walk stops after HISTORY_MISSES_TO_STOP
                      such occurrences in a row without a candidate
        Transactions dismissed for the series are skipped. Returns [{date, kind, linked,
        candidates}], oldest first; candidates nearest first, and `linked` holds the series'
        transactions in the occurrence's window.
        """
        rec = db_service.get_recurring(recurring_id)
        if not rec:
            raise ValueError('Recurring transaction not found.')
        late = timedelta(days=MATCH_WINDOW_DAYS)
        series = list(rec.generated_transactions)
        dismissed = db_service.get_dismissed_transaction_ids(rec.id)

        suggestions = []
        occurrence, history_misses = rec.shift(rec.next_date, -1), 0
        while history_misses < HISTORY_MISSES_TO_STOP:
            after, until = rec.shift(occurrence, -1) + late, occurrence + late
            found = db_service.find_unlinked_transactions(rec.account_id, rec.vendor, rec.category,
                                                          rec.amount_cents, after, until)
            candidates = sorted(
                (t for t in found if t.id not in dismissed),
                key=lambda t: (abs((t.date - occurrence).days), t.id),
            )
            linked = [t for t in series if after < t.date <= until]
            if occurrence >= rec.start_date - late:
                kind = 'duplicate' if linked else 'missing'
            else:
                kind = 'history'
                history_misses = 0 if candidates else history_misses + 1
            if candidates:
                suggestions.append({'date': occurrence, 'kind': kind, 'linked': linked, 'candidates': candidates})
            occurrence = rec.shift(occurrence, -1)

        return suggestions[::-1]

    def dismiss_suggestion(self, recurring_id, transaction_id):
        """
        Record that a transaction isn't part of a series, so its suggestions skip it (dismissing
        again is harmless). Raises ValueError for a transaction in the series or on another account.
        """
        rec, tx = _series_and_transaction(recurring_id, transaction_id)
        if tx.recurring_id == rec.id:
            raise ValueError('That transaction is part of this recurring series.')
        if tx.account_id != rec.account_id:
            raise ValueError("That transaction isn't on this recurring series' account.")

        if not db_service.get_dismissal(rec.id, tx.id):
            db.session.add(RecurringDismissalModel(recurring_id=rec.id, transaction_id=tx.id))
            db.session.commit()
        return rec

    def undo_dismissal(self, recurring_id, transaction_id):
        """Let a dismissed transaction be suggested for the series again (harmless if it wasn't dismissed)."""
        rec, tx = _series_and_transaction(recurring_id, transaction_id)
        dismissal = db_service.get_dismissal(rec.id, tx.id)
        if dismissal:
            db.session.delete(dismissal)
            db.session.commit()
        return rec

    def template_dict(self, rec):
        """
        A template as the API returns it: to_dict() plus suggestion_count (transactions suggested
        for it), needs_attention (true while any suggestion is left), and
        dismissed_transaction_ids (transactions marked unrelated to it).
        """
        count = sum(len(s['candidates']) for s in self.suggest_matches(rec.id))
        return {
            **rec.to_dict(),
            'suggestion_count':          count,
            'needs_attention':           count > 0,
            'dismissed_transaction_ids': sorted(db_service.get_dismissed_transaction_ids(rec.id)),
        }

    # GENERATION ================================================================

    def process_due_recurring(self, account_id):
        """
        Fill every due occurrence of the account's templates. An occurrence that already has an
        exact match (see match_candidates; e.g. the same charge imported from the bank) links the
        nearest one; otherwise a transaction is generated. Returns the number generated.
        """
        recurring_list = db_service.get_account_recurring(account_id)
        transactions_created = 0
        today = date.today()

        for rec in recurring_list:
            while rec.next_date <= today and (rec.number == -1 or rec.idx <= rec.number):
                matches = self.match_candidates(rec, rec.next_date)
                if matches:
                    matches[0].recurring_id = rec.id
                    matches[0].recurring_index = rec.idx
                else:
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
                    transactions_created += 1

                rec.next_date = rec.advance_to_next
                rec.idx += 1

                if rec.number != -1 and rec.idx > rec.number:
                    break

        db.session.commit()   # persist the next dates and adopted links
        return transactions_created
