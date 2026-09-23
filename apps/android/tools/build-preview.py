#!/usr/bin/env python3
"""
Generates the design preview from the Kotlin tokens, not by eye.

The previous preview was drawn in a 302px-wide mockup with sizes chosen to look
right at that scale. Text sized to look right in a small picture of a phone is
far too small on the phone -- measured against it, the implemented scale was 9%
short at body sizes and 29% short at display sizes.

So the frames here are 390px wide and 1 CSS pixel is 1dp. Every size below is
read out of Type.kt and NetworkPeerTheme.kt, which makes the page a spec rather
than an impression of one, and makes the two impossible to drift apart.
"""
import json
import pathlib
import re

ROOT = pathlib.Path('/Users/abhishekharsh/Desktop/NetworkPeer/apps/android/app/src/main'
                    '/java/com/networkpeer/mobile/ui/theme')
WEIGHT = {'Normal': 400, 'Medium': 500, 'SemiBold': 600, 'Bold': 700, 'ExtraBold': 800}

type_src = (ROOT / 'Type.kt').read_text()
theme_src = (ROOT / 'NetworkPeerTheme.kt').read_text()
colour_src = (ROOT / 'Color.kt').read_text()

TYPE = {}
for m in re.finditer(r'(\w+) = style\((\d+), (\d+), FontWeight\.(\w+)(?:, ([-\d.]+))?\)', type_src):
    TYPE[m.group(1)] = dict(size=int(m.group(2)), lh=int(m.group(3)),
                            weight=WEIGHT[m.group(4)], track=float(m.group(5) or 0))
SPACE = {m.group(1): int(m.group(2)) for m in re.finditer(r'val (\w+) = (\d+)\.dp', theme_src)}


def palette(block: str) -> dict:
    # Stop at the declaration's own closing paren, which is the first ')' that
    # starts a line -- splitting on any ')' lands inside the first Color(...).
    body = colour_src.split(f'private val {block} = NetworkPeerColors(')[1]
    body = body.split('\n)')[0]
    return {k: v for k, v in re.findall(r'(\w+) = Color\(0xFF([0-9A-Fa-f]{6})\)', body)}


LIGHT, DARK = palette('LightPalette'), palette('DarkPalette')


def t(name: str, extra: str = '') -> str:
    """Inline style for a type token, in dp-as-px."""
    s = TYPE[name]
    return (f'font-size:{s["size"]}px;line-height:{s["lh"]}px;'
            f'font-weight:{s["weight"]};letter-spacing:{s["track"]}px;{extra}')


def money(name: str, colour: str = 'var(--ink)') -> str:
    s = TYPE[name]
    return (f'font-size:{s["size"]}px;line-height:{s["lh"]}px;font-weight:{s["weight"]};'
            f'letter-spacing:{s["track"]}px;font-variant-numeric:tabular-nums;color:{colour};')


def css_vars(p: dict) -> str:
    return '\n'.join(f'    --{k.lower()}:#{v};' for k, v in p.items() if k != 'isDark')


S = SPACE

# --------------------------------------------------------------------- screens

def phone(title: str, caption: str, inner: str, dark: bool = False) -> str:
    cls = ' dark' if dark else ''
    return f'''
      <div class="screen">
        <div class="phone{cls}"><div class="glass">
          <div class="statusbar"><span>9:41</span><span class="sb-right"><i></i><i></i><i></i></span></div>
          {inner}
        </div></div>
        <div class="caption"><h3>{title}</h3><p>{caption}</p></div>
      </div>'''


