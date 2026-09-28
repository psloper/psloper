#!/usr/bin/env python3
"""Render the simulator's spoken radio traffic into js/sources/speech-clips.js.

Each phrase is spoken by a text-to-speech engine, resampled to 8 kHz, trimmed,
compressed like a radio transmitter's audio stage, and stored as base64 signed
8-bit PCM. The simulator then transmits these clips over its AM / FM / SSB
carriers, so the receiver has real speech to demodulate.

Engines, best first (the first one found is used):
  piper      neural voices, very natural   --piper-model a.onnx[,b.onnx,c.onnx]
             (several models give several speakers: index 0 controller, 1 and 2 other stations)
  espeak-ng  formant synthesis, robotic but clear
  espeak
  flite

Usage:
  python3 sdr/tools/make_speech.py [--engine auto|piper|espeak-ng|espeak|flite] [--piper-model M]
"""
import argparse
import base64
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave

RATE = 8000
OUT = os.path.join(os.path.dirname(__file__), "..", "js", "sources", "speech-clips.js")

# Fictional callsigns and places throughout. Clips play in order, so calls and
# replies alternate as a real exchange would. Voice index picks a speaker.
PHRASES = {
    "tower": [
        (0, "Sim Air two zero four, runway two seven right, cleared for take off. Surface wind two five zero degrees, one two knots."),
        (1, "Cleared for take off, runway two seven right, Sim Air two zero four."),
        (0, "Golf Bravo Charlie Delta, hold short runway two seven right."),
        (2, "Holding short two seven right, Golf Bravo Charlie Delta."),
        (0, "Training zero one, runway two seven right, cleared to land. Wind two four zero degrees, one zero knots."),
        (1, "Cleared to land two seven right, Training zero one."),
    ],
    "approach": [
        (0, "Sim Air two zero four, Sim Approach, identified. Climb flight level eight zero, turn left heading two one zero."),
        (1, "Climb flight level eight zero, left heading two one zero, Sim Air two zero four."),
        (0, "Vector five, descend altitude four thousand feet, Q N H one zero one three."),
        (2, "Descend altitude four thousand feet, one zero one three, Vector five."),
        (0, "Nova three one, reduce speed two two zero knots, contact Sim Tower one one eight decimal five."),
        (1, "Two two zero knots, tower one one eight decimal five, Nova three one."),
    ],
    "atis": [
        (0, "This is Sim Field information Bravo, time one four five zero. Runway in use two seven right."),
        (0, "Surface wind two five zero degrees, one two knots. Visibility one zero kilometres or more. Few clouds two thousand five hundred feet."),
        (0, "Temperature one four, dew point eight. Q N H one zero one three. Acknowledge information Bravo on first contact."),
    ],
    "calling": [
        (1, "C Q, C Q, this is Sierra India Mike One Foxtrot Mike, calling on the two metre calling frequency."),
        (2, "Sierra India Mike One Foxtrot Mike, this is Sierra India Mike Two Alpha. Shall we move to one four five decimal two two five?"),
        (1, "Good idea, moving to two two five now. See you there."),
    ],
    "ch16": [
        (1, "Sim Coastguard, Sim Coastguard, this is motor vessel Sea Breeze, Sea Breeze, over."),
        (0, "Sea Breeze, this is Sim Coastguard. Go to channel six seven, over."),
        (1, "Channel six seven, Sea Breeze."),
    ],
    "ch06": [
        (2, "Harbour Launch, this is yacht Blue Heron, we are approaching the north buoy, over."),
        (1, "Blue Heron, Harbour Launch, understood. Keep to the east side of the channel, out."),
    ],
    "pmr": [
        (1, "Base to van two, where are you now?"),
        (2, "Van two. Just leaving the depot, about ten minutes away."),
        (1, "Received. The gate code is the same as yesterday."),
    ],
    "ssb": [
        (2, "C Q twenty, C Q twenty, this is Sierra India Mike One Sierra Sierra, calling C Q and listening."),
        (1, "Sierra India Mike One Sierra Sierra, you are five nine here, name is Alex, over."),
    ],
    "talk": [
        (1, "You are listening to Sim Talk. Coming up after the news, the weather for the south east, and your calls on the phone in."),
        (0, "Now the travel. The main road into town is running slowly this morning, and there are delays on the coast line."),
        (2, "And the weather: a bright start with sunny spells, then cloud building from the west later. Highs of seventeen degrees."),
    ],
}

ESPEAK_VOICES = [("en-gb+m3", 45, 160), ("en-gb+m1", 60, 170), ("en-gb+f2", 55, 165)]


def find_engine(choice, piper_model):
    order = ["piper", "espeak-ng", "espeak", "flite"] if choice == "auto" else [choice]
    for eng in order:
        if eng == "piper" and not piper_model:
            continue
        if shutil.which(eng):
            return eng
    return None


