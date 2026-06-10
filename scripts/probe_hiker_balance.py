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

c = Client(token=_load_key())
for path in ("/sys/balance", "/sys/me", "/sys/account", "/sys/usage", "/balance"):
    try:
        r = c._request("get", path)
        print(path, "->", r)
    except Exception as e:  # noqa: BLE001
        print(path, "ERR", type(e).__name__, e)
