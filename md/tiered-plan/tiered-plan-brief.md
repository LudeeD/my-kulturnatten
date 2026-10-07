# Feature brief: shared tiered plan for My Culture Night

## Goal

Add a shared plan to My Culture Night (kulturnatten.luissilva.eu). A friend group opens one link, puts Kulturnatten events into numbered tiers together before the night, and keeps adjusting it during the night.

It is a tier list, not a route. It must never force an order, a flow or a decision.

## Before you start

Read the existing codebase first and fit this feature into it. The brief was written without access to the source. All that is known about the current app is its public description: an unofficial planner where you pick Kulturnatten 2026 events (Friday 9 October 2026) and see them as numbered picks on a dark map of Copenhagen, with `#12151c` as the theme colour.

Reuse what is already there: the event data loading, the map, the pick mechanism, the styling and component conventions. Do not introduce a second map, a second event store or a new visual language.

`tiered-plan-prototype.html` is attached as a behaviour reference. It is a throwaway built with CSS state tricks and a small drag script. Copy the behaviour, not the code or the markup. Its colours are indicative only; use the app's own design.

## The model

- A **plan** has a set of **places**. A place is one event from the programme.
- Every place in the plan is in exactly one of five buckets: tier **1**, **2**, **3**, **4**, or **Unsorted**.
- Tiers are just numbers. The app gives them no name and no meaning; the group decides what they mean.
- There is no order inside a tier.
- There is no visited, done or current-stop state.
- Each place records which participants are **in**, and who last put it in its current bucket.

Suggested shape (adapt to the existing store):

```
Plan        { id, places: PlanPlace[], participants: Participant[] }
PlanPlace   { eventId, tier: 1|2|3|4|null, in: participantId[], movedBy: participantId }
Participant { id, name, colour }
```

`tier: null` means Unsorted. An event that is not in `places` is simply not in the plan.

## The screen

One screen, top to bottom:

1. **Header.** App title, the participants' avatars, and an Invite control that gives the plan's link.
2. **Map.** Shows every place in the plan as a pin with its tier number inside and a short name beside it. Tier 1 pins are the strongest colour, fading down to tier 4. Unsorted pins are hollow with a dashed outline. The selected place's pin gets a ring.
3. **Tier rows.** Five rows in this order: 1, 2, 3, 4, Unsorted. Each row is a header (the number in a circle and a thin rule; "Unsorted" has a `?` and the word) followed by that tier's places as chips that wrap. An empty tier still shows its header.
4. **Add a place.** A dashed button after the Unsorted row.

The whole plan should fit on one phone screen for a typical plan of six to ten places. This is the main reason places are chips and not cards.

### Chip

A pill with the place's short name and a small count of how many people are in. Its fill follows its tier, matching the map pin.

### Detail panel

Tapping a chip opens its detail panel in place, directly under that chip's tier row, full width. Only one panel is open at a time. Tapping another chip switches; Close closes it.

The panel shows:

- Full organiser name
- One line on what is on
- Area, closing time, number of timed sessions
- "Sign-up needed" only when the event requires it
- Avatars of who is in, and a Join / I'm in toggle for the current user
- "Put here by {name}"
- Remove, in the corner, which asks "Remove for everyone?" with "Yes, remove" before doing it

There are no tier buttons in the panel.

## Moving places: drag and drop

Dragging a chip onto another tier is the only way to change its tier.

- **Mouse:** drag starts after about 6px of movement.
- **Touch:** press and hold about 280ms to lift the chip. A quick swipe must still scroll the page.
- While dragging, a copy of the chip follows the pointer and the original fades.
- The drop target is the whole band of a tier: from its header down to the next tier's header. The target tier's header gets a dashed outline. The chip's current tier is not a target.
- The list auto-scrolls when the pointer is within about 70px of the top or bottom edge.
- Dropping sets the tier and nothing else. Releasing outside any tier cancels.
- A tap without a drag still opens the detail panel. Suppress the click that follows a drag.
- Block the long-press context menu and text selection on chips.
- If the dragged place's panel is open, it follows the chip to the new row.

Provide a keyboard path for moving a place (for example arrow keys on a focused chip). The prototype does not have one.

## Adding places

"Add a place" opens a list of events that are not yet in the plan, each with a single Add button. Adding puts the place in **Unsorted**. The user is never asked to choose a tier while adding.

The real version needs search across the full programme (about 220 events). The prototype only lists two hard-coded events.

## Sharing

- A plan has a link. Anyone with the link can view and edit.
- Changes by one person appear for the others without a reload.
- Each participant has a name and a colour. Ask for a name the first time someone opens a plan link.
- Last write wins for tier changes. Joining and leaving are per person and cannot conflict.

The prototype fakes all of this with static example people. Nothing in it is saved or synced.

## Event data

Events come from `https://kulturnatten.dk/wp-json/kulturnatten/v1/events`. Use the app's existing loader. Fields this feature needs:

| Field | Use |
|---|---|
| `id`, `no` | Identity and programme number |
| `organizer.en` / `.da` | Place name |
| `title.en` / `.da` | What is on |
| `area` | Shown in the detail panel |
| `lat`, `lng`, `badCoords` | Map pin; skip the pin when `badCoords` is true |
| `end` | Closing time, in minutes after 18:00 |
| `subEvents` | Count of timed sessions |
| `signupRequired` | Sign-up warning |

Almost every event runs the whole evening (18:00 to 23:00 or 24:00), so start time is not useful for planning. One event has no coordinates and one is marked cancelled in its organiser name.

## Deliberately left out

These were tried and rejected. Do not add them back.

- Stops, steps, a route line or any fixed order
- Named tiers such as "Definitely" or "End here", and editable tier labels
- "Move here" buttons or a tier picker on the chip or in the panel
- Marking places as visited or done
- A bottom sheet summarising the plan
- An intro or explanation block at the top of the screen
- A Reset button

## Open decisions for the owner

1. **Existing picks.** How do the app's current numbered picks relate to the plan? Simplest: each existing pick becomes a place in Unsorted.
2. **Backend for sharing.** The brief assumes real-time sync but does not choose a technology.
3. **Short names.** Chips and pins need a short name per event. Decide whether to derive it from the organiser name or store one.
4. **Comments.** The prototype shows one static friend comment on a place. Decide whether comments are in scope.
5. **Distances.** Walking times between places were dropped along with the route. Decide whether the detail panel should show distance to the nearest other place in the plan.

## Done when

- Two phones on the same link see each other's adds, moves, removes and joins without reloading.
- A place can be dragged between all five rows on touch and with a mouse, and a swipe on a chip still scrolls.
- Adding a place never asks for a tier.
- Removing asks for confirmation.
- The map pins match the rows after every change.
- A plan of eight places fits on one phone screen with no panel open.
