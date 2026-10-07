/** Runs `callback` once after calls to `trigger()` have stopped for `delayMs`. */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly callback: () => void,
    private readonly delayMs: number,
  ) {}

  trigger(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.callback, this.delayMs);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}
