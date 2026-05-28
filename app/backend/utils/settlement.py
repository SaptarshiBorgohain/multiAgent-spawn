"""
Debt minimisation algorithm for group expense settlement.

Given a dict of {user_id: net_float} where:
  positive = this user is owed money
  negative = this user owes money

Returns the minimum number of transactions to settle all debts.
"""


def minimize_cash_flow(net: dict[str, float]) -> list[dict]:
    """
    Greedy O(n²) algorithm: always pair the biggest creditor with the biggest debtor.
    Reduces k original transactions to at most (n-1) settlement transactions.

    Example:
      net = {"A": -300, "B": +200, "C": +100}
      → [{"from": "A", "to": "B", "amount": 200},
         {"from": "A", "to": "C", "amount": 100}]
    """
    # Filter out zero balances, round to 2dp
    b: dict[str, float] = {k: round(float(v), 2) for k, v in net.items() if abs(float(v)) > 0.01}

    transactions: list[dict] = []

    while b:
        creditor = max(b, key=lambda k: b[k])   # is owed the most
        debtor = min(b, key=lambda k: b[k])      # owes the most

        # No more valid pairs
        if b[creditor] <= 0.01 or b[debtor] >= -0.01:
            break

        amount = round(min(b[creditor], -b[debtor]), 2)
        transactions.append({"from": debtor, "to": creditor, "amount": amount})

        b[creditor] = round(b[creditor] - amount, 2)
        b[debtor] = round(b[debtor] + amount, 2)

        # Prune zeroed-out balances
        b = {k: v for k, v in b.items() if abs(v) > 0.01}

    return transactions
