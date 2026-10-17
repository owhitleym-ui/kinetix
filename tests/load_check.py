"""Load the app in headless Chrome for a few seconds and print every console error / exception with its location.

  python tests/load_check.py [url]          (SHOT=screenshots/idle.png to also save a screenshot)
"""
import json, shutil, subprocess, sys, tempfile, time, urllib.request
import websocket
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8801/"
prof = tempfile.mkdtemp(prefix="chrome-loadcheck-")
p = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=9334", f"--user-data-dir={prof}", "--no-first-run", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try: pages = json.load(urllib.request.urlopen("http://127.0.0.1:9334/json")); break
        except OSError: time.sleep(0.2)
    ws = websocket.create_connection([q for q in pages if q["type"] == "page"][0]["webSocketDebuggerUrl"], suppress_origin=True)
    n = [0]
    def send(m, prm=None): n[0] += 1; ws.send(json.dumps({"id": n[0], "method": m, "params": prm or {}}))
    for m in ("Runtime.enable", "Log.enable", "Network.enable"): send(m)
    send("Page.navigate", {"url": url})
    ws.settimeout(1); end = time.time() + 8
    while time.time() < end:
        try: m = json.loads(ws.recv())
        except Exception: continue
        meth, prm = m.get("method"), m.get("params", {})
        if meth == "Runtime.exceptionThrown":
            ed = prm["exceptionDetails"]; print("EXCEPTION:", ed.get("text"), ed.get("url"), ed.get("lineNumber"), ed.get("columnNumber"), (ed.get("exception") or {}).get("description"))
        elif meth == "Runtime.consoleAPICalled":
            print("console." + prm["type"] + ":", " ".join(str(a.get("value", a.get("description", ""))) for a in prm["args"]))
        elif meth == "Log.entryAdded":
            e = prm["entry"]; print("log." + e["level"] + ":", e.get("text"), e.get("url", ""))
        elif meth == "Network.responseReceived" and prm["response"]["status"] >= 400:
            print("HTTP", prm["response"]["status"], prm["response"]["url"])
    import os, base64
    if os.environ.get("SHOT"):
        send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False}); time.sleep(1.5)
        send("Page.captureScreenshot", {"format": "png"}); want = n[0]
        while True:
            m = json.loads(ws.recv())
            if m.get("id") == want: open(os.environ["SHOT"], "wb").write(base64.b64decode(m["result"]["data"])); print("shot", os.environ["SHOT"]); break
finally:
    p.terminate(); p.wait(timeout=10); shutil.rmtree(prof, ignore_errors=True)
