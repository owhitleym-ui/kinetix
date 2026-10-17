"""Start a session on a clip in headless Chrome, press the full-screen button, screenshot, then exit and check.

  python tests/fs_check.py testvideos/<clip>.mp4 screenshots/fullscreen.png   (clip path relative to web/)
"""
import base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
url = f"http://127.0.0.1:8801/?ex=arm_abduction&video={sys.argv[1]}&autostart=1"
out = sys.argv[2]
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
prof = tempfile.mkdtemp(prefix="chrome-fscheck-")
p = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=9335", f"--user-data-dir={prof}", "--no-first-run",
                      "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--window-size=1280,800", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try: pages = json.load(urllib.request.urlopen("http://127.0.0.1:9335/json")); break
        except OSError: time.sleep(0.2)
    ws = websocket.create_connection([q for q in pages if q["type"] == "page"][0]["webSocketDebuggerUrl"], suppress_origin=True)
    n = [0]; errors = []
    def call(m, prm=None):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": m, "params": prm or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("method") == "Runtime.exceptionThrown": errors.append(r["params"]["exceptionDetails"].get("text"))
            if r.get("id") == n[0]: return r.get("result", {})
    ev = lambda js, gesture=False: call("Runtime.evaluate", {"expression": js, "returnByValue": True, "userGesture": gesture}).get("result", {}).get("value")
    call("Runtime.enable"); call("Page.enable"); call("Page.navigate", {"url": url})
    # wait until a few reps have been judged
    for _ in range(120):
        time.sleep(0.5)
        if (ev("Number(document.querySelector('#countNum').textContent)") or 0) >= 4 and ev("(()=>{const a=document.querySelector('#angle').textContent; return parseInt(a)||0})()") >= 100: break
    ev("document.querySelector('#fsBtn').click()", gesture=True); time.sleep(1.2)
    print("fullscreen element:", ev("(document.fullscreenElement||{}).id || null"), "| button label:", ev("document.querySelector('#fsBtn').getAttribute('aria-label')"))
    shot = call("Page.captureScreenshot", {"format": "png"})["data"]; open(out, "wb").write(base64.b64decode(shot)); print("screenshot:", out)
    ev("document.querySelector('#fsBtn').click()", gesture=True); time.sleep(0.8)
    print("after exit:", ev("(document.fullscreenElement||{}).id || null"), "| stage inline size:", ev("document.querySelector('#stage').style.width + ' x ' + document.querySelector('#stage').style.height"))
    print("exceptions:", errors or "none")
finally:
    p.terminate(); p.wait(timeout=10); shutil.rmtree(prof, ignore_errors=True)
