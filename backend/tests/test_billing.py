from datetime import date

from app import billing
from app.config import parse_tiers

TIERS = parse_tiers("300:600,inf:1400")


def test_tiered_cost():
    assert billing.tiered_cost(100, TIERS) == 60_000
    assert billing.tiered_cost(350, TIERS) == 300 * 600 + 50 * 1400


def test_marginal_costs_add_up_to_cycle_bill():
    daily = {"2026-09-01": 200.0, "2026-09-02": 150.0, "2026-11-01": 10.0}
    costs = billing.daily_marginal_costs(daily, TIERS, 2)
    assert costs["2026-09-01"] == 120_000
    assert costs["2026-09-02"] == 100 * 600 + 50 * 1400
    assert costs["2026-11-01"] == 6_000  # new cycle starts at the low tier
    assert costs["2026-09-01"] + costs["2026-09-02"] == billing.tiered_cost(350, TIERS)


def test_cycles_and_currency():
    assert billing.cycle_start(date(2026, 10, 17), 2) == date(2026, 9, 1)
    assert billing.cycle_label(date(2026, 11, 1), 2) == "Nov-Dec 2026"
    r = billing.Rates()
    assert r.convert(1000, "NEW SYP") == 10
    assert r.convert(1000, "USD") is None  # no rate fetched
    r.rates["USD"] = 0.5
    assert r.convert(1000, "USD") == 5
