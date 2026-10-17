"""Drive the live page in headless Chrome on a video file and report what the page shows.

  python tests/browser_test.py testvideos/clip.mp4 arm_abduction [EXPECTED_LABEL]   (clip path relative to web/)
  SHOT=screenshots/session.png python tests/browser_test.py ...                      (also save a screenshot)

Needs the app served at http://127.0.0.1:8801 (npm run serve) and Google Chrome installed (macOS path below).
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9333


def main():
    video, ex = sys.argv[1], sys.argv[2]
    expected = sys.argv[3] if len(sys.argv) > 3 else ""
    url = f"http://127.0.0.1:8801/?ex={ex}&video={video}&autostart=1" + (f"&expected={expected}" if expected else "")
    profile = tempfile.mkdtemp(prefix="chrome-formcheck-")
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
                               "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--no-first-run",
                               "--no-default-browser-check", "--enable-unsafe-swiftshader", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                break
            except OSError:
                time.sleep(0.2)
        ws = websocket.create_connection([p for p in pages if p["type"] == "page"][0]["webSocketDebuggerUrl"],
                                         suppress_origin=True)
        msg_id, events = [0], []

        def call(method, params=None):
            msg_id[0] += 1
            ws.send(json.dumps({"id": msg_id[0], "method": method, "params": params or {}}))
            while True:
                m = json.loads(ws.recv())
                if m.get("id") == msg_id[0]:
                    return m.get("result", {})
                events.append(m)

        for m in ("Runtime.enable", "Log.enable", "Page.enable"):
            call(m)
        call("Page.navigate", {"url": url})
        probe = """JSON.stringify({status: document.querySelector('#status').textContent,
            reps: document.querySelector('#countNum').textContent + document.querySelector('#countOf').textContent,
            chip: document.querySelector('#chip').classList.contains('show') ? document.querySelector('#chip').textContent : '',
            setup: document.querySelector('#setup').hidden ? '' : document.querySelector('#setupTitle').textContent,
            fps: document.querySelector('#fps').textContent,
            facing: document.querySelector('#facing').textContent, state: document.querySelector('#state').textContent, angle: document.querySelector('#angle').textContent,
            warnings: [...document.querySelectorAll('#warnings .warn')].map(e => e.textContent),
            latest: document.querySelector('#latest').innerText, tally: document.querySelector('#tally').textContent,
            history: [...document.querySelectorAll('#history li')].map(e => e.innerText).reverse()})"""
        shot = os.environ.get("SHOT")  # optional: save a screenshot once a feedback chip shows after rep 5
        call("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        t0, last = time.time(), None
        while time.time() - t0 < 240:
            time.sleep(0.5 if shot else 2)
            r = call("Runtime.evaluate", {"expression": probe, "returnByValue": True})
            state = json.loads(r["result"]["value"]) if "value" in r.get("result", {}) else None
            if shot and state and int(state["reps"].split("/")[0]) >= 4 and state["angle"].rstrip('°').isdigit() and int(state["angle"].rstrip('°')) >= 110:
                import base64
                img = call("Page.captureScreenshot", {"format": "png"})["data"]
                os.makedirs(os.path.dirname(os.path.abspath(shot)), exist_ok=True)
                open(shot, "wb").write(base64.b64decode(img))
                print("screenshot saved:", shot)
                shot = None
            if state and state != last:
                print(f"[{time.time() - t0:5.1f}s] status={state['status']!r} state={state['state']!r} setup={state['setup']!r} chip={state['chip']!r} reps={state['reps']}")
                last = state
            if state and ("Video finished" in state["status"] or state["status"].startswith("Error")):
                break
        print("\nlatest card:\n  " + last["latest"].replace("\n", "\n  "))
        print("warnings:", last["warnings"])
        print("history:\n  " + "\n  ".join(last["history"]))
        if last["tally"]:
            print(last["tally"])
        errs = [e for e in events if e.get("method") in ("Runtime.exceptionThrown",)
                or (e.get("method") == "Runtime.consoleAPICalled" and e["params"]["type"] in ("error", "warning"))
                or (e.get("method") == "Log.entryAdded" and e["params"]["entry"]["level"] in ("error",))]
        print(f"\nconsole errors/warnings: {len(errs)}")
        for e in errs[:8]:
            p = e["params"]
            ed = p.get("exceptionDetails", {})
            if ed:
                print("  EXCEPTION:", ed.get("text"), ed.get("url"), ed.get("lineNumber"), ed.get("columnNumber"), ed.get("exception", {}).get("description"))
            txt = ed.get("exception", {}).get("description") or \
                " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", [])) or p.get("entry", {}).get("text")
            print("  -", (txt or "")[:220])
    finally:
        chrome.terminate()
        chrome.wait(timeout=10)
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
