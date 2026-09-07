/**
 * `KOO-XXXXX`, drawn as what it is: the number a driver reads out at a door.
 *
 * WHY IT IS A COMPONENT AND NOT A FEW CLASSES. It appears on the job card and
 * on the task detail — the two screens either side of a driver tapping into a
 * stop — and it drifted between them the moment the first one changed: the
 * card grew a pill and the detail kept a grey `text-xs` fragment wedged
 * between the bag count and the flight number. The same identifier looking
 * like two different kinds of thing on two consecutive screens is exactly the
 * confusion this number exists to prevent.
 *
 * ON THE SEAL COLOUR, WHICH THE THEME RESTRICTS. `theme.css` reserves `tag`
 * for primary CTAs and the seal motif and forbids it as decoration. This is
 * the motif: a driver reads this back to prove they are the person expected,
 * which is the same act the seal performs, and the ref and the seal id are the
 * two things a hand-off is checked against.
 *
 * `bg-tag-400` with `text-navy-800` measures 5.43:1, past AA for normal text.
 * `tag-500` was the first pick and measures 4.27:1, which fails — so the
 * brand's own orange happens to be the accessible one. Written down because
 * the instinct when something needs emphasis is to reach for a darker shade,
 * and here that would break it.
 *
 * Mono, and NOT tightened: these characters get read aloud one at a time, so
 * they want the separation rather than less of it.
 *
 * THE PROP IS `value`, NOT `ref`. `ref` is reserved on a React element — it
 * means "hand me the DOM node", not "here is a string" — so the obvious name
 * for the obvious thing is the one name that cannot be used. It was written
 * that way first and `react-hooks/refs` caught it immediately, reading the
 * whole component as ref access during render.
 */
export function BookingRef({ value }: { value: string }) {
  return (
    <span className="w-fit rounded-md bg-tag-400 px-2.5 py-1 font-mono text-sm font-semibold text-navy-800">
      {value}
    </span>
  );
}
