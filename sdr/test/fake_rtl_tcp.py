#!/usr/bin/env python3
"""Minimal stand-in for rtl_tcp used by the bridge test.

Sends the 12-byte "RTL0" header, then unsigned 8-bit IQ carrying a tone at
+100 kHz (2 MS/s). Every 5-byte command it receives is printed as "CMD op value".
"""
import asyncio
import math
import struct
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1234
FS, TONE, CHUNK = 2_000_000, 100_000, 16384
TABLE = bytes(
    b
    for n in range(FS // math.gcd(FS, TONE))
    for b in (
        int(127.5 + 60 * math.cos(2 * math.pi * TONE * n / FS)),
        int(127.5 + 60 * math.sin(2 * math.pi * TONE * n / FS)),
    )
)


async def handle(reader, writer):
    writer.write(b"RTL0" + struct.pack("!II", 5, 29))

    async def commands():
        while True:
            cmd = await reader.readexactly(5)
            op, value = struct.unpack("!BI", cmd)
            print(f"CMD {op} {value}", flush=True)

    task = asyncio.create_task(commands())
    try:
        while not task.done():
            reps = CHUNK * 2 // len(TABLE) + 1
            writer.write((TABLE * reps)[: CHUNK * 2])
            await writer.drain()
            await asyncio.sleep(CHUNK / FS)
    except (ConnectionError, asyncio.IncompleteReadError):
        pass
    finally:
        task.cancel()
        writer.close()


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    print("READY", flush=True)
    async with server:
        await server.serve_forever()


asyncio.run(main())
