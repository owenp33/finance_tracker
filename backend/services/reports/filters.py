"""
filters.py - What an export covers, parsed once from the request's query string
"""
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class ExportFilters:
    account_ids: list | None = None   # None: every account of the user
    start_date: date | None = None    # inclusive
    end_date: date | None = None      # inclusive
    categories: set | None = None     # only the PDF honors this today


def _date(args, name):
    raw = args.get(name)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValueError(f'{name} must be a date like 2026-01-31.')


def parse_export_filters(args):
    """ExportFilters from query parameters; raises ValueError with a message for the user."""
    account_ids = None
    if args.get('account_ids'):
        try:
            account_ids = [int(part) for part in args['account_ids'].split(',') if part.strip()]
        except ValueError:
            raise ValueError('account_ids must be a comma-separated list of account ids.')

    start_date, end_date = _date(args, 'start_date'), _date(args, 'end_date')
    if start_date and end_date and start_date > end_date:
        raise ValueError('The start date must be on or before the end date.')

    categories = None
    if args.get('categories'):
        categories = {c for c in args['categories'].split(',') if c.strip()} or None

    return ExportFilters(account_ids, start_date, end_date, categories)