def speak(engine, text, voice, path, piper_model):
    if engine == "piper":
        # --piper-model may list several voices (comma separated); the speaker index picks one.
        models = piper_model.split(",")
        subprocess.run([engine, "--model", models[voice % len(models)], "--output_file", path],
                       input=text.encode(), check=True, capture_output=True)
    elif engine in ("espeak-ng", "espeak"):
        name, pitch, speed = ESPEAK_VOICES[voice % len(ESPEAK_VOICES)]
        subprocess.run([engine, "-v", name, "-p", str(pitch), "-s", str(speed), "-w", path, text],
                       check=True, capture_output=True)
    else:
        subprocess.run([engine, "-t", text, "-o", path], check=True, capture_output=True)


def read_wav(path):
    with wave.open(path, "rb") as w:
        n, rate, width, ch = w.getnframes(), w.getframerate(), w.getsampwidth(), w.getnchannels()
        raw = w.readframes(n)
    if width != 2:
        raise SystemExit(f"{path}: expected 16-bit audio, got {8 * width}-bit")
    s = struct.unpack(f"<{len(raw) // 2}h", raw)
    return [v / 32768 for v in s[::ch]], rate


def resample(x, src, dst):
    """Windowed-sinc low-pass then linear resample (adequate for 3 kHz speech)."""
    if src == dst:
        return x
    cut = 0.45 * dst / src
    taps = 31
    h = [(2 * cut if k == 0 else math.sin(2 * math.pi * cut * k) / (math.pi * k))
         * (0.54 + 0.46 * math.cos(math.pi * k / (taps // 2 + 1))) for k in range(-(taps // 2), taps // 2 + 1)]
    y = [sum(h[j] * x[i + j - taps // 2] for j in range(taps) if 0 <= i + j - taps // 2 < len(x)) for i in range(len(x))]
    out, step, t = [], src / dst, 0.0
    while t < len(y) - 1:
        i = int(t)
        out.append(y[i] + (y[i + 1] - y[i]) * (t - i))
        t += step
    return out


def radio_process(x):
    """Trim silence, remove DC, band-limit to ~300-3000 Hz, compress and normalise like a transmitter."""
    thr = 0.02 * max(abs(v) for v in x)
    first = next(i for i, v in enumerate(x) if abs(v) > thr)
    last = len(x) - next(i for i, v in enumerate(reversed(x)) if abs(v) > thr)
    x = x[max(0, first - 200):last + 400]
    # one-pole high-pass (~300 Hz) and low-pass (~3 kHz)
    a_hp = math.exp(-2 * math.pi * 300 / RATE)
    a_lp = 1 - math.exp(-2 * math.pi * 3000 / RATE)
    out, px, py, lp = [], 0.0, 0.0, 0.0
    for v in x:
        py = a_hp * (py + v - px)
        px = v
        lp += a_lp * (py - lp)
        out.append(lp)
    peak = max(abs(v) for v in out) or 1
    return [math.tanh(2.2 * v / peak) / math.tanh(2.2) * 0.95 for v in out]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", default="auto", choices=["auto", "piper", "espeak-ng", "espeak", "flite"])
    ap.add_argument("--piper-model", default=os.environ.get("PIPER_MODEL"))
    args = ap.parse_args()
    engine = find_engine(args.engine, args.piper_model)
    if not engine:
        sys.exit("No speech engine found. Install one of: piper (plus a voice model), espeak-ng, espeak, flite.")
    print(f"engine: {engine}")

    clips, total = {}, 0
    with tempfile.TemporaryDirectory() as tmp:
        for key, lines in PHRASES.items():
            clips[key] = []
            for i, (voice, text) in enumerate(lines):
                path = os.path.join(tmp, f"{key}{i}.wav")
                speak(engine, text, voice, path, args.piper_model)
                x, rate = read_wav(path)
                y = radio_process(resample(x, rate, RATE))
                pcm = bytes((round(v * 127) & 0xFF) for v in y)
                clips[key].append(base64.b64encode(pcm).decode())
                total += len(pcm)
                print(f"  {key}[{i}] {len(pcm) / RATE:4.1f} s  {text[:60]}")

    with open(OUT, "w") as f:
        f.write(f"// Generated by tools/make_speech.py using {engine}. Do not edit by hand.\n")
        f.write("// Signed 8-bit PCM at CLIP_RATE Hz, base64 encoded. All callsigns are fictional.\n")
        f.write(f"export const CLIP_RATE = {RATE};\nexport const CLIPS = {{\n")
        for key, arr in clips.items():
            f.write(f"  {key}: [\n" + "".join(f"    '{b}',\n" for b in arr) + "  ],\n")
        f.write("};\n")
    print(f"wrote {os.path.normpath(OUT)}: {total / RATE:.0f} s of audio, {os.path.getsize(OUT) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
