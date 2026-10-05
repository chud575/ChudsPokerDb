# PokerStars Hand Replayer

A self-contained, offline hand-history viewer/replayer for PokerStars `.txt` histories.
No install, no server, no dependencies — open `index.html` in a browser and drop files on it.

## The main menu

The app opens on a menu, not a file dialog:

* **Library** — what you have imported. Import a tournament once and it stays; the replayer is
  filled from the library every time you open the app.
* **Replay hands** — the step-through replayer, markup and teaching tools.
* **Player database** — statistics on every player the library has seen, kept separate by game.
* **Your numbers** — the same breakdown for you.
* **Tournament Overview** — final standings of every tournament in your PokerStars "Tournament
  History" emails, and your record across them.
* **Starting hands** — every hand you were dealt, how often you play it and win with it, and whether it pays.
* **Skill vs luck** — all-ins against their equity, suckouts for and against, and your result with the luck taken out.
* **Lessons** — named, ordered groups of annotated hands.

## The library

Hands live in the browser's own database (IndexedDB), keyed by hand number so re-importing the same
file changes nothing. Every import answers back: how many were added, how many were already there,
which files held no hands, which could not be read, and — if the database refuses the write, quota
or otherwise — that it failed and the hands are still usable for this session. Whichever screen is
open updates as soon as the import lands. Importing asks once whether to keep the hands; answer *always* and it stops
asking. The Library screen lists every tournament with its games, hand count and your finish, and
lets you open one into the replayer or remove it.

A browser will not open that database for a page loaded straight off disk. The Library screen says
so plainly if that happens, and the fix is to serve the folder over http (below) — the replayer
itself still works either way.

## Between the replayer and a tournament

* **In the replayer**, the pull-down above the hand list loads any tournament in the library — date,
  event, hands, your finish — or the whole library. It always shows what is loaded now (after opening a
  single hand from another screen it reads "Loaded now: 1 hand of #…", and the whole library is one
  choice away). **Results ▸** beside it opens the current hand's tournament in the Tournament Overview.
* **On a tournament's page**, **▶ Replay the hands** loads that tournament into the replayer. When its
  hand histories are not in the library the button says so and tells you what to import.
* The Library screen's **open** and **results** buttons do the same from the list of tournaments.

## Player statistics

Every player in the library gets a column per game plus a combined column, because Omaha numbers
have no business sitting in a Stud 8 average. Each figure carries its own denominator, so a stat
with no opportunities reads `—` rather than `0%`, and one computed from fewer than 20 opportunities
is greyed with the count on hover.

VPIP, raise-first-round, open-raise, 3-bet, fold-to-3-bet, went-to-showdown, won-at-showdown, won
without showdown, fold-after-entering, aggression frequency and factor, hands won, net chips and
chips per hand — plus per-family extras: stands-pat rate and cards per draw for draw games,
bring-ins and completions for stud.

**VPIP is also split by table size** — "VPIP, 5+ players" and "VPIP, 4 or fewer" (players dealt into the
hand) — because short-handed play at the end of a tournament is a different game and would inflate a
single number. The player list shows the full-table figure once a player has ten such hands, and the
Starting hands screen and each tournament's summary carry the same split.

Tournament summaries sit above: how many played and of which games, how many finishes the files
actually record, and how many of those carried a payout. Finishes the history never recorded are
excluded from the denominator rather than counted as busts.

Every player's hands are listed underneath; click one to open it in the replayer.

## Opening it

Double-click **Open Hand Replayer.command** in this folder (drag it to the Dock to keep it handy).
It opens `index.html` in Safari.

**Always open it the same way.** Everything you import, annotate, star or group into a lesson is
stored by the browser *for that browser and that address*. Opening the file in Chrome, or through
`http://localhost:…` instead of the file, gives you a separate, empty library — your data is not
gone, it is at the other address. The Library screen names the address it is using. Use
**⭳ Back up** / **⭱ Restore** on that screen to move everything between them, or just to keep a copy.

Then load hands with any of:

* **Load files** — pick one or more `.txt` histories
* **Load folder** — point it at
  `~/Library/Application Support/PokerStars/HandHistory/<your screen name>` to ingest everything at once
  (~4,100 hands parse in about a third of a second)
* **drag & drop** — files *or* whole folders onto the window
* **Paste text** — paste a single hand from the chat/notes

Nothing leaves the machine; the page never makes a network request.

## Games supported

Every game found in a PokerStars history, in tournament or cash format:

| family | games |
|---|---|
| stud  | Razz, 7 Card Stud, 7 Card Stud Hi/Lo |
| flop  | Hold'em, Omaha, Omaha Hi/Lo (Limit / Pot Limit / No Limit) |
| draw  | 2-7 Triple Draw, 2-7 Single Draw, A-5 Triple Draw, A-5 Single Draw, Badugi, 5 Card Draw — each in whatever betting structure the site spread it in, and written in either word order (`Triple Draw 2-7` or `2-7 Triple Draw`, `Deuce to Seven`, `Five Card Draw`) |
| mixed | HORSE, TORSE, HOSE, 8-Game, 10-Game, Mixed NLH/PLO — any `EVENT (Game Limit)` header. The game switches per hand and the header shows both, e.g. `TORSE → Razz FL` |