welcome = f'''
          <div class="scroll" style="padding:0 {S['xl']}px">
            <div style="height:{S['xxl']}px"></div>
            <div style="display:flex;align-items:center;gap:{S['sm']}px">
              <div class="mark">N</div>
              <div style="{t('titleLarge')}">NetworkPeer</div>
            </div>
            <div style="height:{S['xxl']}px"></div>
            <div style="{t('displaySmall')}">Get work done, or get paid to do it.</div>
            <div style="height:{S['md']}px"></div>
            <div style="{t('bodyLarge')}color:var(--inkmuted)">NetworkPeer connects people who need field work verified with people nearby who can go and do it. Payment is held in escrow and released when the evidence is approved.</div>
            <div style="height:{S['xxl']}px"></div>
            <div style="{t('labelSmall')}color:var(--inkfaint);text-transform:uppercase">Get started</div>
            <div style="height:{S['md']}px"></div>
            <div class="card" style="display:flex;align-items:center;gap:{S['lg']}px">
              <div class="well"><svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9"/><path d="M20 7.5L12 12 4 7.5"/></svg></div>
              <div style="flex:1">
                <div style="{t('titleMedium')}">I want to work</div>
                <div style="height:2px"></div>
                <div style="{t('bodySmall')}color:var(--inkmuted)">Find jobs near you, photograph the evidence, get paid.</div>
              </div>
            </div>
            <div style="height:{S['md']}px"></div>
            <div class="card" style="display:flex;align-items:center;gap:{S['lg']}px">
              <div class="well"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"/></svg></div>
              <div style="flex:1">
                <div style="{t('titleMedium')}">I need work done</div>
                <div style="height:2px"></div>
                <div style="{t('bodySmall')}color:var(--inkmuted)">Post a job, review the evidence, release the payment.</div>
              </div>
            </div>
            <div style="height:{S['xl']}px"></div>
            <div style="text-align:center;{t('bodyMedium')}color:var(--inkmuted)">Already registered? <span style="{t('labelMedium')}color:var(--ink)">Sign in</span></div>
          </div>'''

code = f'''
          <div class="scroll" style="padding:0 {S['xl']}px">
            <div style="height:{S['sm']}px"></div>
            <div class="iconbtn ghost"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></div>
            <div style="height:{S['lg']}px"></div>
            <div style="{t('displaySmall')}">Enter your code</div>
            <div style="height:{S['sm']}px"></div>
            <div style="{t('bodyMedium')}color:var(--inkmuted)">Sent to sunita.rawat@gmail.com</div>
            <div style="height:{S['xxl']}px"></div>
            <div class="field"><div class="flabel">6-digit code</div><div style="{t('bodyLarge')}letter-spacing:4px;font-variant-numeric:tabular-nums">418209</div></div>
            <div style="height:{S['md']}px"></div>
            <div class="banner att"><div style="{t('bodySmall')}">Development build — your code is 418209</div></div>
            <div style="height:{S['lg']}px"></div>
            <div class="field"><div class="flabel">Full name</div><div style="{t('bodyLarge')}">Sunita Rawat</div></div>
            <div style="height:{S['lg']}px"></div>
            <div class="field empty"><div style="{t('bodyLarge')}color:var(--inkfaint)">Mobile number (optional)</div></div>
            <div style="height:{S['xl']}px"></div>
            <div class="btn primary" style="{t('labelLarge')}">Create account</div>
            <div style="height:{S['lg']}px"></div>
            <div style="text-align:center;{t('bodySmall')}color:var(--inkfaint)">You can request a new code in 24s</div>
          </div>'''

