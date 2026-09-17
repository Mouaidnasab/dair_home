"""Tiered grid tariff over billing cycles, and currency conversion.

The tariff is progressive within a cycle (default: 2 calendar months, first 300 kWh @ 600 SYP,
the rest @ 1400 SYP — configurable via TARIFF_TIERS / BILLING_CYCLE_MONTHS). A day's cost is its
marginal cost within its cycle, so any period's cost is the sum of its days and adds up to the
cycle bill.
"""
from __future__ import annotations

import logging
import math
from datetime import date

import httpx

log = logging.getLogger(__name__)

CURRENCIES = ("SYP", "NEW SYP", "USD", "SAR")


def tiered_cost(kwh: float, tiers: list[tuple[float, float]]) -> float:
    cost, prev = 0.0, 0.0
    for limit, price in tiers:
        if kwh <= prev:
            break
        cost += (min(kwh, limit) - prev) * price
        prev = limit
    return cost


def tier_fill(kwh: float, tiers: list[tuple[float, float]]) -> list[dict]:
    out, prev = [], 0.0
    for limit, price in tiers:
        out.append({"limit_kwh": None if math.isinf(limit) else limit, "price": price,
                    "filled_kwh": round(max(0.0, min(kwh, limit) - prev), 3)})
        prev = limit
    return out


def cycle_start(d: date, months: int) -> date:
    m = ((d.month - 1) // months) * months + 1
    return date(d.year, m, 1)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def cycle_label(start: date, months: int) -> str:
    end = add_months(start, months - 1)
    return f"{start:%b}-{end:%b} {start.year}" if months > 1 else f"{start:%b} {start.year}"


def daily_marginal_costs(daily_kwh: dict[str, float], tiers, months: int) -> dict[str, float]:
    """day -> cost of that day's grid energy given everything used earlier in the same cycle."""
    costs: dict[str, float] = {}
    running: dict[date, float] = {}
    for day in sorted(daily_kwh):
        cs = cycle_start(date.fromisoformat(day), months)
        before = running.get(cs, 0.0)
        after = before + daily_kwh[day]
        costs[day] = tiered_cost(after, tiers) - tiered_cost(before, tiers)
        running[cs] = after
    return costs


class Rates:
    """SYP (old pound) -> other currencies. USD/SAR rates are fetched hourly when a key is set."""

    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self.rates = {"SYP": 1.0, "NEW SYP": 0.01, "USD": 0.0, "SAR": 0.0}

    def convert(self, amount_syp: float, currency: str) -> float | None:
        if currency == "SYP":
            return amount_syp
        if currency == "NEW SYP":
            return amount_syp / 100.0
        rate = self.rates.get(currency, 0.0)
        # The exchange API quotes the new pound (1 new = 100 old).
        return (amount_syp / 100.0) * rate if rate > 0 else None

    async def refresh(self) -> None:
        if not self.api_key:
            return
        async with httpx.AsyncClient(timeout=10) as client:
            for target in ("USD", "SAR"):
                try:
                    r = await client.get(
                        "https://api.getgeoapi.com/v2/currency/convert",
                        params={"api_key": self.api_key, "from": "SYP", "to": target, "amount": 1, "format": "json"},
                    )
                    r.raise_for_status()
                    rate = ((r.json().get("rates") or {}).get(target) or {}).get("rate")
                    if rate:
                        self.rates[target] = float(rate)
                except Exception as exc:  # noqa: BLE001
                    log.warning("exchange rate %s failed: %s", target, exc)
