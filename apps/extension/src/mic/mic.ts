/**
 * Asks for the microphone where Chrome will actually ask.
 *
 * A side panel never shows the permission prompt — speech recognition there fails
 * straight away with "not-allowed". The grant is per extension, though, so asking once
 * from this ordinary extension page makes the microphone work in the panel too.
 */
const root = document.getElementById("root") as HTMLElement;
const button = document.getElementById("allow") as HTMLButtonElement;

function show(title: string, body: string, ok = false): void {
  root.classList.toggle("ok", ok);
  root.innerHTML = `<div class="dot"></div><h1></h1><p></p>`;
  (root.querySelector("h1") as HTMLElement).textContent = title;
  (root.querySelector("p") as HTMLElement).textContent = body;
}

async function allow(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    show("You're all set", "Voice works in Jev now. This tab will close.", true);
    setTimeout(() => window.close(), 1400);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotFoundError") {
      show("No microphone found", "Connect a microphone, then try again from Jev.");
      return;
    }
    // Once denied, Chrome stops asking; the setting has to be flipped by hand.
    show(
      "Microphone is blocked",
      `Chrome is set to block it for Jev. Click the icon at the left of the address bar, set Microphone to Allow, then reload this page. (Settings → Privacy and security → Site settings → Microphone also lists it.)`,
    );
  }
}

button.addEventListener("click", () => void allow());
