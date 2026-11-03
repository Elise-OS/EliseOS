const RealDate = Date;

/** The demo home is always seen on Tuesday 13 October 2026 at 10:40, in the visitor's own time zone. */
export const FROZEN_AT = new RealDate(2026, 9, 13, 10, 40, 0, 0).getTime();

/** Starts every clock of the page at the frozen moment; time then runs normally from there. */
export function freezeClock() {
  const offset = FROZEN_AT - RealDate.now();
  class DemoDate extends RealDate {
    public constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }

    public static override now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = DemoDate as DateConstructor;
}