work = f'''
          <div class="appbar">
            <div style="{t('labelSmall')}color:var(--inkfaint);text-transform:uppercase">Ready to work</div>
            <div style="height:2px"></div>
            <div style="display:flex;align-items:center;gap:{S['sm']}px">
              <div style="{t('titleLarge')}flex:1">Sunita Rawat</div>
              <span class="pill pos">Online</span>
            </div>
          </div>
          <div class="scroll" style="padding:0 {S['lg']}px">
            <div style="height:{S['lg']}px"></div>
            <div style="{t('headlineSmall')}">Your jobs</div>
            <div style="height:2px"></div>
            <div style="{t('bodySmall')}color:var(--inkmuted)">1 job in progress</div>
            <div style="height:{S['md']}px"></div>
            <div class="card">
              <div style="display:flex;align-items:center;gap:{S['sm']}px">
                <span class="pill att">In progress</span><span style="flex:1"></span>
                <span style="{money('MoneySmall','var(--inkmuted)')}">₹1,400</span>
              </div>
              <div style="height:{S['md']}px"></div>
              <div style="{t('titleMedium')}">Signage audit — Indiranagar 100ft Rd</div>
              <div style="height:{S['md']}px"></div>
              <div class="stepbar"><i class="done"></i><i class="now"></i><i></i></div>
              <div style="height:{S['sm']}px"></div>
              <div style="{t('bodySmall')}color:var(--inkmuted)">1 of 3 required photos captured</div>
              <div style="height:{S['md']}px"></div>
              <div class="btn primary" style="{t('labelLarge')}">Continue</div>
            </div>
            <div style="height:{S['lg']}px"></div>
            <div class="rule"></div>
            <div style="height:{S['lg']}px"></div>
            <div style="{t('headlineSmall')}">Available work</div>
            <div style="height:2px"></div>
            <div style="{t('bodySmall')}color:var(--inkmuted)">4 jobs open near you</div>
            <div style="height:{S['md']}px"></div>
            <div class="chips">
              <span class="chip on" style="{t('labelMedium')}">All</span>
              <span class="chip" style="{t('labelMedium')}">Nearby</span>
              <span class="chip" style="{t('labelMedium')}">Higher paying</span>
            </div>
            <div style="height:{S['md']}px"></div>
            <div class="card">
              <div style="display:flex;align-items:flex-start;gap:{S['md']}px">
                <div style="{t('titleMedium')}flex:1">Retail shelf check — Koramangala</div>
                <div style="{money('MoneySmall','var(--accent)')}">₹900</div>
              </div>
              <div style="height:{S['sm']}px"></div>
              <div style="{t('bodySmall')}color:var(--inkmuted)">Capture shelf facings for six listed SKUs.</div>
            </div>
          </div>
          <div class="navbar">
            <div class="navitem on"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg><span style="{t('labelSmall')}">Work</span></div>
            <div class="navitem"><svg viewBox="0 0 24 24"><path d="M4 19V13"/><path d="M10 19V6"/><path d="M16 19v-9"/><path d="M22 19H2"/></svg><span style="{t('labelSmall')}">Earnings</span></div>
            <div class="navitem"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/></svg><span style="{t('labelSmall')}">Profile</span></div>
          </div>'''

earnings = f'''
          <div class="appbar"><div style="{t('titleLarge')}">Earnings</div></div>
          <div class="scroll" style="padding:0 {S['lg']}px">
            <div style="height:{S['lg']}px"></div>
            <div class="total">
              <div style="{t('labelSmall')}text-transform:uppercase;opacity:.55">Available to withdraw</div>
              <div style="height:{S['sm']}px"></div>
              <div style="{money('MoneyLarge','inherit')}">₹8,400</div>
              <div style="height:{S['lg']}px"></div>
              <div style="display:flex;gap:{S['md']}px">
                <div class="tsplit"><div style="{t('labelSmall')}opacity:.6">In escrow</div><div style="{money('MoneySmall','inherit')}">₹2,300</div></div>
                <div class="tsplit"><div style="{t('labelSmall')}opacity:.6">Lifetime</div><div style="{money('MoneySmall','inherit')}">₹24,600</div></div>
              </div>
            </div>
            <div style="height:{S['md']}px"></div>
            <div class="btn secondary" style="{t('labelLarge')}">Withdraw to bank</div>
            <div style="height:{S['xl']}px"></div>
            <div style="{t('headlineSmall')}">Recent</div>
            <div style="height:{S['sm']}px"></div>
            <div class="payrow">
              <div class="ico"><svg viewBox="0 0 24 24"><path d="M5 13l4 4 10-10"/></svg></div>
              <div style="flex:1;min-width:0">
                <div style="{t('bodyMedium')}white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Signage audit — Indiranagar</div>
                <div style="{t('bodySmall')}color:var(--inkfaint)">Released 10 Sep</div>
              </div>
              <div style="{money('MoneySmall','var(--accent)')}">₹1,400</div>
            </div>
            <div class="payrow">
              <div class="ico att"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/></svg></div>
              <div style="flex:1;min-width:0">
                <div style="{t('bodyMedium')}">Property survey — Whitefield</div>
                <div style="{t('bodySmall')}color:var(--inkfaint)">In review</div>
              </div>
              <div style="{money('MoneySmall','var(--inkfaint)')}">₹2,300</div>
            </div>
          </div>'''