Zoom / Home Game tables, bounty (progressive KO) buy-ins and the `(… in chips, $X bounty)` seat
format are all handled, as well as plain ring games.

## What the replay shows

* every seat with **name, seat number, live chip count, position** (BTN/SB/BB), sitting-out and
  all-in state, and the player's most recent action
* chips **in front** of each player for the current betting round, plus the running pot
* **card fidelity that matches what was actually visible at the time**
  * every game deals on the opening frame — face-down holdings for the villains and the hero's own
    cards visible — so a hand never opens on a bare table, whatever the round of a mixed event
  * stud: the opening frame shows every player's door card too (as it would be on the real
    table) with two backs beside it and the hero's own down cards visible; one new up card per
    street, 7th street down; villains show only their up cards until they show down. The hero's
    own up-cards are **raised** out of the row, so what the table can see about your hand is
    obvious at a glance
  * draw: hidden hands with `draws 2` / `pat` badges, hero's discards and replacements. When a
    player draws, the cards they pitched appear face-down against the front edge of *their own*
    seat — the hero's are the real ones, since the history names them — and stay there for that
    betting round, so the number of cards everyone took is visible at a glance rather than buried
    in the log. Each pile is placed by trying a few spots off its seat and taking the first that
    touches no seat, bet chip, pot or other pile, so it never drifts toward a neighbour
  * flop games: hole cards and the board as it comes out
* showdown reveals, mucked-but-shown hands from the summary block, side/main pot payouts
* per-hand result for every player, the raw text, and the full action log (click any line to jump)

**Black bg** in the top bar drops the whole interface to solid black — better contrast for screen
recording and video, and it sticks between sessions.

**X-ray** (toggle, or press `x`) fills in the cards that were only revealed at showdown — greyed
out so you can tell them from what was public at the time. For draw games it only unlocks after
the last draw, since earlier holdings genuinely differed.

## Heads-up equity

Whenever two **or more** players are still live, a Monte-Carlo equity strip appears under the table
and a % badge on each live seat (colour-matched to the bar). It handles up to nine players; shares
always sum to 100%. Default is **50,000 simulations**; the dropdown in the top bar
offers off / 10k / 50k / 200k. It runs in slices so the table stays responsive and the number
converges on screen, and it re-runs on every step.

What it simulates depends on what is knowable at that moment:

* *exact — all cards known* — nothing left to deal, so it is a straight 100 / 0 / split
* *actual hands, run-out simulated* — both holdings are known (X-ray on, or everything is face up),
  only the cards still to come are random. This is the classic all-in equity number.
* *unknown cards sampled* — a villain's down cards are still hidden, so they are drawn uniformly
  from the cards you have not seen (folded players' exposed cards are removed from the deck too).
  This is your equity *given what was visible at the time*. Press `x` to switch to actual cards.

In split-pot games (Stud Hi/Lo, Omaha Hi/Lo) the strip also breaks the pot into its two halves:
a **HI** row showing each player's share of the high half, a **LO** row for the low half (measured
over the runouts where a low actually qualifies), and how often a low is made at all. A player
scooping shows near-100% on both rows; a nut-low lock with no high shows ~100% LO and 0% HI.

### Range slider — top X% instead of any two cards

To the right of the equity strip is a **range slider** (5% steps). At `any two` (the default) a hidden opponent's cards
are drawn uniformly from everything you have not seen. Drag it down and they are restricted to the
**top X% of the holdings they could actually have in this spot** — so you can ask "what if he only
gets here with the top 15%?" instead of assuming he plays everything.

How the cut is made: the app samples 20,000 holdings the hidden player could hold given the visible
cards, ranks them, and takes the score at the X-percentile as a threshold; the simulation then
rejection-samples against it. Because the pool is built from the *live* deck, it automatically
respects dead cards and the opponent's own up-cards. With several unknown opponents the range is
applied to each of them independently. The slider greys out when nothing is hidden
(X-ray on, or a completed showdown), and the label under the bar always names who is being ranged,
so a range left on from a previous hand can never quietly skew a number.

What "top X%" ranks by, per game:

