# Pinewood Derby Simulator - Broadcast Mode

A physics-grounded pinewood derby simulator. This build is the Broadcast Mode
vertical slice: you pick a field of bot-built cars and direct the race - choosing
camera angles live, riding auto-cam, calling replays, and catching the photo finish.

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # 22 tests: physics, determinism, placement
npm run typecheck
```

Desktop and touch are both first-class. Every hotkey has a button.

## Directing

Numbers are lanes - `3` chases the car in lane 3, which is the only mapping worth
having to remember. Letters are the fixed angles:

| Key | Shot | |
| --- | --- | --- |
| `1`-`8` | Lane chase | follows that lane's car |
| `G` | Starting Gate | tight on the pin drop |
| `D` | Ramp | side-on through the descent |
| `B` | Pack Cam | low on the deck behind the whole field |
| `V` | Drone Cam | high and behind, the field plus the track ahead |
| `F` | Finish Line | locked across the lanes, doubles as the photo finish |
| `O` | Overhead | top-down, best read of the gaps |
| `X` | Free Cam | drag to orbit, wheel or pinch to dolly |

`A` auto-cam · `R` instant replay · `S` slow motion · `C` mark a clip · `Space`
pause · `←`/`→` scrub.

Pack and Drone both follow the field rather than one car. They sit behind the
last car but never further back than about 2.4 m from the leader, so one disaster
run cannot drag the shot away from the race - past that the stragglers fall out of
frame, which is what a real operator does.

**Auto-cam** opens on the gate, follows the drop, goes to the drone as the field
hits the flat, cuts to the leader on a lead change, reads the gaps from overhead,
then locks the finish line off *before* the cars arrive. Left alone it rotates
between the leader and the field-wide shots rather than sitting on one angle.
Taking a shot by hand while auto-cam is on steals a single cut and hands control
back after a couple of seconds - so riding the director and grabbing only the
shots that matter is a real way to work.

## The physics

The simulation is deterministic and integrated at a fixed 1/480 s timestep. It is
honest rather than tuned-to-taste, and two results that usually get hard-coded
fall out of the geometry on their own:

- **Rear bias is fast** because the track's ramp extends *behind* the start line.
  A rear-weighted car's centre of mass genuinely starts higher up the ramp, so it
  falls further over the same run. Nothing grants it a bonus.
- **Low is fast** because levelling out through the transition lifts a tall car's
  centre of mass, spending energy a low car never spends. A tall car also rocks
  harder over any rail contact, so height costs consistency as well as time.

The block also rides the regulation 3/8 in clear of the deck, so it straddles the
lane's centre guide rail rather than sitting on it, and every physical use of
centre-of-mass height is measured from the contact patch rather than from the
underside of the block. The rendered rail's width is derived from the same
clearance the simulation uses, so the edge you see a wheel touch is the contact
the physics charges for.

Also modelled: axle-bore friction (via the axle-radius to wheel-radius ratio,
which is what makes it the dominant loss), aerodynamic drag against a frontal area
that includes four wheels you cannot carve away, wheel spin-up inertia, front-axle
unloading and wheelies, and guide-rail contact where light sustained contact is
cheap (deliberate rail riding) but a hard hit is expensive.

Cars are *timed* at the finish beam but are not stopped by it: they carry on over
the line, coast across the run-out, and are brought to rest by a braking catch
section of carpet and foam, with a backstop at the end of the trestle. The
braking pad starts past the line so it can never touch a recorded time - there is
a test pinning that.

Calibrated against a 42 ft track with a 48 in drop at 26 degrees, plus an 11 ft
run-out. A mid-pack car runs about **3.46 s**; a well-built one about **3.42 s**.
What a second of build time is worth, measured:

| Lever | Range tested | Time |
| --- | --- | --- |
| Axle alignment | 0.02° → 0.50° error | **0.437 s** |
| Axle prep (polish + lube) | rough → mirror | **0.211 s** |
| Total mass | 3 oz → 5 oz | **0.117 s** |
| Body shape | block → low plank | **0.085 s** |
| Centre-of-mass height | 0.15 in → 1.0 in | **0.043 s** |
| Ballast fore/aft | 2 in → 5.4 in from nose | **0.022 s** |

### One honest deviation from the brief

The design doc asks that shape matter only lightly and that weight placement
dominate. The simulation does not agree, and it was not made to: carving a block
into a plank removes real frontal area, and at 0.048 s that beats moving the
ballast (0.017 s). The order it *does* produce still supports the pillar, for a
better reason:

- Axle work (alignment + prep) is worth **0.65 s** combined and dwarfs everything.
- Shape is worth more than ballast position, but it is a *one-time, obvious*
  decision - carve a wedge, done. It is not skill-expressive.
- Weight placement and axle tuning are continuous, non-obvious, and testable,
  which is where the ongoing skill actually lives.

The ballast figure is also a floor, not a ceiling: it was measured with a solid
wedge where ballast is only ~28% of the car's mass. Hollowing the chassis (the
`bottom` profile curve, already in the data model) raises the ballast fraction and
the lever grows with it.

If you want the doc's hierarchy enforced anyway, the aero term is one number:
`dragArea` in `src/sim/build.ts`.

## Architecture

```
src/sim/         Renderer-free, headless, fully tested
  track.ts       Geometry as functions of arc length (ramp behind the start line,
                 braking catch section past the finish)
  physics.ts     Fixed-step integrator, longitudinal truth + lateral drift
  build.ts       Chassis -> mass, centre of mass, inertia, drag area, friction
  race.ts        Orchestrator -> results + 120 Hz recording + event stream
  events.ts      The race-state event stream and its scheduler
  archetypes.ts  Bot cars that differ in how they are built, not how they score
src/broadcast/   cameras (fixed, per-lane and field-following), auto-cam
                 director, announcer
src/render/      R3F scene, lofted chassis, swept track, placement
src/ui/          Overlay kit, switcher, setup, results
```

The whole game hangs off one event stream. The auto-cam director, the announcer,
the overlays and the sound are all consumers of `RaceEvent[]` and nothing else, so
they cannot disagree about what happened - and a replay fires exactly the cuts the
live race did.

**Determinism** is split two ways on purpose. A car's permanent quirks (which way
its crooked axle pulls, its wobble phase) are seeded from the build's identity, so
it behaves like itself in every race it ever runs. Day-of scatter (wax, dust, how
the gate let go) is seeded from the race. Same seed reproduces exactly; `variance:
0` is bit-for-bit repeatable.

**Replays** re-read a recorded state buffer rather than re-simulating, so scrubbing,
slow motion and cutting the same moment from a different angle are all free and
survive changes to the physics.

## Not built yet

The build bench is the next milestone, and the data model is already shaped for
it: `ChassisProfile` carries draggable control points (including the unused
`bottom` hollowing curve), `analyzeBuild()` returns live centre-of-mass, drag and
friction figures for a bench readout, and builds are plain serialisable objects
ready for a garage and share codes.

Also outstanding from the brief: bracket format (single heat and best-of-three
work), ghost overlays, clip export to video (clips are marked and stored, but
replay only), and voice-acted announcer lines (text only).
