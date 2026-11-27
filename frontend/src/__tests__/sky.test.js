import { seedSky, stepSky, SKY_SPEED, SKY_EMOJI } from '../utils/sky';

// The same "random" number every time, so a test knows exactly what comes out
const fixed = (value) => () => value;

describe('seeding the sky', () => {
  test('stars by the screen area, at least five emojis, no shooting stars yet', () => {
    const sky = seedSky(1400, 700, fixed(0.5));
    expect(sky.stars).toHaveLength(140);      // one per 7,000 square pixels
    expect(sky.coins).toHaveLength(9);        // one per 150px of width
    expect(sky.meteors).toEqual([]);
    expect(seedSky(320, 600).coins).toHaveLength(5);
  });

  test('the emojis include a money bag and bread', () => {
    expect(SKY_EMOJI).toEqual(expect.arrayContaining(['💰', '🍞']));
  });

  test('every star is on the screen, every emoji one of the money ones', () => {
    const sky = seedSky(800, 600);
    sky.stars.forEach(s => {
      expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x).toBeLessThanOrEqual(800);
      expect(s.y).toBeGreaterThanOrEqual(0); expect(s.y).toBeLessThanOrEqual(600);
    });
    sky.coins.forEach(c => expect(SKY_EMOJI).toContain(c.emoji));
  });
});

describe('a step of the sky', () => {
  test('each emoji drifts right by its speed', () => {
    const sky = seedSky(1000, 600, fixed(0.5));
    const next = stepSky({ ...sky, nextMeteorAt: Infinity }, 0.1, 0, fixed(0.5));
    next.coins.forEach((c, i) => expect(c.x - sky.coins[i].x).toBeCloseTo(sky.coins[i].vx * 0.1 * SKY_SPEED));
  });

  test('an emoji past the right edge comes back in from the left', () => {
    const sky = seedSky(1000, 600, fixed(0.5));
    sky.coins[0] = { ...sky.coins[0], x: 1049 };
    const next = stepSky({ ...sky, nextMeteorAt: Infinity }, 0.5, 0, fixed(0.5));
    expect(next.coins[0].x).toBe(-50);
  });

  test('a shooting star starts when one is due, the next is scheduled, and each fades out', () => {
    const sky = seedSky(1000, 600, fixed(0.5));
    const first = stepSky(sky, 0.016, 10, fixed(0.5));
    expect(first.meteors).toHaveLength(1);
    expect(first.nextMeteorAt).toBeCloseTo(10 + (1.2 + 0.5 * 1.6) / SKY_SPEED);
    expect(stepSky(first, 0.016, 10.1, fixed(0.5)).meteors).toHaveLength(1);   // none new before it's due
    const faded = stepSky({ ...first, nextMeteorAt: Infinity }, 2, 12, fixed(0.5));
    expect(faded.meteors).toEqual([]);                                          // older than its life
  });
});