* **Hold'em** — a baked table of all 169 starting hands scored by their equity against one random
  hand (40k sims each, measured with this file's own evaluator). Top 5% comes out as
  77+ / ATs+ / AQo+, top 20% as 44+ / A2s+ / KTs+ / KJo+ — i.e. what you'd expect from a chart.
* **Razz, A-5 triple draw** — lowness of the current holding, pairs penalised
* **2-7 triple/single draw** — the current five cards read as a 2-7 hand
* **Badugi** — badugi size, then card ranks
* **Stud** — trips > pairs > three-flush / three-straight > high cards
* **Stud Hi/Lo, Omaha Hi/Lo** — top X% by the high side *or* the low side (a union, so the
  effective slice is a little wider than X%)
* **Omaha** — a four-card starting-hand heuristic (pairs, suitedness, connectedness); approximate

For stud and draw games the ranking is over the player's holding *as it stands on that street*; for
flop games it is over their starting hand, matching the usual preflop-range meaning.

Draw games additionally replay the remaining draws, using each player's real discard counts from
the history and a keep-the-best-cards heuristic, so those numbers are an approximation rather than
an exact solve.

The evaluators cover A-5 lowball (Razz), high (Stud, Hold'em, Omaha), 8-or-better split
(Stud Hi/Lo, Omaha Hi/Lo, with the two-from-hand rule for Omaha), 2-7 lowball and Badugi.
Every one was checked against real results: for all **1,492 single-pot showdowns** in the history
folder where the cards are known, the evaluator's winner set matches who PokerStars actually paid —
no mismatches in any game.

## Building a hand from scratch

**✚ New hand** in the top bar opens a composer for hypotheticals — the spot you want to teach, not
one you happened to play.

Pick the game and stakes, name the players and their stacks, click the card slots and deal from a
52-card grid (used cards grey out, and it advances to the next empty slot so you can click a whole
hand in without stopping), then list the action street by street.

It does not invent a second kind of hand. It **writes real PokerStars hand-history text**, which
goes through the same parser, engine, equity and markup as anything off the site — so a built hand
replays, computes equity, takes annotations and exports into a lesson exactly like a real one.

It also does the bookkeeping: call amounts, raise increments (`raises 200 to 400`), all-ins, the
uncalled bet returned at the end, the pot, and — using the same evaluators that reproduce
PokerStars' own payouts — who wins at showdown and how a split pot divides. The right-hand pane
shows the generated text live and re-parses it on every keystroke, so the status line says
**✓ valid · N steps · pot X** only when the text survives the parser *and* the engine's three chip
invariants.

**save** keeps the hand in this browser (it comes back on reload, filed under `built`),
**save & open** drops you straight into the replayer with it, and **download .txt** writes a normal
hand-history file you can share or re-import anywhere.

## Teaching mode

Press **✎ Teach** in the top bar. A markup toolbar appears above the table and a **Teach** tab opens
on the right. Everything you add is bound to the step you added it on, so walking the stepper walks
the lesson.

### Markup tools

| tool | key | what it does |
|---|---|---|
| select | `V` | click a mark to select, drag to move, drag a handle to reshape, `⌫` to delete |
| arrow | `A` | drag to draw a pointer |
| box | `B` | drag a rectangle |
| circle | `O` | drag an ellipse (hold `⇧` for a circle) |
| freehand | `P` | draw with the mouse |
| text | `T` | click, type, `↵` to place (`⇧↵` for a second line, `Esc` to cancel). The box wraps and grows as you type, drag its right edge to set the column width, and the placed label keeps that width — grab its right-hand grip any time to re-wrap it. Placing a label hands the pointer back to **select**, with the new label already selected so you can drag it into position. **To edit a placed label:** double-click it, or click it once when it is already selected, or press `↵` / `F2` with it selected. Dragging still moves it |
| target | `G` | click a seat, a card, the pot or the equity strip — draws a pulsing ring that stays glued to it |
| spotlight | `L` | drag over the thing that matters; everything else dims |
| erase | `E` | click a mark to remove it |

`⌘Z` / `⇧⌘Z` undo and redo. Colour and line weight are in the toolbar, and **clear step** /
**clear hand** wipe the current step or the whole hand.

The **target** tool is the one worth knowing about: instead of storing coordinates it stores *what*
you clicked, so its ring follows that card or seat when the table re-renders, resizes, or the seats
shift as players fold.

### How long a mark stays up

The dropdown next to the colours sets what happens to the *next* mark you draw:

* **this step only** — the default; it appears on that one action and vanishes
* **from here on** — it appears at that step and stays for the rest of the hand
* **whole hand** — always on screen

### Notes and the presenter band

The Teach tab has a note box for the current step — the script for what you'd say there. Notes show
in a caption band under the table, and every annotated step gets a tick on the scrub bar (green if
it carries a note) so a marked-up hand is navigable at a glance. **Marked steps** lists them all;
click one to jump.

### Present

**⛶ present** (or the button in the toolbar) hides the panels and the top bar and fills the screen
with the table, the markup and the caption band — the frame you want on screen while recording or
screen-sharing. `Esc` exits.

### Dictation (speech to text)

**🎙 dictate** in the Teach tab types what you say into whichever text box has focus — the step
note, the lesson title, or a text mark you are placing on the table. Words appear live as you
speak; press stop when you're done. It uses the browser's own speech recognition (Chrome and
Safari both have it) and needs a network connection. If the browser has none, the button is
disabled and narration recording is the alternative.

### Narration

**● record** in the Teach tab captures your microphone *and* remembers which step was on screen at
every moment. Press **▶ play** and the audio plays back while the replay walks itself through the
hand exactly as you narrated it — the lesson replays hands-free. Playback is driven by a timer
rather than the animation frame clock, so it keeps following the audio even when the window is
behind something else.

Audio is kept in IndexedDB where that is available. Opening `index.html` straight off disk blocks
IndexedDB in Chrome, so there the recording lives in memory for the session only — the panel says
so when that happens, and **export** always writes it to a file regardless. If your browser refuses
the microphone on a `file://` page, serve the folder over http (see below).

### Video

**⏺ screen + mic** captures a window or tab you choose, mixed with your microphone, and saves a
video file — `.webm` in Chrome, `.mp4` in Safari, whichever that browser can actually record. Stop
from the button or the browser's own sharing bar.

### Saving

Markup and notes save themselves to the browser as you work — there is no save button to forget,
and the Teach tab flashes **✓ saved** each time something is stored. They come back when you reopen
the hand, and the Teach tab lists every lesson held on this machine so you can jump back into one.

For a copy you own, **⭳ save lesson** on the toolbar (or **export** in the panel) writes the whole
thing to a file.

### Lesson files

**export** writes one `.json` holding the hand text, the markup, the notes and the narration audio.
**import** loads it back on any machine — the hand comes with it, so a lesson opens even if that
history file isn't there. Lessons also persist in the browser between sessions; the Teach tab lists
everything stored locally so you can jump back into one.

### Serving it over http

The teaching features that need a microphone or screen capture are happiest on a real origin:

```bash
python3 -m http.server 8777 --directory "/path/to/this/folder"
```

Then open http://localhost:8777.

## Controls

| key | action |
|---|---|
| `→` / `←` | next / previous action |
| `Shift+→` / `Shift+←` | next / previous street |
| `↓` / `↑` | next / previous hand |
| `space` | play / pause autoplay |
| `Home` / `End` | start / end of hand |
| `x` | x-ray toggle (also switches equity to actual cards) |

The scrub bar under the buttons seeks anywhere in the hand, and the speed slider sets autoplay pace.

## Tagging hands for review

Every row in the hand list has a star, and so does the open hand (next to its title, or press `s`).

* **gold ★** — you tagged it for review
* **blue ★** — the hand carries markup, a note or narration but has *not* been tagged: it has been
  discussed already and may want another look
* **☆** — untouched

The blue star sets itself the moment you annotate a hand, so the list shows at a glance what you
have worked through and what you flagged to come back to. The **Any hand** filter narrows to
tagged, annotated, or either, and the count line shows how many of each are in view. Tags live in
this browser alongside the lessons and come back on reload.

## Browsing and filtering

The left rail lists every loaded hand with the hero's starting cards and the hero's net chips for
that hand. Filter by game, by file, by result (hero won / lost / went to showdown / put money in),
free-text search over player names, hand numbers and shown cards, and sort chronologically or by
biggest pot / win / loss. The **Stats** tab summarises whatever the filter currently selects
(net, win rate, showdowns, breakdown by game).

**Hero** defaults to whoever's hole cards are in the file; the dropdown re-centres the table and
all the P/L numbers on any other player at the table.

## Correctness

The replay is rebuilt from the action lines rather than trusted from the summary, so three
invariants are checked on every hand and any violation is shown in the **Hand** tab:

1. chips contributed by all players == `Total pot`
2. everything collected + rake == `Total pot`
3. each player's replayed winnings == their summary line

All 4,110 hands in the current history folder pass all three. Stack continuity across
consecutive hands at the same table also holds for 19,532 of 19,544 seat transitions — the
12 exceptions are re-entries and hands missing from the file, not accounting errors.

## Solver assessment

The **Solver** tab in the replayer asks your HORSE+ Solver what it would have done at each of your
decisions in the open hand, and lines its answer up against what you actually did — green where you
agree, red where you don't, with the model's own EV breakdown and which model answered.

Start the solver first:

```bash
cd "/path/to/HORSE+ Master" && python3 horse_master.py -p 5055
```

(Port 5000 is taken by macOS Control Center, hence 5055.) The tab has a **test** button that says
plainly whether it can reach the solver. The address is configurable and remembered.

What it covers, and what it does not:

* **Razz, Stud Hi, Stud Hi/Lo, Hold'em** — the solver answers for these. **Omaha Hi/Lo** is
  registered in the solver but its advisor returns HTTP 500 for every payload shape, so it is left
  out until that is fixed.
* **No draw games.** The solver has no Badugi or 2-7 model, which is most of your volume.
* **Heads-up spots only** for the stud family: those adapters return nothing when more than one
  opponent is live. About half of your Razz decisions qualify; the rest are listed with the reason
  rather than silently dropped.
* **Fixed-limit only**, which is what the models were trained on.

Two conversions matter and are handled here: pot and to-call are sent in **small bets** (for a level
of `(100/200)` the small bet is 100), and hero cards are sent in dealt order because the adapters
read slots 0 and 1 as the hole cards.

## Lessons

A lesson is a named, ordered group of hands — “Pre-flop raising on the button”, “Playing too tight on
the bubble”. In the replayer, **+ Lesson** beside a hand's title adds it to an existing lesson or
starts a new one; hands from the library and hands built from scratch both work. On the Lessons
screen you name and describe it, reorder its hands, and **▶ Open in replayer** plays exactly those
hands in teaching order (not by date).

Markup, notes and narration stay attached to each hand rather than being copied into the lesson,
so annotating a hand improves every lesson it appears in. **⭳ Export** writes one file holding the
lesson, its hands and all their annotations; **⭱ Import a lesson file** loads it on any machine.

## Starting hands

Every starting hand in your hand histories, per account and per game (games are never mixed — a mixed
event's Razz hands count as Razz). A starting hand is what you held when the first betting round began:
two hole cards in hold'em, four or five in Omaha, the three on third street in stud, the first five
(four in badugi) in a draw game. Each has two names, and the screen can list either:

* **By kind of hand** — "Three low cards, no ace", "1-card draw to a 7", "3-card badugi, 5 or better",
  "A2 with a suited ace", "Suited broadway"…
* **Every hand** — the hand itself with suits reduced to what matters: `AKs`, `(A2)3` (hole cards in
  brackets, then the door card; `s` = three-flush), `2-3-4-7-9`, `A-2-4 (3-card)`, `AK92 ds`.

Columns: dealt, played, played %, won, win % when played, showdowns, won at showdown, net, net per
deal, net per time played, and a verdict (Profitable / Losing / Break-even, or "Too few to say" under 8
deals). Click a column to sort; "dealt at least" and the find box narrow it. Click a row for the
write-up — the verdict in a sentence, how often you played it and what that made, what the unplayed
deals cost in antes and blinds, showdown record, best and worst result — and every time you held it,
each of which opens in the replayer.

* **Net is in big bets** (limit) or **big blinds** (no-limit / pot-limit) at the level the hand was
  played, so early and late tournament levels add up fairly.
* **Played** means you put money in by choice on the first round — a call, a raise, or a stud
  completion. Blinds, antes and a bring-in alone do not count; those deals show as "folded" or "free
  look".
* 2-7 hands are read by 2-7 rules: aces are high and a pat straight or flush is not a pat hand.

## Skill vs luck

Measured on the showdowns where every remaining player's cards are in the history. Each is one of:

1. **All-in before the last card** — the betting was over with cards still to come. Your equity at
   that moment, from the actual hands, times the pot is what you "should" have won; **luck = what you
   won − that**. Side pots are honoured layer by layer.
2. **Showdown, no all-in before the last card, and you were ahead** — equity with one card to come (the
   river; seventh street; the last draw). Ending with 30+ points less of the pot than that equity is
   **sucked out on**.
3. **The same, and you were behind** — ending 30+ points above your equity is **your suckout**.

For 2 and 3, luck = (share of the pot you ended with − equity before the card) × the pot before it. An
all-in on the last street counts here — no cards were left to come.

Luck is signed: a result that beats its equity is good luck, one that falls short is bad luck, and
the headline is the net. Both sides are also shown on their own — **good luck** and **bad luck**, in BB
and number of hands (the hands where the cards went your way include suckouts, all-ins won as the
underdog, and favourites that held up for more than their equity), with the luckiest and unluckiest
single hands, all-ins won as the underdog and lost as the favourite, and a list of every lucky and
every unlucky hand.

The screen shows the total luck in BB, your showdown result and what it would have been with the luck
removed, a cumulative chart of the two (hover for a hand, click to open it), a table for each kind of
hand (pots equity says you win vs pots you won), a by-game table, and the hands themselves — sucked
out on, your suckouts, all-ins, or everything — each opening in the replayer. The **skill** side is
what is left once luck is out: how often the money went in as the favourite, how often you reached
the last card ahead, what you make without a showdown, and the luck-removed result. It also says how
big a swing luck alone normally produces over a sample that size, so a number can be read as ordinary
or unusual.

**Any player, not only you.** The player list holds your accounts and every opponent whose cards
were ever shown (most showdowns first; type to find one). Pick an opponent and the whole page is
theirs — the same measures, re-worded — built from the hands in your histories where their cards
were shown. Cards only your history knows (your own, even folded or discarded) are still taken out of
the deck. **Every player — luck and skill side by side** at the bottom measures everyone at once
(minimum showdowns adjustable) into one sortable table: luck, showdown result, luck removed, all-ins
and how often as favourite, how often ahead at the last card, suckouts both ways, and result without
showdown; click a row to open that player. An opponent's sample is smaller than yours and leans
toward hands they took to showdown; deal luck is not available for them, because a starting hand that
never reached showdown is never seen. With every showdown player measured, the luck in a hand adds
up to zero — that is checked.

Four further measures sit below those, each with its own table:

* **Deal luck** — were you dealt your share of the hands that pay? For each game, how often each kind
  of starting hand should come (20,000 random deals) against how often it did, times what that kind is
  worth to you per deal above your average deal (pulled toward the average for kinds you have rarely
  held). Covers every hand dealt, not only showdowns. Pick a game to see it kind by kind.
* **Coolers** — a strong hand that ran into a stronger one. Strength is the share of the pot a finished
  hand takes heads-up against the field: in stud and draw games the hands actually shown down in that
  game (cooler = top 20%), in flop games random hole cards on the same board (cooler = beats 92%). It
  only counts when the loser was already behind before the last card; otherwise it is a suckout.
  Counted both ways — against you and for you.
* **Tournament life** — all-ins with every chip in and cards to come: the chance of getting anything
  back each time, how many of them equity says you survive, and how many you did. Plus total luck in
  *stacks* (each hand's luck ÷ the stack you started it with), so a flip for everything counts as much
  as it mattered.
* **Decisions** — every time you put money in, your equity at that point against the hands your
  opponents turned out to hold: by stage of the hand, the BB put in, how much of it went in with at
  least your fair share, calls against the price they needed (bet ÷ (pot + bet)), bets and raises
  made ahead, and the calls furthest from having the price. This grades whether the money went in
  good, not whether you could have known; only fully shown showdowns are in it, so folds are not.

* **Mistake cost** — the Decisions measure turned into chips. A call without the price costs what
  folding would have saved, `bet − equity × (pot + bet)`; a bet or raise made behind costs
  `bet × (1 − players × equity)` (everyone who stayed is taken to have matched it), and made ahead the
  same sum is a gain. The matching part of a raise is judged as a call. Costs are measured against
  stopping at that point, so they add up without counting a pot twice. The headline number is the
  first two rows — misjudged odds with cards to come. Last-round calls that lost and bets that were
  beaten are listed separately: each "costs" the whole bet in hindsight, but they are the price of
  bluff-catching and value-betting, not necessarily errors. Same limits as Decisions: hindsight
  against the hands they held, and only showdowns with every hand shown.

A tournament's page in the Tournament Overview opens with **Your tournament** when its hand histories
are in the library: hands, played %, pots won, showdowns, result with and without showdown, the same
luck numbers, how you went out (and your equity when you did), and the hands where luck moved the
most chips.

### Tournament review

With its hand histories in the library, a tournament's page also carries a **Review**: a few sentences
on how it went (stack, luck against play, money in bad and in good, showdown against no showdown,
starting hands against the HORSE+ EV table), a graph of your stack hand by hand with the key hands
marked, and the hands that mattered in four lists — **key mistakes** (money in bad with cards to
come), **well played** (value bets that got paid, last-round calls that were right, pots won without a
showdown), **luck, not play** (bad beats, your suckouts, coolers) and **worth a second look** (chips
put in and then folded, a last-round call that lost, a weak start played at a loss, a strong start
folded). Each hand gets one tag and one sentence, and opens in the replayer inside its tournament.

**Check my decisions with the solver** then asks the HORSE+ solver about every decision it can take
(heads-up limit Razz, Stud, Stud Hi/Lo and Hold'em) and lists where you differed. This is the one
part judged on what you could see; the rest is hindsight against the hands that were shown.

Limits: a showdown with a mucked hand that the history does not reveal is left out. In draw games an
opponent's cards before the last draw are not recorded, so they are taken to have kept the best of
what they showed (marked `~`); a draw-game all-in with two or more draws to come is left out. Equity
is exact with one or two cards to come and a seeded 3,000-run simulation otherwise, so a hand always
gives the same number. Results are cached per hand.

### HORSE+ EV tables

The HORSE+ EV tables — how much of the pot each starting hand wins, all-in to the end against random
hands, by number of players — are built in for Razz (2–8 players, the same numbers the HORSE+ app
shows), Stud Hi and Stud Hi/Lo (2–7), Omaha Hi/Lo (2–9) and Hold'em (heads-up). On the Starting hands
screen:

* **HORSE+ EV table — grid** (like the HORSE+ app's grid): every hand in the table as a tile, coloured
  by its equity against the fair share at the chosen number of players, with your results on top —
  times dealt and net, and a green / red bar when it has made or cost you money (3+ deals). Hands
  never dealt to you are dimmed.
* **HORSE+ EV table — list**: rank, equity bar, edge over the fair share, and your dealt / played /
  win % / net / BB per deal / verdict, all sortable.
* Pick the number of players (it starts on the size you are most often dealt) and sort by equity,
  times dealt, your net or your BB per deal. Click a hand for its equity at every table size, the
  write-up, and every time you held it.
* The ordinary tables gain **Table equity** and **vs fair share** columns: the table's equity for
  those cards at the number of players each was dealt with.

Your cards are matched to the table's names automatically (Razz by ranks; Stud by ranks and how
many are suited; Omaha by ranks and suit shape). Where the table splits a shape the matching cannot
tell apart (which two cards of a double-suited Omaha hand share a suit; which two of a stud hand),
the variants are averaged. `tools/make_evdata.py` rebuilds the tables from a HORSE+ folder.

## Tournament Overview (tournament history summaries)

PokerStars will email the results of your last N tournaments (*Requests → Tournament History*).
Save that email as `.txt` or `.rtf` (Mail → *Save As*, or paste it into TextEdit) and drop it on the
app, use **⭱ Import results** on the Tournament Overview screen, or paste it with *Paste text*. The
app recognises it on its own — RTF is converted in the browser (checked byte-for-byte against macOS
`textutil`).

Each tournament is stored exactly as printed, and every name in its standings gets a
**performance record** in the Player database — added if they were not there yet, merged by
tournament number if they were, so importing the same email twice changes nothing.

* Pick the **account** at the top of the list — every name that requested a history, plus the heroes of
  your hand histories, each with how many tournaments it appears in. Only that account's tournaments
  are listed and summarised; the choice is remembered. Open a tournament another of your accounts
  played (from a player's record, say) and it switches for you.
* **Filters** sit at the top of the Overview: game (a family — Mixed, Draw, Stud, Omaha, Hold'em — or one
  exact event), dates (last 7/30/90 days, 12 months, this month/year, or custom from–to), buy-in range,
  tournaments vs satellites, and result (cashed, out of the money, bubbles). They cut the totals, the
  event table, the satellite groups and the regulars, and the list on the left follows them ("filtered:
  N of M · clear"). Clicking an event row filters to it. Filters are remembered.
* The **Overview** shows that account's record: tournaments, entries, cashes and ITM, wins, satellite
  seats, buy-ins, winnings, net and ROI, split by event (satellites kept apart from the real thing),
  plus the regulars you keep running into and how they do.
* Click a tournament to see it the way the email lays it out — the header lines verbatim, every
  entry's place, entry number, country, prize and share of the pool, and your own "You finished…"
  lines — with your rows highlighted, player names linked to their record, a plain-text view, and
  **Open the hands** when its hand histories are in the library.
* The list is colour-coded: satellites are greyed so real tournaments stand out; your finish is
  green when it paid (money or a seat), **bright red** on the stone bubble (first one out), and
  soft yellow on a soft bubble (out within the next 10% of the paid places — at least the next two, or
  the next one when fewer than ten are paid — and still in the top half of the field).
* **Cost of entry** (a filter-bar toggle with a from–to range, in buy-ins) is everything you paid to get
  into a tournament — satellites and re-entries together — divided by one buy-in: 1× is a single
  entry, 0.1× a cheap satellite seat, 1.1× that seat plus one bought re-entry, 3× three bullets. Leave
  the max empty for no upper limit; 0–1 is "single entry". The satellites that fed a matching
  tournament stay with it so their cost still counts; satellites whose target you never played have no
  entry to measure and drop out. The **By cost of entry** table under the totals shows the whole curve
  — tournaments, cashes, spent, won, net and ROI per band — regardless of this filter; click a band to
  filter to it.
* **Opponents** at the bottom of the Overview lists *everyone* you played against in the tournaments
  shown (all 3,944 in the first import) — tournaments shared, entries, cashes, best finish, buy-ins,
  winnings, net and ROI — with a find box for a name or country. Their numbers follow the filters above.
  The **Opponents: min entries** toggle in the filter bar (with its number box) keeps only opponents with
  at least that many entries in the tournaments shown, so a sort by ROI isn't led by one-off results.
* **You are in that table too** (highlighted), and it carries a **Net rank** and **ROI rank** among the
  rows shown. The event table has the same two columns — your rank in each event against everyone who
  played it, as "3 / 45". With the minimum-entries toggle on, ranks are among players who meet it (you
  are always included), counted per event in the event table.
* **Click any column heading to sort** by it (click again to reverse): the standings, the event table,
  the opponents, and the tables on a player's record and in the Library. Money, percentages, places,
  entry numbers and dates sort as numbers; blanks stay at the bottom.
* Search takes a tournament number, an event, or any player's name (showing every tournament of
  yours they were in).

How the numbers are counted:

* One line in the email is one **entry**; `Name [3]` is that player's third entry. "N players"
  counts people. Every entry is a buy-in, so re-entries count against ROI.
* **Cashed** means paid money or won a satellite seat. A seat is valued at the target tournament's
  buy-in. Satellite qualifiers are not counted as wins, and a seat is not a "best finish".
* **Bounties** appear only for the account that requested the email ("You collected…"), so other
  players' knockout winnings are not in their records.
* A villain's record covers only the tournaments you were in.

### Chops

**Chop** on a tournament's page records a deal. Tick everyone who was in it and give each one's share
of their combined listed prizes — fill in yours and the rest is split evenly among the others until
you change them; the shares must total 100%. The standings then show what was actually paid (with the
listed prize beside it), and every number that uses prizes — your net, ROI, the satellite groups, each
of those players' records — uses the paid amount. **Edit chop** changes it and **Remove chop** puts the
listed prizes back. Chops are kept with the library and included in backups; the tournament's own text
is never altered.

### Play-money tournaments

Play chips mean nothing, so nothing PokerStars paid in them is used — not the buy-in, not the prize
pool, not the payouts. **Every entry costs $100 and the tournament pays by the chart in
`js/playmoney.js`** (rows = number of entries, columns = 1st, 2nd, …; each row sums to entries × $100).
Net is the chart payout minus $100. Only two facts come from PokerStars: how many entered and where
each player finished.

* **From a "Tournament History" email** (the reliable source): a buy-in with no currency
  (`Buy-In: 17000/3000`) marks it as play money. Entries = the last finishing place. The page still
  shows the email's header as printed, with the scoring underneath (*$100 buy-in · 11 entries · pays 3:
  $550 / $330 / $220*) and chart dollars in the Prize column.
* **From hand histories only**: the field is not recorded, so it is taken as the last place anyone was
  seen finishing in (or the number of different players seen, if larger). That can be short of the real
  field, so the page has an **Entries** box to correct it (remembered, backed up). A tournament whose
  hands stop before you bust has no finish and is left out of the numbers. Importing the history email
  for the same tournament replaces the estimate.

Pick the play-money account in the account pull-down; everything else — list, totals, filters, bubbles,
player records — works as for real tournaments, marked *play*. Tournaments stored before a scoring
change are re-scored from their own text the next time the app opens.

The chart holds the "6 handed" sheet for 2–39 entries. 7–9 handed games use it too until that sheet
is entered (`CHART_789`); a field the chart does not reach pays nothing and says so.

### Satellites, linked to what they fed

Every satellite names its target (`Target Tournament #… Buy-In: …`), so satellites are folded into
the tournament they fed — step satellites included (a $5.50 seat into a $55 satellite into the $530
main). Each of these groups reads as one line:

    $500 (Single Entry) + 2 x $50 (Satellites) = $600 Total Entry, $1,000 Payout, $400 Net Profit
    2 x $50 (Satellites, 1 ticket won) + $0 Entry ($500 via Satellite) = $100 Total Entry, $0 Payout, −$100 Net Loss · Busted out of the money

An entry paid with a seat costs no cash. A seat that was never used, or whose target isn't in the
history, counts at face value. Add up every group and you get exactly the same net as counting
tournament by tournament (checked for all 3,945 players in the first import). Shown in three places:

* a tournament's page: *Your entry, satellites included* (or, on a satellite, the tournament it fed),
  with every step listed; your "you: …" line counts a seat-paid entry as free;
* the Overview: every group with a satellite in it, plus totals (satellite spend, seats used);
* each player's record — the same logic works for anyone in the standings.

The list on the left marks tournaments you reached through satellites (`+2 sats`).

The Player database gains a sort (most tournaments, biggest winnings, best ROI) and shows the record
above a player's hand statistics — or on its own for someone you only know from standings.

## Backing up

**⭳ Back up** on the Library screen writes the whole thing — every hand, every tournament result, all markup, notes and
narration, stars, lessons and built hands — to one file. **⭱ Restore** merges a backup into the
library at the current address (nothing is duplicated). Worth doing now and then: browser storage
is only as durable as the browser decides it is.

## Card size

Cards are drawn as large as the table can actually hold. The app takes the size it wants for the
game (a 2-card Hold'em hand gets bigger cards than a 7-card stud hand), then caps it so no two seat
boxes can overlap at the current felt size and seat count — so a wide window gets big cards, a
3-handed table gets bigger cards than an 8-handed one, and seats never collide. On a 1900px-wide
window that lands at 28–42px per card; checked across 1,323 seat positions at 2- to 8-handed, with
no overlapping seats and nothing clipped by the stage.

In a very small window an 8-handed table runs out of room regardless — eight seat boxes will not
fit around a felt only ~550px wide, and they overlap. That predates the sizing work (it is a
function of the window, not the card size) and does not arise at normal window sizes.

## What the numbers mean

The amount on each row of the hand list is **profit** — what you collected minus what you put in,
including your blind or ante. The `+1,200` badge on a seat during the replay is **gross collected**,
the whole pot that was pushed to that player. Post 300, raise to 600, win a 1,200 pot that contains
your own 600, and the badge reads 1,200 while the row reads +600. The row is the figure that sums to
the `hero net` total at the top of the list.

Both numbers come from one implementation of the betting rules (`PSEngine.netFor`, beside the
replay engine that uses the same rules), checked against each other on every player of every hand.

## Steady layout

Every strip under the table — the presenter band, the equity readout, the action banner, the
controls — has a **fixed height**, expressed in `em` so it scales with the reader's font size, with
a runtime check that grows a strip rather than cutting its content off if it still does not fit.
(The hand header sizes itself: it is always exactly two single lines, so it cannot bounce.) Their content changes on every step (one line of
equity, or three with the hi/lo rows, or none at all while a simulation is still running), and
`#tableWrap` would otherwise pass the difference straight to the felt, so the whole table jumped on
each step of a replay. The felt also keeps one aspect ratio at every table size; short-handed tables
push the seats further out instead of growing the felt, so stepping or changing hands never resizes
anything. Verified across 75 hands and 2-to-8-handed tables: no panel changes height, and no seat
collides with the pot or board.

## If something looks wrong

Any uncaught failure now paints a red banner across the top with the actual error, instead of
leaving a blank panel — click it to dismiss. A single unrenderable hand degrades to one
placeholder row rather than emptying the hand list.

Assets are loaded with a `?v=…` cache key. If you edit the CSS or JS, bump that token in
`index.html` (all five links share it) so a normal reload can never mix a new `app.js` with a
stale `parser.js` — that mismatch is the one failure mode that can look like "the app is broken"
with nothing in the console.

## Files

```
index.html      markup + layout
css/styles.css  theme, felt, seats, cards
js/parser.js    hand-history text -> structured hand (header, seats, events, summary)
js/engine.js    events -> array of full table snapshots (one per visible step)
js/equity.js    hand evaluators for every family + chunked Monte-Carlo equity
js/builder.js   hand composer: model -> valid PokerStars text, incl. pot and showdown
js/buildui.js   the builder screen: card grid, action lists, live validation, saved-hand library
js/plans.js     lesson plans: ordered groups of hands, export/import, the "+ Lesson" picker
js/db.js        the library: IndexedDB store of hands, tournaments, summaries and performance records
js/tsummary.js  "Tournament History" emails: RTF -> text, standings parser, performance records
js/tourneys.js  the Tournament Overview screen
js/playmoney.js play-money tournaments from hand histories: $100 buy-in, payout chart, field estimate
js/stats.js     per-player statistics, per game
js/evtables.js  the HORSE+ EV tables: loading, matching your cards to the table's names
js/evdata/      the tables themselves, one file per game (generated by tools/make_evdata.py)
js/starthands.js starting-hand names for every game, their results, and the Starting hands screen
js/luck.js      skill vs luck: equity at the all-in / before the last card, side pots, luck per hand
js/review.js    the tournament review: key hands tagged, stack graph, solver pass
js/luckui.js    the Skill vs luck screen and the summary box on a tournament's page
js/home.js      main menu, library / players / your-numbers screens, backup & restore
js/lesson.js    lesson storage — markup, notes, narration timeline, audio, export/import
js/markup.js    the annotation layer: tools, shapes, step binding, DOM-anchored targets
js/teach.js     teaching UI: toolbar, notes, presenter band, present mode, recording
js/app.js       UI: loading, filtering, list, table rendering, playback
```
