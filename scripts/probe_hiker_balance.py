"""One-off: probe HikerAPI account endpoints (balance / spend). Never prints the key."""
import os


def _load_key() -> str:
    key = os.environ.get("HIKERAPI_API_KEY", "")
    if key:
        return key
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("HIKERAPI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("HIKERAPI_API_KEY not found")


from hikerapi import Client  # noqa: E402

# ONLY /sys/balance - HikerAPI charges for ANY successful response incl. 404s,
# so probing non-existent paths costs real money ($0.02/hit at the testing tier).
c = Client(token=_load_key())
r = c._request("get", "/sys/balance")
print("/sys/balance ->", r)
try:
    reqs = float(r.get("requests") or 0)
    amount = float(r.get("amount") or 0)
    if reqs:
        print(f"effective rate = amount/requests = ${amount / reqs:.5f}/request")
except (TypeError, ValueError, AttributeError):
    pass