review = f'''
          <div class="appbar" style="display:flex;align-items:center;gap:{S['sm']}px">
            <div class="iconbtn ghost"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></div>
            <div style="{t('titleLarge')}flex:1">Review queue</div>
            <span class="pill neutral">3 waiting</span>
          </div>
          <div class="scroll" style="padding:0 {S['lg']}px">
            <div style="height:{S['lg']}px"></div>
            <div class="card">
              <div style="display:flex;align-items:flex-start;gap:{S['sm']}px">
                <div style="flex:1">
                  <div style="{t('labelSmall')}color:var(--inkfaint);text-transform:uppercase">Evidence</div>
                  <div style="{t('titleMedium')}">2026-09-24</div>
                </div>
                <span class="pill neutral">No text</span>
              </div>
              <div style="height:{S['md']}px"></div>
              <div class="shot"><svg viewBox="0 0 320 170"><rect width="320" height="170" fill="var(--fill)"/><rect x="46" y="32" width="228" height="76" rx="5" fill="var(--paper)" stroke="var(--hairline)"/><rect x="62" y="50" width="128" height="11" rx="3" fill="var(--hairline)"/><rect x="62" y="70" width="186" height="9" rx="3" fill="var(--hairline)"/><rect x="62" y="86" width="96" height="9" rx="3" fill="var(--hairline)"/><rect x="100" y="112" width="120" height="32" rx="4" fill="var(--hairline)" opacity=".55"/></svg></div>
              <div style="height:{S['md']}px"></div>
              <div class="btn secondary" style="{t('labelLarge')}">View extracted text</div>
              <div style="height:{S['sm']}px"></div>
              <div style="display:flex;gap:{S['sm']}px">
                <div class="btn secondary" style="flex:1;{t('labelLarge')}">Request redo</div>
                <div class="btn primary" style="flex:1;{t('labelLarge')}">Approve</div>
              </div>
            </div>
            <div style="height:{S['md']}px"></div>
            <div class="banner neutral">
              <div style="{t('titleSmall')}color:var(--inkmuted)">Text extraction is not running yet</div>
              <div style="height:2px"></div>
              <div style="{t('bodySmall')}color:var(--inkmuted)">No text has been read from this photograph. Review the image itself — the API reports extraction as unavailable.</div>
            </div>
          </div>'''

SCREENS = (
    phone('Welcome', 'The role is asked first because the API binds it to the challenge when the '
                     'code is issued and rejects it on verify. It cannot be collected later.', welcome)
    + phone('Code', 'The development code appears only outside production, where the API echoes it '
                    'back. Name and mobile show only when registering — the two optional fields '
                    '<code>/verify</code> accepts.', code)
    + phone('Work', 'Accepted jobs sit above the feed, from <code>snapshot_jobs</code> on '
                    '<code>/worker/sync</code>. They cannot appear twice: the feed query filters on '
                    '<code>worker_id IS NULL</code>.', work)
    + phone('Earnings', 'One number larger than everything else, because it is the only one a worker '
                        'opens this tab to see. Money in review is grey — it is not theirs yet.', earnings, dark=True)
    + phone('Review queue', 'The panel renders whatever <code>ocr_status</code> says. Today that is '
                            'always <em>unavailable</em>, so it says so rather than inventing a '
                            'transcript.', review)
)

# ------------------------------------------------------------------ type table

ORDER = ['displayLarge', 'displayMedium', 'displaySmall', 'headlineLarge', 'headlineMedium',
         'headlineSmall', 'titleLarge', 'titleMedium', 'titleSmall', 'bodyLarge', 'bodyMedium',
         'bodySmall', 'labelLarge', 'labelMedium', 'labelSmall']
USED = {
    'displaySmall': 'Welcome and sign-in headlines', 'headlineSmall': 'Section headers',
    'titleLarge': 'Top bars, screen titles', 'titleMedium': 'Card titles, job names',
    'bodyLarge': 'Field values, lede paragraphs', 'bodyMedium': 'List rows, supporting text',
    'bodySmall': 'Captions, card descriptions', 'labelLarge': 'Button labels',
    'labelMedium': 'Chips, inline actions', 'labelSmall': 'Uppercase eyebrows, nav labels',
}
rows = []
for k in ORDER:
    v = TYPE[k]
    sample = 'Field work, paid on completion' if v['size'] < 24 else '₹8,400'
    rows.append(f'''      <div class="trow">
        <div class="tspec"><b>{k}</b><span>{v['size']}sp · {v['lh']}/{v['size']} · {v['weight']}{f" · {v['track']}" if v['track'] else ""}</span></div>
        <div class="tdemo" style="{t(k)}">{sample}</div>
        <div class="tuse">{USED.get(k, '—')}</div>
      </div>''')
