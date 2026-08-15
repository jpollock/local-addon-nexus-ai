import { ulid, eventId } from '../envelope/ulid';

test('ulids minted in the same millisecond sort in emission order (monotonic)', () => {
  const t = Date.now();
  let prev = ulid(t);
  for (let i = 0; i < 5000; i++) {
    const next = ulid(t); // same-ms on purpose — the coin-flip case
    expect(next > prev).toBe(true);
    prev = next;
  }
});

test('a rewound clock never produces a smaller id', () => {
  const t = Date.now();
  const a = ulid(t);
  const b = ulid(t - 60_000); // clock steps backwards
  expect(b > a).toBe(true);
});

test('event ids keep the evt_ prefix and 26-char body', () => {
  expect(eventId()).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
});
