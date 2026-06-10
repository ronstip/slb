"""One-off: derive the real $/request by diffing /sys/balance around 2 calls."""
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

c = Client(token=_load_key())
b0 = c._request("get", "/sys/balance")
print("before:", b0)
c.fbsearch_reels_v2("Nike")
c.fbsearch_reels_v2("Adidas")
b1 = c._request("get", "/sys/balance")
print("after :", b1)
dreq = (b1.get("requests", 0) or 0) - (b0.get("requests", 0) or 0)
damt = (b0.get("amount", 0) or 0) - (b1.get("amount", 0) or 0)
print(f"delta requests={dreq} delta amount=${damt:.6f}")
if dreq:
    print(f"=> effective rate ${damt / dreq:.6f}/request")
