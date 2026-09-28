"""Pull a handful of columns out of the column-oriented SCADA JSON.

The files are ~350 MB uncompressed each and the structure is
{"analog_data": {"<var>": [ ...315k values... ], ...}}, so loading them whole
is wasteful. This streams the decompressed text and captures only the arrays
whose key we asked for.
"""
import bz2, json, re, sys, os

WANTED = [
    'date_time',
    'wnac_avg_Dir',        # nacelle position, absolute yaw
    'wnac_avg_WVaneDir1',  # wind vane direction RELATIVE to nacelle = yaw error
    'wnac_avg_Wdir1',      # wind direction, absolute
    'wnac_avg_WSpd1',      # nacelle wind speed
    'wgen_avg_RtrSpd_IGR', # rotor speed, rpm
    'wgen_avg_Spd',        # generator speed
    'wgdc_avg_TriGri_PwrAt',  # active power
    'wtur_avg_PwrRedNoi',  # noise-related power reduction
    'availability',
]

def extract(path, wanted):
    out = {}
    want = set(wanted)
    buf = ''
    capturing = None
    depth = 0
    acc = []
    with bz2.open(path, 'rt', encoding='utf-8', errors='replace') as fh:
        while True:
            chunk = fh.read(1 << 22)
            if not chunk:
                break
            buf += chunk
            while True:
                if capturing is None:
                    m = None
                    for w in want:
                        i = buf.find('"%s":' % w)
                        if i >= 0 and (m is None or i < m[0]):
                            m = (i, w)
                    if m is None:
                        buf = buf[-80:]
                        break
                    i, key = m
                    j = buf.find('[', i)
                    if j < 0:
                        break
                    capturing = key
                    depth = 1
                    acc = []
                    buf = buf[j + 1:]
                # consume until the matching close bracket
                k = 0
                n = len(buf)
                while k < n:
                    c = buf[k]
                    if c == '[':
                        depth += 1
                    elif c == ']':
                        depth -= 1
                        if depth == 0:
                            acc.append(buf[:k])
                            out[capturing] = json.loads('[' + ''.join(acc) + ']')
                            want.discard(capturing)
                            buf = buf[k + 1:]
                            capturing = None
                            break
                    k += 1
                else:
                    acc.append(buf)
                    buf = ''
                    break
                if capturing is not None:
                    break
                if not want:
                    return out
    return out

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    got = extract(src, WANTED)
    print(os.path.basename(src), '->', {k: len(v) for k, v in got.items()})
    with open(dst, 'w') as fh:
        json.dump(got, fh)
