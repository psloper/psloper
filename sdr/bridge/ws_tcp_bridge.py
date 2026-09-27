#!/usr/bin/env python3
"""WebSocket <-> TCP bridge for the Aether SDR console.

Browsers cannot open raw TCP sockets, so this relays bytes between the web page
(WebSocket, binary frames) and an rtl_tcp-compatible IQ server (plain TCP).
Standard library only: no pip install needed.

    rtl_tcp -a 127.0.0.1 -p 1234 -s 2000000
    python3 sdr/bridge/ws_tcp_bridge.py --listen 8765 --target 127.0.0.1:1234

Then choose "rtl_tcp (network)" in the console with ws://127.0.0.1:8765.
"""
import argparse
import asyncio
import base64
import hashlib
import struct

GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def ws_frame(opcode, payload=b""):
    head = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack("!H", n)
    else:
        head += bytes([127]) + struct.pack("!Q", n)
    return head + payload


async def read_ws_frame(reader):
    b1, b2 = await reader.readexactly(2)
    opcode = b1 & 0x0F
    n = b2 & 0x7F
    if n == 126:
        (n,) = struct.unpack("!H", await reader.readexactly(2))
    elif n == 127:
        (n,) = struct.unpack("!Q", await reader.readexactly(8))
    mask = await reader.readexactly(4) if b2 & 0x80 else None
    data = await reader.readexactly(n)
    if mask:
        data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
    return opcode, data


async def handle(reader, writer, target, allow_any_origin):
    peer = writer.get_extra_info("peername")
    try:
        request = await reader.readuntil(b"\r\n\r\n")
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        writer.close()
        return
    lines = request.decode("latin-1").split("\r\n")
    headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:] if ":" in l)}
    key = headers.get("sec-websocket-key")
    origin = headers.get("origin", "")
    if not key:
        writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
        await writer.drain()
        writer.close()
        return
    local = any(h in origin for h in ("//localhost", "//127.0.0.1", "//[::1]")) or origin in ("", "null")
    if not (local or allow_any_origin):
        print(f"[bridge] refused origin {origin!r} (use --allow-any-origin to permit)")
        writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
        await writer.drain()
        writer.close()
        return

    accept = base64.b64encode(hashlib.sha1(key.encode() + GUID).digest()).decode()
    writer.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode()
    )
    await writer.drain()

    host, port = target
    try:
        t_reader, t_writer = await asyncio.open_connection(host, port)
    except OSError as exc:
        reason = f"rtl_tcp not reachable at {host}:{port} ({exc.strerror or exc})".encode()[:120]
        writer.write(ws_frame(0x8, struct.pack("!H", 1011) + reason))
        await writer.drain()
        writer.close()
        print(f"[bridge] {peer}: {reason.decode()}")
        return
    print(f"[bridge] {peer} <-> {host}:{port} connected")

    async def tcp_to_ws():
        while True:
            data = await t_reader.read(65536)
            if not data:
                break
            writer.write(ws_frame(0x2, data))
            await writer.drain()

    async def ws_to_tcp():
        while True:
            opcode, data = await read_ws_frame(reader)
            if opcode == 0x8:
                break
            if opcode == 0x9:
                writer.write(ws_frame(0xA, data))
                await writer.drain()
            elif opcode in (0x1, 0x2):
                t_writer.write(data)
                await t_writer.drain()

    tasks = [asyncio.create_task(tcp_to_ws()), asyncio.create_task(ws_to_tcp())]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    for task in done:
        if task.exception() and not isinstance(task.exception(), (asyncio.IncompleteReadError, ConnectionError)):
            print(f"[bridge] {peer}: {task.exception()!r}")
    for w in (t_writer, writer):
        try:
            w.close()
        except Exception:
            pass
    print(f"[bridge] {peer} disconnected")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--listen", type=int, default=8765, help="WebSocket port (default 8765)")
    ap.add_argument("--host", default="127.0.0.1", help="interface to listen on (default 127.0.0.1 only)")
    ap.add_argument("--target", default="127.0.0.1:1234", help="rtl_tcp host:port (default 127.0.0.1:1234)")
    ap.add_argument("--allow-any-origin", action="store_true", help="accept pages not served from localhost")
    args = ap.parse_args()
    host, _, port = args.target.rpartition(":")
    target = (host or "127.0.0.1", int(port))

    async def run():
        server = await asyncio.start_server(
            lambda r, w: handle(r, w, target, args.allow_any_origin), args.host, args.listen
        )
        print(f"[bridge] ws://{args.host}:{args.listen}  ->  tcp://{target[0]}:{target[1]}")
        async with server:
            await server.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