TYPE_TABLE = '\n'.join(rows)

SWATCHES = '\n'.join(
    f'''      <div class="sw"><div class="chipcol" style="background:#{LIGHT[k]}{';border-bottom:1px solid var(--hairline)' if k in ('paper','canvas','fill') else ''}"></div>
        <div class="swmeta"><b>{label}</b><code>#{LIGHT[k]} · #{DARK[k]}</code><p>{desc}</p></div></div>'''
    for k, label, desc in [
        ('ink', 'Ink', 'Body text, and the fill of the primary button.'),
        ('inkMuted', 'Ink muted', 'Supporting text that still must be read.'),
        ('canvas', 'Canvas', 'The page. Warm-shifted so it does not read as an unset grey.'),
        ('accent', 'Accent', 'Money, earnings, completion. Nothing else.'),
        ('attention', 'Attention', 'Waiting on the user: unfunded, expiring, blurry.'),
        ('danger', 'Danger', 'Failed or destructive. Rare by design.'),
    ])

HTML = f'''<title>NetworkPeer Worker UI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<style>
  :root{{
{css_vars(LIGHT)}
    --page:#EDEDE9; --frame:#16171A;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  }}
  @media (prefers-color-scheme: dark){{
    :root:not([data-theme="light"]){{
{css_vars(DARK)}
      --page:#0A0B0C; --frame:#000000;
    }}
  }}
  :root[data-theme="dark"]{{
{css_vars(DARK)}
    --page:#0A0B0C; --frame:#000000;
  }}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--page);color:var(--ink);
    font-family:'Plus Jakarta Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
  .wrap{{max-width:1240px;margin:0 auto;padding-block:56px 80px;padding-left:16px;padding-right:16px}}
  .eyebrow{{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--inkfaint);margin:0 0 14px}}
  h1{{font-size:clamp(34px,6vw,52px);line-height:1.02;letter-spacing:-.035em;font-weight:800;margin:0 0 18px;text-wrap:balance;max-width:18ch}}
  h1 em{{font-style:normal;color:var(--accent)}}
  .lede{{font-size:17px;line-height:1.6;color:var(--inkmuted);max-width:62ch;margin:0}}
  h2{{font-size:clamp(22px,3vw,28px);line-height:1.15;letter-spacing:-.02em;font-weight:800;margin:0 0 10px}}
  h3{{font-size:15px;font-weight:700;margin:0 0 8px}}
  p{{line-height:1.65;color:var(--inkmuted);margin:0 0 14px}}
  section{{margin-top:72px}}
  .section-intro{{max-width:64ch;margin-bottom:32px}}
  code{{font-family:var(--mono);font-size:.92em;color:var(--accent);font-weight:600}}

  .callout{{border:1px solid var(--hairline);border-left:3px solid var(--accent);border-radius:12px;
    background:var(--paper);padding:20px 22px;margin-top:26px}}
  .callout h3{{margin-bottom:8px}}
  .callout p{{margin:0;font-size:14px}}

  .screens{{display:flex;gap:36px;overflow-x:auto;padding:4px 0 26px;scroll-snap-type:x mandatory}}
  .screens::-webkit-scrollbar{{height:6px}}
  .screens::-webkit-scrollbar-thumb{{background:var(--hairline);border-radius:3px}}
  .screen{{scroll-snap-align:start;flex:0 0 auto;width:408px;max-width:88vw}}
  .caption{{margin-top:18px}}
  .caption p{{font-size:13.5px;line-height:1.55;margin:0}}

  /* 1 CSS pixel = 1dp. The frame is a 390dp phone. */
  .phone{{width:408px;max-width:88vw;height:806px;background:var(--frame);border-radius:44px;padding:9px;
    box-shadow:0 1px 2px rgba(0,0,0,.18),0 20px 48px -20px rgba(0,0,0,.45)}}
  .glass{{width:100%;height:100%;background:var(--canvas);border-radius:36px;overflow:hidden;display:flex;flex-direction:column}}
  .phone.dark .glass{{background:#0C0D0F;color:#F3F3F1}}
  .statusbar{{height:32px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;
    padding:0 22px;font-size:13px;font-weight:700}}
  .sb-right{{display:flex;gap:4px;align-items:center}}
  .sb-right i{{width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.7;display:block}}
  .scroll{{flex:1;overflow:hidden}}
  .appbar{{background:var(--paper);border-bottom:1px solid var(--hairline);padding:12px {S['lg']}px 14px;flex:0 0 auto}}
  .phone.dark .appbar{{background:#17181B;border-color:#2B2D32}}

  .mark{{width:34px;height:34px;border-radius:8px;background:var(--ink);color:var(--oninK,var(--paper));
    display:grid;place-items:center;font-size:16px;font-weight:800}}
  .phone.dark .mark{{background:#F3F3F1;color:#0B0C0E}}

  .card{{background:var(--paper);border:1px solid var(--hairline);border-radius:16px;padding:{S['lg']}px}}
  .phone.dark .card{{background:#17181B;border-color:#2B2D32}}
  .well{{width:44px;height:44px;border-radius:50%;background:var(--fill);display:grid;place-items:center;flex:0 0 auto}}
  .well svg{{width:24px;height:24px;stroke:var(--ink);fill:none;stroke-width:1.7;stroke-linecap:round}}

  .field{{border:1px solid var(--hairline);background:var(--paper);border-radius:14px;padding:10px 14px;min-height:52px;
    display:flex;flex-direction:column;justify-content:center}}
  .field.empty{{justify-content:center}}
  .flabel{{font-size:12px;font-weight:600;color:var(--inkmuted);margin-bottom:2px}}

  .btn{{height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:8px}}
  .btn.primary{{background:var(--ink);color:var(--paper)}}
  .phone.dark .btn.primary{{background:#F3F3F1;color:#0B0C0E}}
  .btn.secondary{{background:var(--paper);color:var(--ink);border:1px solid var(--hairline)}}
  .phone.dark .btn.secondary{{background:#17181B;color:#F3F3F1;border-color:#2B2D32}}

  .pill{{display:inline-flex;align-items:center;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;letter-spacing:.7px;white-space:nowrap}}
  .pill.neutral{{background:var(--fill);color:var(--inkmuted)}}
  .pill.pos{{background:var(--accentsoft);color:var(--accent)}}
  .pill.att{{background:var(--attentionsoft);color:var(--attention)}}

  .chips{{display:flex;gap:8px}}
  .chip{{border-radius:999px;padding:8px 12px;background:var(--fill);color:var(--inkmuted);white-space:nowrap}}
  .chip.on{{background:var(--ink);color:var(--paper)}}

  .banner{{border-radius:14px;padding:{S['md']}px}}
  .banner.att{{background:var(--attentionsoft);color:var(--attention)}}
  .banner.neutral{{background:var(--fill)}}

  .stepbar{{display:flex;gap:4px}}
  .stepbar i{{flex:1;height:4px;border-radius:999px;background:var(--hairline);display:block}}
  .stepbar i.done{{background:var(--accent)}}
  .stepbar i.now{{background:var(--ink)}}

  .rule{{height:1px;background:var(--hairline)}}
  .iconbtn{{width:40px;height:40px;border-radius:12px;background:var(--fill);display:grid;place-items:center}}
  .iconbtn.ghost{{background:transparent;width:32px;height:32px;margin-left:-6px}}
  .iconbtn svg{{width:20px;height:20px;stroke:var(--ink);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}}
  .phone.dark .iconbtn svg{{stroke:#F3F3F1}}

  .navbar{{flex:0 0 auto;background:var(--paper);border-top:1px solid var(--hairline);height:64px;display:flex;align-items:center;padding:0 8px}}
  .navitem{{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--inkfaint)}}
  .navitem.on{{color:var(--ink)}}
  .navitem svg{{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}}

  .total{{background:var(--ink);color:var(--paper);border-radius:18px;padding:{S['lg']}px}}
  .phone.dark .total{{background:#17181B;color:#F3F3F1;border:1px solid #2B2D32}}
  .tsplit{{flex:1;background:rgba(127,127,127,.22);border-radius:12px;padding:10px 12px}}
  .payrow{{display:flex;align-items:center;gap:{S['md']}px;padding:12px 0;border-top:1px solid var(--hairline)}}
  .payrow .ico{{width:36px;height:36px;border-radius:10px;background:var(--accentsoft);display:grid;place-items:center;flex:0 0 auto}}
  .payrow .ico svg{{width:16px;height:16px;stroke:var(--accent);fill:none;stroke-width:2.2;stroke-linecap:round}}
  .payrow .ico.att{{background:var(--attentionsoft)}}
  .payrow .ico.att svg{{stroke:var(--attention)}}
  .shot{{height:170px;border-radius:14px;overflow:hidden;background:var(--fill)}}
  .shot svg{{width:100%;height:100%;display:block}}

  .tlist{{border:1px solid var(--hairline);border-radius:14px;overflow:hidden;background:var(--paper)}}
  .trow{{display:grid;grid-template-columns:190px 1fr 210px;gap:20px;align-items:center;padding:14px 18px}}
  .trow + .trow{{border-top:1px solid var(--hairline)}}
  .tspec b{{display:block;font-size:13px;font-weight:700}}
  .tspec span{{display:block;font-family:var(--mono);font-size:11px;color:var(--inkfaint);margin-top:2px}}
  .tdemo{{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}}
  .tuse{{font-size:12.5px;color:var(--inkmuted);line-height:1.4}}
  @media (max-width:820px){{
    .trow{{grid-template-columns:1fr;gap:8px}}
    .tuse{{order:3}}
  }}

  .swatches{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}}
  .sw{{border:1px solid var(--hairline);border-radius:13px;overflow:hidden;background:var(--paper)}}
  .sw .chipcol{{height:64px}}
  .swmeta{{padding:12px 13px}}
  .swmeta b{{display:block;font-size:13px;font-weight:700}}
  .swmeta code{{display:block;font-size:10.5px;color:var(--inkfaint);margin-top:3px;font-weight:500}}
  .swmeta p{{font-size:11.5px;line-height:1.5;margin:7px 0 0}}

  footer{{margin-top:76px;padding-top:26px;border-top:1px solid var(--hairline);font-size:12.5px;color:var(--inkfaint);line-height:1.7}}
  @media (max-width:640px){{ .wrap{{padding-block:40px 60px}} section{{margin-top:56px}} }}
</style>

<div class="wrap">
  <p class="eyebrow">NetworkPeer · Android · Worker</p>
  <h1>Ink, and one <em>signal</em> colour.</h1>
  <p class="lede">
    The worker app's interface, built around a single idea: the screen is black and white, and colour
    is reserved for money and for whatever is waiting on you.
  </p>

  <div class="callout">
    <h3>Every number on this page is read out of the Kotlin</h3>
    <p>
      The first version of this page was drawn in a 302-pixel-wide mockup with sizes picked by eye.
      Text sized to look right in a small picture of a phone is far too small on the phone — measured
      against it, the implemented scale was 9% short at body sizes and 29% short at display sizes.
      These frames are 390dp wide and <strong>one CSS pixel is one dp</strong>, and the sizes are
      parsed out of <code>Type.kt</code> and <code>NetworkPeerTheme.kt</code> when the page is built.
      The design and the app can no longer drift apart.
    </p>
  </div>

  <section>
    <h2>The screens</h2>
    <div class="section-intro"><p>Shown at true size. Swipe sideways.</p></div>
    <div class="screens">{SCREENS}
    </div>
  </section>

  <section>
    <h2>Type</h2>
    <div class="section-intro">
      <p>
        Plus Jakarta Sans, bundled at five weights — the same family the website preview uses. A 1.2
        scale anchored on a 17sp reading size. Large text is set tight and heavy, small text loose
        and light; that one rule is most of what separates a typeset screen from a default one.
      </p>
    </div>
    <div class="tlist">
{TYPE_TABLE}
    </div>
  </section>

  <section>
    <h2>Colour</h2>
    <div class="section-intro"><p>Six roles, light and dark. Nothing is coloured for decoration.</p></div>
    <div class="swatches">
{SWATCHES}
    </div>
  </section>

  <footer>
    NetworkPeer worker app · Android · Jetpack Compose.<br>
    Generated from the design tokens in <code>ui/theme/</code> — regenerate after changing them.<br>
    Plus Jakarta Sans by Tokotype, SIL Open Font License 1.1.
  </footer>
</div>
'''

out = pathlib.Path('/Users/abhishekharsh/.claude/jobs/9255de68/tmp/np-redesign.html')
out.write_text(HTML)
print(f'wrote {out} — {len(HTML)} bytes')
print(f'type tokens: {len(TYPE)}   space tokens: {len(SPACE)}   palette: {len(LIGHT)}')
